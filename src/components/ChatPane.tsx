import clsx from "clsx";
import { ListChecks, LoaderCircle } from "lucide-react";
import appIcon from "../../resources/branding/icon.png";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { getRhyzaBridge, isElectronRuntime } from "../hooks/useRhyzaBridge";
import { useAppStore } from "../store";
import type { KnowledgeExtractionResponse, SummaryResponse } from "../shared/ipc";
import type { Turn } from "../types";
import { requestScheduler } from "../utils/requestScheduler";
import { useKnowledgePreviewActions } from "../hooks/useKnowledgePreview";
import { useAgentEventStream } from "../hooks/useAgentEventStream";
import { useConversationNavigation } from "../hooks/useConversationNavigation";
import { createId, summarize, withTimeout } from "../utils/common";
import { buildAgentTranscriptBeforeTurn } from "../utils/agentTranscript";
import { selectionContinuationTarget } from "../utils/sessionFork";
import {
	createSelectionAppendDebugSnapshot,
	forkDebugEventName,
	type ForkDebugEventDetail,
} from "../utils/forkDebug";
import {
	failRunningTurnActivities,
	finishTurnActivity,
	startTurnActivity,
} from "../utils/turnActivity";
import {
	buildKnowledgeInventory,
	prioritizeKnowledgeSourceRefs,
	sourceHitsToRefs,
} from "../utils/knowledgeExtraction";
import { isSessionRunning } from "../utils/sessionRuntime";
import { branchSwitchEndEvent, branchSwitchStartEvent } from "../utils/branchSwitch";
import { errorToMessage } from "../shared/value";
import { getProviderInfo, providerModelSelection } from "../shared/providers";
import { SelectionAskPopover, type TextSelectionAnchor } from "./chat/SelectionAskPopover";
import { ChatComposer, type ComposerImage } from "./chat/ChatComposer";
import { ConversationFind } from "./chat/ConversationFind";
import { TurnMessage } from "./chat/TurnMessage";
import { TurnContextMenu, type TurnContextMenuState } from "./chat/TurnContextMenu";
import { TurnNavigator } from "./TurnNavigator";
import { recordPerformanceTiming } from "../utils/performanceMarks";
import { isLightweightGreeting } from "../utils/promptWorkPolicy";

const auxiliaryRequestTimeoutMs = 30_000;

export const ChatPane: React.FC = () => {
	const renderStartedAt = performance.now();
	const store = useAppStore();
	const [input, setInput] = useState("");
	const [pendingRequests, setPendingRequests] = useState(0);
	const [sendError, setSendError] = useState<string | null>(null);
	const [forkDebugStatus, setForkDebugStatus] = useState<ForkDebugEventDetail | null>(null);
	const [images, setImages] = useState<ComposerImage[]>([]);
	const [selection, setSelection] = useState<TextSelectionAnchor | null>(null);
	const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
	const [turnContextMenu, setTurnContextMenu] = useState<TurnContextMenuState | null>(null);
	const activeSessionId = store.activeSessionId;
	const isSending = pendingRequests > 0;
	const activeSession = store.sessions.find((session) => session.id === activeSessionId);
	const { registerStreamingTurn, unregisterStreamingTurn } = useAgentEventStream();
	const {
		scrollContainerRef,
		focusedTurnId,
		setFocusedTurnId,
		sessionTurns,
		turnSessionMap,
		moveKeyboardTurn,
	} = useConversationNavigation(store.turns, activeSessionId, store.sessions);
	const { openEntityById: openEntityPreview, openDiagramById: openDiagramPreview } =
		useKnowledgePreviewActions();
	useLayoutEffect(() => {
		recordPerformanceTiming("chat-render-commit", performance.now() - renderStartedAt);
	});
	useEffect(() => {
		requestScheduler.setLimit(store.settings.maxConcurrentRequests);
	}, [store.settings.maxConcurrentRequests]);
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
		const onForkDebug = (event: Event) =>
			setForkDebugStatus((event as CustomEvent<ForkDebugEventDetail>).detail);
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

	const handleSend = async (options?: {
		sessionId?: string;
		selectedText?: string;
		quotedTurnId?: string;
		question?: string;
	}) => {
		const prompt = (options?.question ?? input).trim();
		const targetSessionId = options?.sessionId ?? activeSessionId;
		if ((!prompt && images.length === 0) || !targetSessionId) return;
		const promptImages = images.map(({ id: _id, preview: _preview, ...image }) => image);
		const lightweightGreeting = isLightweightGreeting(prompt, {
			hasImages: promptImages.length > 0,
			hasSelection: Boolean(options?.selectedText),
		});
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
			quote:
				options?.selectedText && options.quotedTurnId
					? { turnId: options.quotedTurnId, text: options.selectedText }
					: undefined,
			createdAt: now,
		});
		store.addManualTurn({
			id: assistantTurnId,
			sessionId: targetSessionId,
			role: "assistant",
			content: "",
			status: "queued",
			summary: "Queued behind the previous message",
			activities: startTurnActivity(undefined, "queue", "Waiting for the previous message", now),
			createdAt: now,
		});
		store.setSessionStatus(targetSessionId, "running");
		setPendingRequests((count) => count + 1);

		try {
			await requestScheduler.enqueue(targetSessionId, async () => {
				const bridge = getRhyzaBridge();
				if (!bridge) throw new Error("Chat requires the Electron desktop runtime.");
				const queuedTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
				const retrievalLabel = lightweightGreeting
					? "Skipping workspace retrieval for a greeting"
					: "Retrieving workspace context";
				store.updateTurn(assistantTurnId, {
					status: "retrieving",
					summary: retrievalLabel,
					activities: startTurnActivity(
						finishTurnActivity(
							queuedTurn?.activities,
							"queue",
							"complete",
							"Previous message completed",
						),
						"retrieval",
						retrievalLabel,
					),
				});
				const selectedModel = providerModelSelection(store.settings);
				const provider = getProviderInfo(selectedModel.providerId);
				// Automatic titles should never add a second model turn to the critical path.
				// Users can still request semantic title regeneration from the session tree.
				const summaryPromise = Promise.resolve<SummaryResponse>({ summary: summarize(prompt) });
				const sourceHits = lightweightGreeting
					? []
					: await bridge.sourceSearch({ query: agentPrompt, limit: 8 });
				const retrievedTurn = useAppStore
					.getState()
					.turns.find((turn) => turn.id === assistantTurnId);
				store.updateTurn(assistantTurnId, {
					activities: startTurnActivity(
						finishTurnActivity(
							retrievedTurn?.activities,
							"retrieval",
							"complete",
							lightweightGreeting
								? "Skipped for a standalone greeting"
								: `${sourceHits.length} source match${sourceHits.length === 1 ? "" : "es"}`,
						),
						"agent",
						"Generating response",
					),
				});
				const currentTurns = useAppStore.getState().turns;
				const transcript = buildAgentTranscriptBeforeTurn(
					currentTurns,
					targetSessionId,
					userTurnId,
				);
				const knowledgeInventory = buildKnowledgeInventory(
					useAppStore.getState().entities,
					useAppStore.getState().diagrams,
				);
				store.updateTurn(assistantTurnId, {
					status: "running",
					summary: `${provider.label} is running`,
				});
				const targetSession = useAppStore
					.getState()
					.sessions.find((session) => session.id === targetSessionId);
				registerStreamingTurn(targetSessionId, assistantTurnId);
				const result = await bridge.agentPrompt({
					frontendSessionId: targetSessionId,
					frontendTurnId: assistantTurnId,
					parentFrontendSessionId: targetSession?.parentId ?? undefined,
					forkedFromTurnId: targetSession?.forkedFromTurnId,
					transcript,
					prompt: agentPrompt,
					images: promptImages,
					knowledgeTools: !lightweightGreeting && store.settings.knowledgeTools,
					knowledgeInventory,
					thinkingLevel: lightweightGreeting ? "off" : store.settings.thinkingLevel,
					model: selectedModel,
					writable: true,
				});
				const agentTurn = useAppStore.getState().turns.find((turn) => turn.id === assistantTurnId);
				store.updateTurn(assistantTurnId, {
					activities: finishTurnActivity(
						agentTurn?.activities,
						"agent",
						result.ok ? "complete" : "error",
						result.ok ? undefined : result.error,
					),
				});
				if (result.usage) store.updateTurn(assistantTurnId, { usage: result.usage });
				if (!result.ok) throw new Error(result.error || `${provider.label} request failed.`);
				const response = result.assistantText || `${provider.label} completed without text output.`;
				const streamedReasoning = useAppStore
					.getState()
					.turns.find((turn) => turn.id === assistantTurnId)?.reasoning;
				store.updateTurn(assistantTurnId, {
					content: response,
					htmlPreviews: result.htmlPreviews,
					reasoning: result.reasoningText ?? streamedReasoning,
					status: "finalizing",
					summary: summarize(response),
				});
				const shouldExtractKnowledge =
					!lightweightGreeting &&
					store.settings.autoExtract &&
					store.settings.knowledgeMode !== "read_only";
				if (shouldExtractKnowledge) {
					const currentTurn = useAppStore
						.getState()
						.turns.find((turn) => turn.id === assistantTurnId);
					store.updateTurn(assistantTurnId, {
						activities: startTurnActivity(
							currentTurn?.activities,
							"knowledge",
							"Updating workspace knowledge",
						),
					});
				}
				const extractionRequestId = createId("aux-knowledge");
				const extraction = shouldExtractKnowledge
					? await withTimeout(
							bridge.extractKnowledge({
								question: agentPrompt,
								answer: response,
								requestId: extractionRequestId,
								...buildKnowledgeInventory(
									useAppStore.getState().entities,
									useAppStore.getState().diagrams,
								),
								model: selectedModel,
							}),
							auxiliaryRequestTimeoutMs,
							"Knowledge extraction",
							async () => {
								await bridge.cancelAuxiliaryRequest({ requestId: extractionRequestId });
							},
						).catch((error: unknown): KnowledgeExtractionResponse => ({
							entities: [],
							relations: [],
							diagrams: [],
							error: errorToMessage(error),
						}))
					: { entities: [], relations: [], diagrams: [], usage: undefined };
				if (shouldExtractKnowledge) {
					const currentTurn = useAppStore
						.getState()
						.turns.find((turn) => turn.id === assistantTurnId);
					const extractedCount =
						extraction.entities.length + extraction.relations.length + extraction.diagrams.length;
					store.updateTurn(assistantTurnId, {
						activities: finishTurnActivity(
							currentTurn?.activities,
							"knowledge",
							extraction.error ? "warning" : "complete",
							extraction.error ??
								`${extractedCount} knowledge candidate${extractedCount === 1 ? "" : "s"}`,
						),
					});
				}
				store.addTurnUsage(assistantTurnId, extraction.usage);
				const prefetchedSourceRefs = sourceHitsToRefs(sourceHits, useAppStore.getState().sources);
				const sourceRefs = prioritizeKnowledgeSourceRefs(
					[...prefetchedSourceRefs, ...(result.sourceRefs ?? [])],
					agentPrompt,
				);
				store.finalizeTurn(
					targetSessionId,
					assistantTurnId,
					response,
					extraction.entities,
					extraction.relations,
					extraction.diagrams,
					sourceRefs,
				);
				const generatedSummary = await summaryPromise;
				store.addTurnUsage(assistantTurnId, generatedSummary.usage);
				if (generatedSummary.summary) {
					store.updateTurn(userTurnId, { summary: generatedSummary.summary });
					const session = useAppStore
						.getState()
						.sessions.find((item) => item.id === targetSessionId);
					if (
						session?.title === "New session" ||
						session?.titlePending ||
						session?.refreshTitleOnNextPrompt
					) {
						store.renameSession(targetSessionId, generatedSummary.summary);
					}
				}
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
			if (
				currentState.sessions.find((session) => session.id === targetSessionId)?.status !== "error"
			) {
				const hasQueuedOrRunning = isSessionRunning(currentState.turns, targetSessionId);
				store.setSessionStatus(targetSessionId, hasQueuedOrRunning ? "running" : "idle");
			}
			setPendingRequests((count) => Math.max(0, count - 1));
		}
	};

	const handleFork = async (turn: Turn, index: number) => {
		const result = store.forkSession(turn.id);
		if (!result) return;
		const bridge = getRhyzaBridge();
		if (!bridge) return;
		const model = providerModelSelection(store.settings);
		const originalText =
			sessionTurns
				.slice(index + 1)
				.filter((item) => item.role === "user")
				.map((item) => item.content)
				.join("\n") ||
			sessionTurns
				.slice(index + 1)
				.map((item) => item.content)
				.join("\n");
		const forkText =
			[...sessionTurns.slice(0, index + 1)].reverse().find((item) => item.role === "user")
				?.content ?? turn.content;
		const [originalTitle, forkTitle] = await Promise.all([
			bridge.generateSummary({ text: originalText, model }),
			bridge.generateSummary({ text: forkText, model }),
		]);
		const current = useAppStore.getState();
		if (result.originalSessionId !== result.branchPointSessionId) {
			current.addSessionTitleUsage(result.originalSessionId, originalTitle.usage);
		}
		current.addSessionTitleUsage(result.branchPointSessionId, forkTitle.usage);
		const originalSession = current.sessions.find(
			(session) => session.id === result.originalSessionId,
		);
		if (result.originalSessionId !== result.branchPointSessionId) {
			current.renameSession(
				result.originalSessionId,
				originalTitle.summary ?? originalSession?.title ?? "Conversation",
			);
		}
		const branchPoint = current.sessions.find(
			(session) => session.id === result.branchPointSessionId,
		);
		current.renameSession(
			result.branchPointSessionId,
			forkTitle.summary ?? branchPoint?.title ?? "Conversation",
		);
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
			const dumpWriter = getRhyzaBridge()?.forkDebugDump;
			if (typeof dumpWriter === "function") {
				void dumpWriter({
					kind: "selection-append",
					timestamp: snapshot.timestamp,
					selectedTurnId: selected.turnId,
					snapshot,
				}).then(
					(response) =>
						setForkDebugStatus({
							ok: true,
							message: `No fork was created (leaf node). Decision dump: ${response.path}`,
						}),
					(error: unknown) =>
						setForkDebugStatus({
							ok: false,
							message: `Selection dump failed: ${errorToMessage(error)}`,
						}),
				);
			} else {
				setForkDebugStatus({
					ok: false,
					message:
						"Selection dump unavailable. Restart Electron to load the updated preload bridge.",
				});
			}
			setSelection(null);
			void handleSend({
				sessionId: target.sessionId,
				selectedText: selected.text,
				quotedTurnId: selected.turnId,
				question,
			});
			return;
		}
		const result = current.forkSession(selected.turnId);
		if (!result) {
			setSendError("The selected conversation point could not be forked.");
			return;
		}
		setSelection(null);
		void handleSend({
			sessionId: result.forkSessionId,
			selectedText: selected.text,
			quotedTurnId: selected.turnId,
			question,
		});
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
				<div className="min-w-0">
					<h1>{activeSession?.title ?? "New chat"}</h1>
				</div>
				<button
					type="button"
					className={clsx(
						"topbar-button",
						store.rightPaneOpen && store.rightPaneView === "todo" && "is-active",
					)}
					onClick={store.toggleRightPane}
					title="Show workspace TODOs"
					aria-label="Show workspace TODOs"
				>
					<ListChecks size={17} />
				</button>
			</header>
			{isSwitchingBranch && (
				<div className="branch-switch-loading" role="status" aria-live="polite">
					<LoaderCircle size={22} aria-hidden="true" />
					<div>
						<strong>Opening branch…</strong>
						<span>Preparing the latest conversation</span>
					</div>
				</div>
			)}
			<div
				ref={scrollContainerRef}
				className="chat-scroll"
				tabIndex={0}
				role="region"
				aria-label="Conversation. Use up and down arrow keys to move between turns."
				onPointerDown={(event) => {
					const target = event.target as Element | null;
					if (target?.closest("button, a, input, textarea, select, [contenteditable='true']"))
						return;
					const turnId = target?.closest<HTMLElement>("[data-turn-id]")?.dataset.turnId;
					if (turnId) setFocusedTurnId(turnId);
					event.currentTarget.focus({ preventScroll: true });
				}}
				onKeyDown={(event) => {
					if (
						event.target !== event.currentTarget ||
						(event.key !== "ArrowUp" && event.key !== "ArrowDown")
					)
						return;
					event.preventDefault();
					moveKeyboardTurn(event.key === "ArrowUp" ? -1 : 1);
				}}
			>
				{sessionTurns.map((turn, index) => (
					<TurnMessage
						key={turn.id}
						turn={turn}
						sessionNodeId={turnSessionMap.get(turn.id) ?? turn.sessionId}
						isFocused={turn.id === focusedTurnId}
						entities={store.entities}
						relations={store.relations}
						diagrams={store.diagrams}
						onFork={() => void handleFork(turn, index)}
						canFork={turn.role === "assistant" && index < sessionTurns.length - 1}
						onEntityClick={openEntityPreview}
						onDiagramClick={openDiagramPreview}
						onTextSelection={(text, rect) =>
							setSelection({
								turnId: turn.id,
								text,
								x: rect.left + rect.width / 2,
								y: rect.bottom + 8,
							})
						}
						onOpenContextMenu={({ x, y }) => setTurnContextMenu({ turnId: turn.id, x, y })}
					/>
				))}
				{sessionTurns.length === 0 && (
					<div className="chat-empty">
						<img className="brand-mark large" src={appIcon} alt="" width={40} height={40} />
						<h2>What do you want to understand?</h2>
					</div>
				)}
			</div>
			{turnContextMenu &&
				(() => {
					const selectedTurn = store.turns.find((turn) => turn.id === turnContextMenu.turnId);
					if (!selectedTurn) return null;
					return (
						<TurnContextMenu
							menu={turnContextMenu}
							turn={selectedTurn}
							onClose={() => setTurnContextMenu(null)}
							onSelect={(view) => {
								const selectedIndex = sessionTurns.findIndex((turn) => turn.id === selectedTurn.id);
								const inspectorTurn =
									selectedTurn.role === "user"
										? (sessionTurns
												.slice(selectedIndex + 1)
												.find((turn) => turn.role === "assistant") ?? selectedTurn)
										: selectedTurn;
								store.openTurnInspector(inspectorTurn.id, view);
								setTurnContextMenu(null);
							}}
						/>
					);
				})()}
			{selection && (
				<SelectionAskPopover
					selection={selection}
					onAsk={sendSelectionQuestion}
					onClose={() => setSelection(null)}
				/>
			)}
			{sessionTurns.length > 1 && (
				<TurnNavigator turns={sessionTurns} scrollContainerRef={scrollContainerRef} />
			)}
			{forkDebugStatus && (
				<div className={clsx("fork-debug-status", !forkDebugStatus.ok && "is-error")} role="status">
					{forkDebugStatus.message}
				</div>
			)}
			<ChatComposer
				input={input}
				images={images}
				entities={store.entities}
				diagrams={store.diagrams}
				contextRequest={sessionTurns.flatMap((turn) => turn.modelRequests ?? []).slice(-1)[0]}
				isSending={isSending}
				error={sendError}
				runtimeCaption={
					isElectronRuntime()
						? getProviderInfo(store.settings.provider).runtimeLabel
						: "Electron runtime required for agent execution"
				}
				onInputChange={setInput}
				onImagesChange={setImages}
				onError={setSendError}
				onSend={() => void handleSend()}
			/>
		</div>
	);
};
