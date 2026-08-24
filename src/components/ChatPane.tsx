import clsx from "clsx";
import { PanelRight, Sparkles } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { createId, summarize, withTimeout } from "../utils/common";
import { buildKnowledgeContext, isRecord, summarizeToolTarget } from "../utils/knowledgeContext";
import { KnowledgePreviewDialog } from "./KnowledgePreviewDialog";
import { SelectionAskPopover, type TextSelectionAnchor } from "./chat/SelectionAskPopover";
import { ChatComposer, type ComposerImage } from "./chat/ChatComposer";
import { TurnMessage } from "./chat/TurnMessage";
import { TurnNavigator } from "./TurnNavigator";

const auxiliaryRequestTimeoutMs = 30_000;

export const ChatPane: React.FC = () => {
	const store = useAppStore();
	const [input, setInput] = useState("");
	const [pendingRequests, setPendingRequests] = useState(0);
	const [sendError, setSendError] = useState<string | null>(null);
	const [images, setImages] = useState<ComposerImage[]>([]);
	const [selection, setSelection] = useState<TextSelectionAnchor | null>(null);
	const [keyboardTurnId, setKeyboardTurnId] = useState<string | null>(null);
	const streamingTurnIds = useRef(new Map<string, string>());
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const activeSessionId = store.activeSessionId;
	const isSending = pendingRequests > 0;
	const activeSession = store.sessions.find((session) => session.id === activeSessionId);
	const { preview: knowledgePreview, openEntityById: openEntityPreview, openDiagramById: openDiagramPreview, closePreview } = useKnowledgePreview(store.entities, store.diagrams);
	useEffect(() => { requestScheduler.setLimit(store.settings.maxConcurrentRequests); }, [store.settings.maxConcurrentRequests]);
	const sessionTurns = useMemo(
		() => store.turns.filter((turn) => turn.sessionId === activeSessionId),
		[store.turns, activeSessionId],
	);
	const moveKeyboardTurn = (direction: -1 | 1) => {
		if (sessionTurns.length === 0) return;
		const currentIndex = keyboardTurnId ? sessionTurns.findIndex((turn) => turn.id === keyboardTurnId) : direction < 0 ? sessionTurns.length : -1;
		const nextIndex = Math.max(0, Math.min(sessionTurns.length - 1, currentIndex + direction));
		const nextTurn = sessionTurns[nextIndex];
		if (!nextTurn) return;
		setKeyboardTurnId(nextTurn.id);
		document.getElementById(`turn-${nextTurn.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

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

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const container = scrollContainerRef.current;
			if (container) container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [activeSessionId]);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		return bridge.onAgentEvent((event) => {
			if (!event.frontendSessionId) return;
			const turnId = streamingTurnIds.current.get(event.frontendSessionId) ?? [...useAppStore.getState().turns].reverse().find((turn) =>
					turn.sessionId === event.frontendSessionId
					&& turn.role === "assistant"
					&& turn.status !== "complete"
					&& turn.status !== "complete_with_unsynced_knowledge"
					&& turn.status !== "interrupted"
				)?.id;
			if (!turnId) return;
			if (event.type === "message_end" && event.usage) {
				const current = useAppStore.getState().turns.find((turn) => turn.id === turnId);
				const previous = current?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
				useAppStore.getState().updateTurn(turnId, {
					usage: {
						input: previous.input + event.usage.input,
						output: previous.output + event.usage.output,
						cacheRead: previous.cacheRead + event.usage.cacheRead,
						cacheWrite: previous.cacheWrite + event.usage.cacheWrite,
						cost: previous.cost + event.usage.cost,
					},
				});
			}
			if (event.message && event.type === "message_update") {
				const current = useAppStore.getState().turns.find((turn) => turn.id === turnId);
				const field = event.streamKind === "reasoning" ? "reasoning" : "content";
				useAppStore.getState().updateTurn(turnId, {
					[field]: `${current?.[field] ?? ""}${event.message}`,
				});
			}
			if (event.type === "tool_execution_start" && isRecord(event.payload)) {
				const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : crypto.randomUUID();
				const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "tool";
				const current = useAppStore.getState().turns.find((turn) => turn.id === turnId);
				const tool = { id: toolCallId, name: toolName, target: summarizeToolTarget(event.payload.args), status: "running" as const, startedAt: new Date().toISOString() };
				useAppStore.getState().updateTurn(turnId, { tools: [...(current?.tools ?? []).filter((item) => item.id !== toolCallId), tool] });
			}
			if (event.type === "tool_execution_end" && isRecord(event.payload)) {
				const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
				const isError = event.payload.isError === true;
				const current = useAppStore.getState().turns.find((turn) => turn.id === turnId);
				const completedAt = new Date();
				useAppStore.getState().updateTurn(turnId, { tools: (current?.tools ?? []).map((tool) => tool.id === toolCallId ? { ...tool, status: isError ? "error" as const : "complete" as const, completedAt: completedAt.toISOString(), durationMs: Math.max(0, completedAt.getTime() - new Date(tool.startedAt).getTime()) } : tool) });
			}
		});
	}, [activeSessionId]);

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
			const targetTurns = useAppStore.getState().turns.filter((turn) => turn.sessionId === targetSessionId && turn.id !== userTurnId && turn.id !== assistantTurnId);
			const knowledgeContext = buildKnowledgeContext(agentPrompt, useAppStore.getState().entities, useAppStore.getState().relations, useAppStore.getState().diagrams, sourceHits);
			store.updateTurn(assistantTurnId, { status: "running", summary: "Pi agent is running" });
			const targetSession = useAppStore.getState().sessions.find((session) => session.id === targetSessionId);
			streamingTurnIds.current.set(targetSessionId, assistantTurnId);
			const transcript = [...targetTurns, {
				id: userTurnId,
				sessionId: targetSessionId,
				role: "user" as const,
				content: prompt,
				status: "complete" as const,
				summary: summarize(prompt),
				createdAt: now,
			}];
			const result = await bridge.agentPrompt({
				frontendSessionId: targetSessionId,
				parentFrontendSessionId: targetSession?.parentId ?? undefined,
				forkedFromTurnId: targetSession?.forkedFromTurnId,
				transcript: transcript.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content, images: turn.images })),
				prompt: agentPrompt,
				images: promptImages,
				knowledgeContext,
				thinkingLevel: store.settings.thinkingLevel,
				model: selectedModel,
				writable: true,
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
			const extraction = store.settings.autoExtract && store.settings.knowledgeMode !== "read_only"
				? await withTimeout(bridge.extractKnowledge({
					question: agentPrompt,
					answer: response,
					existingEntities: useAppStore.getState().entities
						.filter((entity) => !entity.deletedAt)
						.map((entity) => ({ id: entity.id, name: entity.name, aliases: entity.aliases, type: entity.type, summary: entity.summary, content: entity.content, version: entity.version })),
					existingDiagrams: useAppStore.getState().diagrams
						.filter((diagram) => !diagram.deletedAt)
						.map((diagram) => ({ id: diagram.id, name: diagram.name, type: diagram.type, nodeLabels: diagram.nodes.map((node) => node.label) })),
					model: selectedModel,
				}), auxiliaryRequestTimeoutMs, "Knowledge extraction").catch((error: unknown): KnowledgeExtractionResponse => ({
					entities: [],
					relations: [],
					diagrams: [],
					error: error instanceof Error ? error.message : String(error),
				}))
				: { entities: [], relations: [], diagrams: [], usage: undefined };
			store.addTurnUsage(assistantTurnId, extraction.usage);
			const currentSources = useAppStore.getState().sources;
			const prefetchedSourceRefs = sourceHits.map((hit) => {
				const source = currentSources.find((item) => item.id === hit.sourceId);
				return { sourceId: hit.sourceId, path: hit.path, revision: source?.revision, lineStart: hit.line, lineEnd: hit.line };
			});
			const sourceRefs = result.sourceRefs?.length ? result.sourceRefs : prefetchedSourceRefs;
			store.finalizeTurn(targetSessionId, assistantTurnId, response, extraction.entities, extraction.relations, extraction.diagrams, sourceRefs);
			const generatedSummary = await summaryPromise;
			store.addTurnUsage(assistantTurnId, generatedSummary.usage);
			if (generatedSummary.summary) {
				store.updateTurn(userTurnId, { summary: generatedSummary.summary });
				const session = useAppStore.getState().sessions.find((item) => item.id === targetSessionId);
				if (session?.continuationTitlePending) {
					store.renameContinuation(targetSessionId, generatedSummary.summary);
				} else if (session?.title === "New session" || session?.titlePending || session?.refreshTitleOnNextPrompt) {
					store.renameSession(targetSessionId, generatedSummary.summary);
				}
			}
			store.updateTurn(assistantTurnId, { completedAt: new Date().toISOString() });
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			store.updateTurn(assistantTurnId, {
				content: message,
				status: "complete_with_unsynced_knowledge",
				summary: "Request failed",
				completedAt: new Date().toISOString(),
			});
			store.setSessionStatus(targetSessionId, "error");
			setSendError(message);
		} finally {
			streamingTurnIds.current.delete(targetSessionId);
			const currentState = useAppStore.getState();
			if (currentState.sessions.find((session) => session.id === targetSessionId)?.status !== "error") {
				const hasQueuedOrRunning = currentState.turns.some((turn) => turn.sessionId === targetSessionId && turn.role === "assistant" && ["retrieving", "running", "finalizing"].includes(turn.status));
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
		current.addSessionTitleUsage(result.originalSessionId, originalTitle.usage, true);
		current.addSessionTitleUsage(result.forkSessionId, forkTitle.usage);
		current.renameContinuation(result.originalSessionId, originalTitle.summary ?? "Original path");
		current.renameSession(result.forkSessionId, forkTitle.summary ?? "New branch", true);
	};

	const sendSelectionQuestion = (question: string, selected = selection) => {
		if (!selected || !question.trim()) return;
		const result = store.forkSession(selected.turnId);
		if (!result) return;
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
			<header className="chat-topbar">
				<div className="min-w-0"><h1>{activeSession?.title ?? "New chat"}</h1><span>{store.settings.defaultModel || "GitHub Copilot"}</span></div>
				<button type="button" className={clsx("topbar-button", store.rightPaneOpen && "is-active")} onClick={store.toggleRightPane} title="Toggle knowledge panel" aria-label="Toggle knowledge panel"><PanelRight size={17} /></button>
			</header>
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
			<ChatComposer input={input} images={images} entities={store.entities} diagrams={store.diagrams} isSending={isSending} error={sendError} runtimeCaption={isElectronRuntime() ? `Pi SDK / GitHub Copilot${store.settings.defaultModel ? ` / ${store.settings.defaultModel}` : ""}` : "Electron runtime required for agent execution"} onInputChange={setInput} onImagesChange={setImages} onError={setSendError} onSend={() => void handleSend()} />
			{knowledgePreview && <KnowledgePreviewDialog preview={knowledgePreview} onClose={closePreview} />}
		</div>
	);
};
