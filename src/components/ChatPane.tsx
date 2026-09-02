import clsx from "clsx";
import { LoaderCircle, PanelRight, Sparkles } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	isElectronRuntime,
} from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { KnowledgeExtractionResponse, SummaryResponse } from "../shared/ipc";
import type { Turn } from "../types";
import { requestScheduler } from "../utils/requestScheduler";
import { useKnowledgePreview } from "../hooks/useKnowledgePreview";
import { useAgentEventStream } from "../hooks/useAgentEventStream";
import { useConversationNavigation } from "../hooks/useConversationNavigation";
import { createId, summarize, withTimeout } from "../utils/common";
import { buildKnowledgeContext } from "../utils/knowledgeContext";
import { buildPriorAgentTranscript } from "../utils/agentTranscript";
import { selectionContinuationTarget } from "../utils/sessionFork";
import { createSelectionAppendDebugSnapshot, forkDebugEventName, type ForkDebugEventDetail } from "../utils/forkDebug";
import { failRunningTurnActivities, finishTurnActivity, startTurnActivity } from "../utils/turnActivity";
import { buildKnowledgeInventory, prioritizeKnowledgeSourceRefs, sourceHitsToRefs } from "../utils/knowledgeExtraction";
import { isSessionRunning } from "../utils/sessionRuntime";
import { branchSwitchEndEvent, branchSwitchStartEvent } from "../utils/branchSwitch";
import { errorToMessage } from "../shared/value";
import { KnowledgePreviewDialog } from "./KnowledgePreviewDialog";
import { SelectionAskPopover, type TextSelectionAnchor } from "./chat/SelectionAskPopover";
import { ChatComposer, type ComposerImage } from "./chat/ChatComposer";
import { ConversationFind } from "./chat/ConversationFind";
import { TurnMessage } from "./chat/TurnMessage";
import { TurnNavigator } from "./TurnNavigator";

const auxiliaryRequestTimeoutMs = 30_000;

export const ChatPane: React.FC = () => {
	const store = useAppStore();
	const [input, setInput] = useState("");
	const [pendingRequests, setPendingRequests] = useState(0);
	const [sendError, setSendError] = useState<string | null>(null);
	const [forkDebugStatus, setForkDebugStatus] = useState<ForkDebugEventDetail | null>(null);
	const [images, setImages] = useState<ComposerImage[]>([]);
	const [selection, setSelection] = useState<TextSelectionAnchor | null>(null);
	const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
	const activeSessionId = store.activeSessionId;
	const isSending = pendingRequests > 0;
	const activeSession = store.sessions.find((session) => session.id === activeSessionId);
	const { registerStreamingTurn, unregisterStreamingTurn } = useAgentEventStream();
	const { scrollContainerRef, keyboardTurnId, setKeyboardTurnId, sessionTurns, turnSessionMap, moveKeyboardTurn } = useConversationNavigation(store.turns, activeSessionId);
	const { preview: knowledgePreview, openEntityById: openEntityPreview, openDiagramById: openDiagramPreview, closePreview } = useKnowledgePreview(store.entities, store.diagrams);
	useEffect(() => { requestScheduler.setLimit(store.settings.maxConcurrentRequests); }, [store.settings.maxConcurrentRequests]);
	useEffect(() => {
		const start = () => setIsSwitchingBranch(true);
		const end = () => setIsSwitchingBranch(false);
		window.addEventListener(branchSwitchStartEvent, start);
		window.addEventListener(branchSwitchEndEvent, end);
		return () => {
			window.removeEventListener(branchSwitchStartEvent, start);
			window.removeEventListener(branchSwitchEndEvent, end);
		};
	}, []);
	useEffect(() => {
		const onForkDebug = (event: Event) => setForkDebugStatus((event as CustomEvent<ForkDebugEventDetail>).detail);
		window.addEventListener(forkDebugEventName, onForkDebug);
		return () => window.removeEventListener(forkDebugEventName, onForkDebug);
	}, []);
	useEffect(() => {
		const createInitialSession = () => {
			const current = useAppStore.getState();
			if (!current.activeSessionId && current.sessions.length === 0) current.createRootSession();
		};
		// React Refresh can replace the persisted store module without rerunning the app
		// bootstrap. Trigger the guarded storage adapter so a richer hot state is flushed.
		if (!useAppStore.persist.hasHydrated()) useAppStore.setState({});
		const unsubscribe = useAppStore.persist.onFinishHydration(createInitialSession);
		if (useAppStore.persist.hasHydrated()) createInitialSession();
		return unsubscribe;
	}, []);

	const handleSend = async (options?: { sessionId?: string; selectedText?: string; quotedTurnId?: string; question?: string }) => {
		const prompt = (options?.question ?? input).trim();
		const targetSessionId = options?.sessionId ?? activeSessionId;
		if ((!prompt && images.length === 0) || !targetSessionId) return;
		const promptImages = images.map(({ id: _id, preview: _preview, ...image }) => image);
		const agentPrompt = options?.selectedText
			? `Answer the user's question using the selected passage as the primary focus. The selected passage identifies what the user is asking about and is explicit evidence of a learning gap; extract any durable concept it names into the knowledge base. Prefer linking or updating existing knowledge-base entities instead of creating duplicates.\n\nSelected passage:\n${options.selectedText}\n\nUser question:\n${prompt}`
			: prompt;
		setInput("");
		setImages([]);
		setSendError(null);
		const now = new Date().toISOString();
		const userTurnId = createId("turn");
		const assistantTurnId = createId("turn");
		store.addManualTurn({
			id: userTurnId,
			sessionId: targetSessionId,
			role: "user",
			content: prompt,
			status: "complete",
			summary: summarize(prompt),
			images: promptImages,
			quote: options?.selectedText && options.quotedTurnId
				? { turnId: options.quotedTurnId, text: options.selectedText }
				: undefined,
			createdAt: now,
		});
		store.addManualTurn({
			id: assistantTurnId,
			sessionId: targetSessionId,
			role: "assistant",
			content: "",
			status: "retrieving",
			summary: "Retrieving workspace context",
			activities: startTurnActivity(undefined, "retrieval", "Retrieving workspace context", now),
			createdAt: now,
		});
		store.setSessionStatus(targetSessionId, "running");
		setPendingRequests((count) => count + 1);

		try {
			await requestScheduler.enqueue(targetSessionId, async () => {
			const bridge = getKnowbranchBridge();
			if (!bridge) throw new Error("Chat requires the Electron desktop runtime.");
			const selectedModel = store.settings.defaultModel
				? { providerId: githubCopilotProviderId, modelId: store.settings.defaultModel }
				: undefined;
			const summaryPromise = withTimeout(
				bridge.generateSummary({ text: prompt, model: selectedModel }),
				auxiliaryRequestTimeoutMs,
				"Title generation",
			).catch((): SummaryResponse => ({ error: "Title generation timed out." }));
			const sourceHits = await bridge.sourceSearch({ query: agentPrompt, limit: 8 });
			const retrievedTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
			store.updateTurn(assistantTurnId, {
				activities: startTurnActivity(
					finishTurnActivity(retrievedTurn?.activities, "retrieval", "complete", `${sourceHits.length} source match${sourceHits.length === 1 ? "" : "es"}`),
					"agent",
					"Generating response",
				),
			});
			const currentTurns = useAppStore.getState().turns;
			const transcript = buildPriorAgentTranscript(currentTurns, targetSessionId, [userTurnId, assistantTurnId]);
			const knowledgeContext = buildKnowledgeContext(agentPrompt, useAppStore.getState().entities, useAppStore.getState().relations, useAppStore.getState().diagrams, sourceHits);
			store.updateTurn(assistantTurnId, { status: "running", summary: "Pi agent is running" });
			const targetSession = useAppStore.getState().sessions.find((session) => session.id === targetSessionId);
			registerStreamingTurn(targetSessionId, assistantTurnId);
			const result = await bridge.agentPrompt({
				frontendSessionId: targetSessionId,
				parentFrontendSessionId: targetSession?.parentId ?? undefined,
				forkedFromTurnId: targetSession?.forkedFromTurnId,
				transcript,
				prompt: agentPrompt,
				images: promptImages,
				knowledgeContext,
				thinkingLevel: store.settings.thinkingLevel,
				diagramMode: store.settings.diagramRenderer,
				model: selectedModel,
				writable: true,
			});
			const agentTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
			store.updateTurn(assistantTurnId, {
				activities: finishTurnActivity(agentTurn?.activities, "agent", result.ok ? "complete" : "error", result.ok ? undefined : result.error),
			});
			if (result.usage) store.updateTurn(assistantTurnId, { usage: result.usage });
			if (!result.ok) throw new Error(result.error || "Pi SDK request failed.");
			const response = result.assistantText || "Pi SDK completed without text output.";
			const streamedReasoning = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId)?.reasoning;
			store.updateTurn(assistantTurnId, {
				content: response,
				reasoning: result.reasoningText ?? streamedReasoning,
				status: "finalizing",
				summary: summarize(response),
			});
			const shouldExtractKnowledge = store.settings.autoExtract && store.settings.knowledgeMode !== "read_only";
			if (shouldExtractKnowledge) {
				const currentTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
				store.updateTurn(assistantTurnId, { activities: startTurnActivity(currentTurn?.activities, "knowledge", "Updating workspace knowledge") });
			}
			const extraction = shouldExtractKnowledge
				? await withTimeout(bridge.extractKnowledge({
					question: agentPrompt,
					answer: response,
					...buildKnowledgeInventory(useAppStore.getState().entities, useAppStore.getState().diagrams),
					model: selectedModel,
				}), auxiliaryRequestTimeoutMs, "Knowledge extraction").catch((error: unknown): KnowledgeExtractionResponse => ({
					entities: [],
					relations: [],
					diagrams: [],
					error: errorToMessage(error),
				}))
				: { entities: [], relations: [], diagrams: [], usage: undefined };
			if (shouldExtractKnowledge) {
				const currentTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
				const extractedCount = extraction.entities.length + extraction.relations.length + extraction.diagrams.length;
				store.updateTurn(assistantTurnId, {
					activities: finishTurnActivity(
						currentTurn?.activities,
						"knowledge",
						extraction.error ? "error" : "complete",
						extraction.error ?? `${extractedCount} knowledge candidate${extractedCount === 1 ? "" : "s"}`,
					),
				});
			}
			store.addTurnUsage(assistantTurnId, extraction.usage);
			const prefetchedSourceRefs = sourceHitsToRefs(sourceHits, useAppStore.getState().sources);
			const sourceRefs = prioritizeKnowledgeSourceRefs(
				[...prefetchedSourceRefs, ...(result.sourceRefs ?? [])],
				agentPrompt,
			);
			store.finalizeTurn(targetSessionId, assistantTurnId, response, extraction.entities, extraction.relations, extraction.diagrams, sourceRefs);
			const generatedSummary = await summaryPromise;
			store.addTurnUsage(assistantTurnId, generatedSummary.usage);
			if (generatedSummary.summary) {
				store.updateTurn(userTurnId, { summary: generatedSummary.summary });
				const session = useAppStore.getState().sessions.find((item) => item.id === targetSessionId);
				if (session?.title === "New session" || session?.titlePending || session?.refreshTitleOnNextPrompt) {
					store.renameSession(targetSessionId, generatedSummary.summary);
				}
			}
			store.updateTurn(assistantTurnId, { completedAt: new Date().toISOString() });
			});
		} catch (error) {
			const message = errorToMessage(error);
			const failedTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
			store.updateTurn(assistantTurnId, {
				content: message,
				status: "complete_with_unsynced_knowledge",
				summary: "Request failed",
				completedAt: new Date().toISOString(),
				activities: failRunningTurnActivities(failedTurn?.activities, message),
			});
			store.setSessionStatus(targetSessionId, "error");
			setSendError(message);
		} finally {
			unregisterStreamingTurn(targetSessionId);
			const currentState = useAppStore.getState();
			if (currentState.sessions.find((session) => session.id === targetSessionId)?.status !== "error") {
				const hasQueuedOrRunning = isSessionRunning(currentState.turns, targetSessionId);
				store.setSessionStatus(targetSessionId, hasQueuedOrRunning ? "running" : "idle");
			}
			setPendingRequests((count) => Math.max(0, count - 1));
		}
	};

	const handleFork = async (turn: Turn, index: number) => {
		const result = store.forkSession(turn.id);
		if (!result) return;
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const model = store.settings.defaultModel
			? { providerId: githubCopilotProviderId, modelId: store.settings.defaultModel }
			: undefined;
		const originalText = sessionTurns.slice(index + 1).filter((item) => item.role === "user").map((item) => item.content).join("\n")
			|| sessionTurns.slice(index + 1).map((item) => item.content).join("\n");
		const forkText = [...sessionTurns.slice(0, index + 1)].reverse().find((item) => item.role === "user")?.content ?? turn.content;
		const [originalTitle, forkTitle] = await Promise.all([
			bridge.generateSummary({ text: originalText, model }),
			bridge.generateSummary({ text: forkText, model }),
		]);
		const current = useAppStore.getState();
		if (result.originalSessionId !== result.branchPointSessionId) {
			current.addSessionTitleUsage(result.originalSessionId, originalTitle.usage);
		}
		current.addSessionTitleUsage(result.branchPointSessionId, forkTitle.usage);
		const originalSession = current.sessions.find((session) => session.id === result.originalSessionId);
		if (result.originalSessionId !== result.branchPointSessionId) {
			current.renameSession(result.originalSessionId, originalTitle.summary ?? originalSession?.title ?? "Conversation");
		}
		const branchPoint = current.sessions.find((session) => session.id === result.branchPointSessionId);
		current.renameSession(result.branchPointSessionId, forkTitle.summary ?? branchPoint?.title ?? "Conversation");
		current.renameSession(result.forkSessionId, forkTitle.summary ?? "New branch", true);
	};

	const sendSelectionQuestion = (question: string, selected = selection) => {
		if (!selected || !question.trim()) return;
		const current = useAppStore.getState();
		const target = selectionContinuationTarget(current, selected.turnId);
		if (!target) {
			setSendError("This passage could not be mapped to a conversation node.");
			return;
		}
		if (target.mode === "append") {
			const snapshot = createSelectionAppendDebugSnapshot(current, selected.turnId, target);
			const dumpWriter = getKnowbranchBridge()?.forkDebugDump;
			if (typeof dumpWriter === "function") {
				void dumpWriter({ kind: "selection-append", timestamp: snapshot.timestamp, selectedTurnId: selected.turnId, snapshot }).then(
					(response) => setForkDebugStatus({ ok: true, message: `No fork was created (leaf node). Decision dump: ${response.path}` }),
					(error: unknown) => setForkDebugStatus({ ok: false, message: `Selection dump failed: ${errorToMessage(error)}` }),
				);
			} else {
				setForkDebugStatus({ ok: false, message: "Selection dump unavailable. Restart Electron to load the updated preload bridge." });
			}
			setSelection(null);
			void handleSend({ sessionId: target.sessionId, selectedText: selected.text, quotedTurnId: selected.turnId, question });
			return;
		}
		const result = current.forkSession(selected.turnId);
		if (!result) {
			setSendError("The selected conversation point could not be forked.");
			return;
		}
		setSelection(null);
		void handleSend({ sessionId: result.forkSessionId, selectedText: selected.text, quotedTurnId: selected.turnId, question });
	};

	useEffect(() => {
		if (!selection) return;
		const dismissSelectionMenu = () => {
			setSelection(null);
			window.getSelection()?.removeAllRanges();
		};
		const close = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (target?.closest(".text-selection-menu, .text-selection-popover")) return;
			dismissSelectionMenu();
		};
		const closeOnScroll = (event: Event) => {
			const target = event.target as Element | null;
			if (target?.closest?.(".text-selection-popover")) return;
			dismissSelectionMenu();
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("blur", dismissSelectionMenu);
		window.addEventListener("resize", dismissSelectionMenu);
		window.addEventListener("scroll", closeOnScroll, true);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("blur", dismissSelectionMenu);
			window.removeEventListener("resize", dismissSelectionMenu);
			window.removeEventListener("scroll", closeOnScroll, true);
		};
	}, [selection]);

	return (
		<div className="chat-pane">
			<ConversationFind turns={sessionTurns} scrollContainerRef={scrollContainerRef} />
			<header className="chat-topbar">
				<div className="min-w-0"><h1>{activeSession?.title ?? "New chat"}</h1><span>{store.settings.defaultModel || "GitHub Copilot"}</span></div>
				<button type="button" className={clsx("topbar-button", store.rightPaneOpen && "is-active")} onClick={store.toggleRightPane} title="Toggle knowledge panel" aria-label="Toggle knowledge panel"><PanelRight size={17} /></button>
			</header>
			{isSwitchingBranch && <div className="branch-switch-loading" role="status" aria-live="polite"><LoaderCircle size={22} aria-hidden="true" /><div><strong>Opening branch…</strong><span>Preparing the latest conversation</span></div></div>}
			<div ref={scrollContainerRef} className="chat-scroll" tabIndex={0} role="region" aria-label="Conversation. Use up and down arrow keys to move between turns." onFocus={() => setKeyboardTurnId((current) => current ?? sessionTurns[sessionTurns.length - 1]?.id ?? null)} onPointerDown={(event) => {
				const target = event.target as Element | null;
				if (target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
				const turnId = target?.closest<HTMLElement>("[data-turn-id]")?.dataset.turnId;
				setKeyboardTurnId(turnId ?? sessionTurns[sessionTurns.length - 1]?.id ?? null);
				event.currentTarget.focus({ preventScroll: true });
			}} onKeyDown={(event) => {
				if (event.target !== event.currentTarget || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
				event.preventDefault();
				moveKeyboardTurn(event.key === "ArrowUp" ? -1 : 1);
			}}>
				{sessionTurns.map((turn, index) => (
					<TurnMessage
						key={turn.id}
						turn={turn}
						sessionNodeId={turnSessionMap.get(turn.id) ?? turn.sessionId}
						isKeyboardActive={turn.id === keyboardTurnId}
						entities={store.entities}
						relations={store.relations}
						diagrams={store.diagrams}
						onFork={() => void handleFork(turn, index)}
						canFork={turn.role === "assistant" && index < sessionTurns.length - 1}
						onEntityClick={openEntityPreview}
						onDiagramClick={openDiagramPreview}
						onTextSelection={(text, rect) => setSelection({ turnId: turn.id, text, x: rect.left + rect.width / 2, y: rect.bottom + 8 })}
					/>
				))}
				{sessionTurns.length === 0 && (
					<div className="chat-empty">
						<div className="brand-mark large"><Sparkles size={20} /></div>
						<h2>What do you want to understand?</h2>
					</div>
				)}
			</div>
			{selection && <SelectionAskPopover selection={selection} onAsk={sendSelectionQuestion} onClose={() => setSelection(null)} />}
			{sessionTurns.length > 1 && <TurnNavigator turns={sessionTurns} scrollContainerRef={scrollContainerRef} />}
			{forkDebugStatus && <div className={clsx("fork-debug-status", !forkDebugStatus.ok && "is-error")} role="status">{forkDebugStatus.message}</div>}
			<ChatComposer input={input} images={images} entities={store.entities} diagrams={store.diagrams} isSending={isSending} error={sendError} runtimeCaption={isElectronRuntime() ? `Pi SDK / GitHub Copilot${store.settings.defaultModel ? ` / ${store.settings.defaultModel}` : ""}` : "Electron runtime required for agent execution"} onInputChange={setInput} onImagesChange={setImages} onError={setSendError} onSend={() => void handleSend()} />
			{knowledgePreview && <KnowledgePreviewDialog preview={knowledgePreview} onClose={closePreview} />}
		</div>
	);
};
