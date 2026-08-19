import clsx from "clsx";
import { AlertCircle, Brain, CheckCircle2, ChevronDown, ChevronUp, Copy, GitFork, ImagePlus, Info, LoaderCircle, PanelRight, Send, Sparkles, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	isElectronRuntime,
} from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { AgentPromptImage, KnowledgeExtractionResponse, SourceSearchHit, SummaryResponse } from "../shared/ipc";
import type { Diagram, Entity, Relation, Turn } from "../types";
import { usageTokens } from "../utils/branchUsage";
import { KnowledgePreviewDialog, type KnowledgePreview } from "./KnowledgePreviewDialog";
import { MermaidDiagram } from "./MermaidDiagram";
import { TurnNavigator } from "./TurnNavigator";

const auxiliaryRequestTimeoutMs = 30_000;
const maxPromptImageBytes = 4_500_000;

export const ChatPane: React.FC = () => {
	const store = useAppStore();
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const [images, setImages] = useState<Array<AgentPromptImage & { id: string; preview: string }>>([]);
	const [knowledgePreview, setKnowledgePreview] = useState<KnowledgePreview | null>(null);
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const streamingTurnId = useRef<string | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const activeSessionId = store.activeSessionId;
	const activeSession = store.sessions.find((session) => session.id === activeSessionId);
	const sessionTurns = useMemo(
		() => store.turns.filter((turn) => turn.sessionId === activeSessionId),
		[store.turns, activeSessionId],
	);
	const openEntityPreview = (id: string) => {
		const entity = store.entities.find((item) => item.id === id && !item.deletedAt);
		if (entity) setKnowledgePreview({ kind: "entity", item: entity });
	};
	const openDiagramPreview = (id: string) => {
		const diagram = store.diagrams.find((item) => item.id === id && !item.deletedAt);
		if (diagram) setKnowledgePreview({ kind: "diagram", item: diagram });
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
			const turnId = event.frontendSessionId === activeSessionId
				? streamingTurnId.current
				: [...useAppStore.getState().turns].reverse().find((turn) =>
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

	const handleSend = async () => {
		const prompt = input.trim();
		if ((!prompt && images.length === 0) || !activeSessionId || isSending) return;
		const promptImages = images.map(({ id: _id, preview: _preview, ...image }) => image);
		setInput("");
		setImages([]);
		setSendError(null);
		const now = new Date().toISOString();
		const userTurnId = createId("turn");
		const assistantTurnId = createId("turn");
		store.addManualTurn({
			id: userTurnId,
			sessionId: activeSessionId,
			role: "user",
			content: prompt,
			status: "complete",
			summary: summarize(prompt),
			images: promptImages,
			createdAt: now,
		});
		streamingTurnId.current = assistantTurnId;
		store.addManualTurn({
			id: assistantTurnId,
			sessionId: activeSessionId,
			role: "assistant",
			content: "",
			status: "retrieving",
			summary: "Retrieving workspace context",
			createdAt: now,
		});
		store.setSessionStatus(activeSessionId, "running");
		setIsSending(true);

		try {
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
			const sourceHits = await bridge.sourceSearch({ query: prompt, limit: 8 });
			const knowledgeContext = buildContextPack(prompt, store.entities, store.relations, store.diagrams, sourceHits);
			store.updateTurn(assistantTurnId, { status: "running", summary: "Pi agent is running" });
			const activeSession = store.sessions.find((session) => session.id === activeSessionId);
			const transcript = [...sessionTurns, {
				id: userTurnId,
				sessionId: activeSessionId,
				role: "user" as const,
				content: prompt,
				status: "complete" as const,
				summary: summarize(prompt),
				createdAt: now,
			}];
			const result = await bridge.agentPrompt({
				frontendSessionId: activeSessionId,
				parentFrontendSessionId: activeSession?.parentId ?? undefined,
				forkedFromTurnId: activeSession?.forkedFromTurnId,
				transcript: transcript.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content, images: turn.images })),
				prompt,
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
					question: prompt,
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
			store.finalizeTurn(activeSessionId, assistantTurnId, response, extraction.entities, extraction.relations, extraction.diagrams, sourceRefs);
			const generatedSummary = await summaryPromise;
			store.addTurnUsage(assistantTurnId, generatedSummary.usage);
			if (generatedSummary.summary) {
				store.updateTurn(userTurnId, { summary: generatedSummary.summary });
				const session = useAppStore.getState().sessions.find((item) => item.id === activeSessionId);
				if (session?.continuationTitlePending) {
					store.renameContinuation(activeSessionId, generatedSummary.summary);
				} else if (session?.title === "New session" || session?.titlePending || session?.refreshTitleOnNextPrompt) {
					store.renameSession(activeSessionId, generatedSummary.summary);
				}
			}
			store.updateTurn(assistantTurnId, { completedAt: new Date().toISOString() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			store.updateTurn(assistantTurnId, {
				content: message,
				status: "complete_with_unsynced_knowledge",
				summary: "Request failed",
				completedAt: new Date().toISOString(),
			});
			store.setSessionStatus(activeSessionId, "error");
			setSendError(message);
		} finally {
			streamingTurnId.current = null;
			if (useAppStore.getState().sessions.find((session) => session.id === activeSessionId)?.status !== "error") {
				store.setSessionStatus(activeSessionId, "idle");
			}
			setIsSending(false);
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

	return (
		<div className="chat-pane">
			<header className="chat-topbar">
				<div className="min-w-0"><h1>{activeSession?.title ?? "New chat"}</h1><span>{store.settings.defaultModel || "GitHub Copilot"}</span></div>
				<button type="button" className={clsx("topbar-button", store.rightPaneOpen && "is-active")} onClick={store.toggleRightPane} title="Toggle knowledge panel" aria-label="Toggle knowledge panel"><PanelRight size={17} /></button>
			</header>
			<div ref={scrollContainerRef} className="chat-scroll">
				{sessionTurns.map((turn, index) => (
					<TurnMessage
						key={turn.id}
						turn={turn}
						entities={store.entities}
						relations={store.relations}
						diagrams={store.diagrams}
						onFork={() => void handleFork(turn, index)}
						canFork={turn.role === "assistant" && index < sessionTurns.length - 1}
						onEntityClick={openEntityPreview}
						onDiagramClick={openDiagramPreview}
					/>
				))}
				{sessionTurns.length === 0 && (
					<div className="chat-empty">
						<div className="brand-mark large"><Sparkles size={20} /></div>
						<h2>What do you want to understand?</h2>
					</div>
				)}
			</div>
			{sessionTurns.length > 1 && <TurnNavigator turns={sessionTurns} scrollContainerRef={scrollContainerRef} />}
			<div className="composer-shell">
				<div className="chat-composer">
				{images.length > 0 && <div className="composer-attachments">{images.map((image) => <div key={image.id} className="composer-attachment"><img src={image.preview} alt="" /><button type="button" title="Remove image" aria-label="Remove image" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}><X size={12} /></button></div>)}</div>}
				<textarea
						className="composer-input"
						placeholder={images.length ? "Add a question about the image" : "Message Rhyza"}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onPaste={(event) => {
							const imageFiles = [...event.clipboardData.items]
								.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
								.map((item) => item.getAsFile())
								.filter((file): file is File => file !== null);
							if (imageFiles.length === 0) return;
							event.preventDefault();
							const files = new DataTransfer();
							imageFiles.forEach((file) => files.items.add(file));
							void readPromptImages(files.files).then((next) => {
								setSendError(null);
								setImages((current) => [...current, ...next].slice(0, 4));
							}).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)));
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void handleSend();
							}
						}}
						rows={1}
					/>
					<button type="button" title="Attach image" aria-label="Attach image" onClick={() => imageInputRef.current?.click()} disabled={isSending} className="composer-attach"><ImagePlus size={17} /></button>
					<input ref={imageInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={(event) => { void readPromptImages(event.target.files).then((next) => { setSendError(null); setImages((current) => [...current, ...next].slice(0, 4)); }).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error))); event.currentTarget.value = ""; }} />
					<button type="button" title="Send" aria-label="Send" onClick={() => void handleSend()} disabled={isSending || (!input.trim() && images.length === 0)} className="composer-send">
						{isSending ? <LoaderCircle size={18} className="animate-spin" /> : <Send size={18} />}
					</button>
				</div>
				<div className="composer-caption">
					{isElectronRuntime() ? `Pi SDK / GitHub Copilot${store.settings.defaultModel ? ` / ${store.settings.defaultModel}` : ""}` : "Electron runtime required for agent execution"}
				</div>
				{sendError && <div className="text-center mt-1 text-xs text-red-600">{sendError}</div>}
			</div>
			{knowledgePreview && <KnowledgePreviewDialog preview={knowledgePreview} onClose={() => setKnowledgePreview(null)} />}
		</div>
	);
};

function TurnMessage({ turn, entities, relations, diagrams, onFork, canFork, onEntityClick, onDiagramClick }: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onFork: () => void;
	canFork: boolean;
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
}) {
	const isUser = turn.role === "user";
	const [collapsed, setCollapsed] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	useEffect(() => {
		if (!detailsOpen) return;
		const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsOpen(false); };
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [detailsOpen]);
	return (
		<article id={`turn-${turn.id}`} className={clsx("chat-turn group", isUser && "is-user")}>
			{!isUser && <div className="assistant-mark"><Sparkles size={14} /></div>}
			<div className={clsx("turn-content", isUser ? "items-end" : "w-full")}>
				<div className={clsx("turn-body", isUser ? "user-bubble" : "assistant-body")}>
					{!isUser && <button type="button" title={collapsed ? "Expand response" : "Collapse response"} aria-label={collapsed ? "Expand response" : "Collapse response"} onClick={() => setCollapsed((value) => !value)} className="response-collapse"><ChevronUp size={15} className={clsx("transition-transform", collapsed && "rotate-180")} /></button>}
					{collapsed && !isUser ? <p className="truncate text-sm font-medium text-secondary">{turn.summary || "Assistant response"}</p> : <>
						<TurnStatus status={turn.status} />
						{!isUser && turn.reasoning && <ReasoningBlock content={turn.reasoning} />}
						{!isUser && turn.tools && turn.tools.length > 0 && <ToolCards tools={turn.tools} />}
						{isUser && turn.images?.length ? <UserImageAttachments images={turn.images} /> : null}
						{turn.content && (isUser
							? <MarkdownContent content={turn.content} />
							: <LinkifiedContent turn={turn} entities={entities} relations={relations} diagrams={diagrams} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick} />)}
					</>}
				</div>
				<div className={clsx("turn-actions", isUser && "flex-row-reverse")}>
					{!isUser && canFork && <button type="button" title="Continue from here" aria-label="Continue from here" onClick={onFork}><GitFork size={14} /></button>}
					<button type="button" title="Copy" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(turn.content)}><Copy size={14} /></button>
					{turn.changeSetId && <span className="knowledge-updated">Knowledge updated</span>}
					{!isUser && <button type="button" className="turn-detail-trigger" title="Turn details" aria-label="Show turn usage details" onClick={() => setDetailsOpen(true)}><Info size={14} /></button>}
				</div>
			</div>
			{detailsOpen && <TurnDetailsDialog turn={turn} onClose={() => setDetailsOpen(false)} />}
		</article>
	);
}

function UserImageAttachments({ images }: { images: NonNullable<Turn["images"]> }) {
	return <div className="user-message-images">{images.map((image, index) => <img key={`${image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt={`Attached image ${index + 1}`} />)}</div>;
}

function TurnDetailsDialog({ turn, onClose }: { turn: Turn; onClose: () => void }) {
	const inherited = !turn.usage && Boolean(turn.inheritedUsage);
	const usage = turn.usage ?? turn.inheritedUsage;
	const cacheableInput = (usage?.input ?? 0) + (usage?.cacheRead ?? 0);
	const cacheHitRate = cacheableInput > 0 ? (usage!.cacheRead / cacheableInput) * 100 : undefined;
	const elapsedMs = Math.max(0, new Date(turn.completedAt ?? new Date().toISOString()).getTime() - new Date(turn.createdAt).getTime());
	const tools = Object.values((turn.tools ?? []).reduce<Record<string, { name: string; count: number; errors: number; durationMs: number }>>((groups, tool) => {
		const group = groups[tool.name] ?? { name: tool.name, count: 0, errors: 0, durationMs: 0 };
		group.count += 1;
		group.errors += tool.status === "error" ? 1 : 0;
		group.durationMs += tool.durationMs ?? 0;
		groups[tool.name] = group;
		return groups;
	}, {}));
	const toolDuration = tools.reduce((sum, tool) => sum + tool.durationMs, 0);
	return (
		<div className="turn-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className="turn-detail-dialog" role="dialog" aria-modal="true" aria-labelledby={`turn-detail-title-${turn.id}`}>
				<header><div><h2 id={`turn-detail-title-${turn.id}`}>Turn details</h2><p>{inherited ? "Inherited shared history · excluded from this branch total" : usage ? "Usage for this assistant turn only" : "Usage was not recorded for this turn"}</p></div><button type="button" onClick={onClose} title="Close" aria-label="Close turn details"><X size={17} /></button></header>
				<div className="turn-detail-summary">
					<DetailMetric label="Tokens" value={usage ? usageTokens(usage).toLocaleString() : "Not recorded"} />
					<DetailMetric label="Elapsed" value={formatDuration(elapsedMs)} />
					<DetailMetric label="Cost" value={usage ? (usage.cost < 0.0001 && usage.cost > 0 ? "<$0.0001" : `$${usage.cost.toFixed(4)}`) : "Not recorded"} />
				</div>
				<div className="turn-detail-section"><h3>Token breakdown</h3><dl className="turn-detail-grid"><DetailRow label="Input" value={usage?.input} /><DetailRow label="Output" value={usage?.output} /><DetailRow label="Cache read" value={usage?.cacheRead} /><DetailRow label="Cache write" value={usage?.cacheWrite} /><DetailRow label="Cache hit rate" value={cacheHitRate === undefined ? undefined : `${cacheHitRate.toFixed(1)}%`} title={cacheHitRate === undefined ? undefined : `Cache read ${usage!.cacheRead.toLocaleString()} ÷ cacheable input ${cacheableInput.toLocaleString()}`} /></dl></div>
				<div className="turn-detail-section"><h3>Tool calls <span>{turn.tools?.length ?? 0} total · {formatDuration(toolDuration)}</span></h3>{tools.length ? <div className="turn-tool-list">{tools.map((tool) => <div key={tool.name}><strong>{tool.name}</strong><span>{tool.count} call{tool.count === 1 ? "" : "s"}{tool.errors ? ` · ${tool.errors} failed` : ""} · {formatDuration(tool.durationMs)}</span></div>)}</div> : <p className="turn-detail-empty">No tools were called.</p>}</div>
			</section>
		</div>
	);
}

const DetailMetric = ({ label, value }: { label: string; value: string }) => <div><span>{label}</span><strong>{value}</strong></div>;
const DetailRow = ({ label, value, title }: { label: string; value?: number | string; title?: string }) => <div title={title}><dt>{label}</dt><dd>{value === undefined ? "—" : typeof value === "number" ? value.toLocaleString() : value}</dd></div>;

function ToolCards({ tools }: { tools: NonNullable<Turn["tools"]> }) {
	const running = tools.filter((tool) => tool.status === "running").length;
	const errors = tools.filter((tool) => tool.status === "error").length;
	const summary = running ? `${running} running` : errors ? `${errors} failed` : "completed";
	return (
		<details className="tools-section mb-3">
			<summary>
				{running ? <LoaderCircle size={14} className="animate-spin" /> : errors ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
				<strong>Tools</strong>
				<small>{tools.length} call{tools.length === 1 ? "" : "s"} · {summary}</small>
				<ChevronDown size={14} className="tools-chevron" />
			</summary>
			<div className="tools-section-content space-y-2">
				{tools.map((tool) => <details key={tool.id} className="tool-card"><summary><span className="tool-card-icon">{tool.status === "running" ? <LoaderCircle size={14} className="animate-spin" /> : tool.status === "error" ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}</span><span className="min-w-0 flex-1"><strong>{tool.name}</strong>{tool.target && <span>{tool.target}</span>}</span><small>{tool.durationMs === undefined ? tool.status : formatDuration(tool.durationMs)}</small><ChevronDown size={14} /></summary><div className="tool-card-details">Status: {tool.status}{tool.durationMs !== undefined ? ` · ${formatDuration(tool.durationMs)}` : ""}</div></details>)}
			</div>
		</details>
	);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} timed out after ${formatDuration(timeoutMs)}.`)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function TurnStatus({ status }: { status: Turn["status"] }) {
	if (status === "interrupted") {
		return <div className="mb-3 flex items-center gap-2 text-sm text-amber-700"><AlertCircle size={15} /> Previous run was interrupted</div>;
	}
	if (status !== "retrieving" && status !== "running" && status !== "finalizing") return null;
	return (
		<div className="mb-3 flex items-center gap-2 text-sm text-secondary">
			<LoaderCircle size={15} className="animate-spin" />
			{status === "finalizing" ? "Organizing knowledge" : status === "retrieving" ? "Retrieving knowledge" : "Agent is working"}
		</div>
	);
}

async function readPromptImages(files: FileList | null): Promise<Array<AgentPromptImage & { id: string; preview: string }>> {
	if (!files) return [];
	return Promise.all([...files].slice(0, 4).map(async (file) => {
		if (!(new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"])).has(file.type)) throw new Error(`${file.name} is not a supported image type.`);
		if (file.size > maxPromptImageBytes) throw new Error(`${file.name} exceeds the 4.5 MB image limit.`);
		const preview = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
			reader.onload = () => resolve(String(reader.result));
			reader.readAsDataURL(file);
		});
		const separator = preview.indexOf(",");
		if (separator < 0) throw new Error(`Invalid image data for ${file.name}.`);
		return { id: crypto.randomUUID(), preview, mimeType: file.type as AgentPromptImage["mimeType"], data: preview.slice(separator + 1) };
	}));
}

function ReasoningBlock({ content }: { content: string }) {
	return (
		<details className="reasoning-block mb-3">
			<summary className="flex cursor-pointer select-none items-center gap-2 py-1.5 text-xs font-bold text-secondary">
				<Brain size={14} /> Reasoning
				<ChevronDown size={14} className="reasoning-chevron ml-auto" />
			</summary>
			<div className="border-l-2 border-gray-200 pl-3 pt-2 text-secondary">
				<MarkdownContent content={content} compact />
			</div>
		</details>
	);
}

function LinkifiedContent({ turn, entities, relations, diagrams, onEntityClick, onDiagramClick }: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
}) {
	const references = useMemo(() => buildKnowledgeReferences(entities, relations, diagrams), [entities, relations, diagrams]);
	return <MarkdownContent content={turn.content} references={references} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick} />;
}

type KnowledgeReference = { kind: "entity" | "diagram"; id: string; labels: string[]; title: string; type: string; summary: string; relationCount: number; sourceCount: number };
const emptyKnowledgeReferences: KnowledgeReference[] = [];

function MarkdownContent({ content, compact = false, references, onEntityClick, onDiagramClick }: {
	content: string;
	compact?: boolean;
	references?: KnowledgeReference[];
	onEntityClick?: (id: string) => void;
	onDiagramClick?: (id: string) => void;
}) {
	const knowledgeReferences = references ?? emptyKnowledgeReferences;
	const remarkPlugins = useMemo<NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>>(
		() => [remarkGfm, [remarkKnowledgeLinks, { references: knowledgeReferences }]],
		[knowledgeReferences],
	);
	const components = useMemo<NonNullable<React.ComponentProps<typeof ReactMarkdown>["components"]>>(
		() => ({
			pre: ({ children }) => <>{children}</>,
			code: ({ className, children, ...props }) => {
				const rawSource = String(children);
				const source = rawSource.replace(/\n$/, "");
				if (!compact && /(?:^|\s)language-mermaid(?:\s|$)/.test(className ?? "")) {
					return <MermaidDiagram source={source} />;
				}
				const isBlock = Boolean(className) || rawSource.includes("\n");
				return isBlock
					? <pre><code className={className} {...props}>{children}</code></pre>
					: <code className={className} {...props}>{children}</code>;
			},
			a: ({ href, children }) => <KnowledgeAnchor href={href} references={knowledgeReferences} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick}>{children}</KnowledgeAnchor>,
		}),
		[compact, knowledgeReferences, onDiagramClick, onEntityClick],
	);
	return (
		<div className={clsx("markdown-body", compact && "markdown-compact")}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

function KnowledgeAnchor({ href, references, children, onEntityClick, onDiagramClick }: { href?: string; references: KnowledgeReference[]; children: React.ReactNode; onEntityClick?: (id: string) => void; onDiagramClick?: (id: string) => void }) {
	const [hovered, setHovered] = useState(false);
	const timer = useRef<number | null>(null);
	const reference = href?.startsWith("#knowledge/") ? references.find((item) => href.endsWith(encodeURIComponent(item.id))) : undefined;
	const open = () => { timer.current = window.setTimeout(() => setHovered(true), 300); };
	const close = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHovered(false), 150); };
	return <span className="knowledge-link-wrap" onMouseEnter={open} onMouseLeave={close}><a href={href} onFocus={() => setHovered(Boolean(reference))} onBlur={() => setHovered(false)} onClick={(event) => {
		if (href?.startsWith("#knowledge/entity/")) { event.preventDefault(); onEntityClick?.(decodeURIComponent(href.slice("#knowledge/entity/".length))); }
		else if (href?.startsWith("#knowledge/diagram/")) { event.preventDefault(); onDiagramClick?.(decodeURIComponent(href.slice("#knowledge/diagram/".length))); }
		else if (href?.startsWith("http")) { event.preventDefault(); void getKnowbranchBridge()?.openExternal({ url: href }); }
	}}>{children}</a>{hovered && reference && <span role="tooltip" className="knowledge-hover-card" onMouseEnter={() => { if (timer.current !== null) window.clearTimeout(timer.current); }} onMouseLeave={close}><span className="flex items-center justify-between gap-3"><strong>{reference.title}</strong><small>{reference.type}</small></span><span className="mt-1 line-clamp-2">{reference.summary}</span><small className="mt-2 block">{reference.relationCount} relations · {reference.sourceCount} sources</small></span>}</span>;
}

interface MarkdownNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
}

function remarkKnowledgeLinks({ references }: { references: KnowledgeReference[] }) {
	const labels = references
		.flatMap((reference) => reference.labels.map((label) => ({ label: label.trim(), reference })))
		.filter(({ label }) => label.length > 0)
		.sort((left, right) => right.label.length - left.label.length);
	const referenceByLabel = new Map(labels.map(({ label, reference }) => [label.toLocaleLowerCase(), reference]));
	const pattern = labels.length > 0
		? new RegExp(labels.map(({ label }) => escapeRegExp(label)).join("|"), "giu")
		: null;

	return (tree: MarkdownNode) => {
		if (pattern) transformMarkdownChildren(tree, pattern, referenceByLabel);
	};
}

function transformMarkdownChildren(
	node: MarkdownNode,
	pattern: RegExp,
	referenceByLabel: Map<string, KnowledgeReference>,
): void {
	if (["link", "linkReference", "code", "inlineCode", "html"].includes(node.type) || !node.children) return;
	const transformed: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type !== "text" || !child.value) {
			transformMarkdownChildren(child, pattern, referenceByLabel);
			transformed.push(child);
			continue;
		}
		let cursor = 0;
		pattern.lastIndex = 0;
		for (const match of child.value.matchAll(pattern)) {
			const index = match.index ?? 0;
			if (index > cursor) transformed.push({ type: "text", value: child.value.slice(cursor, index) });
			const label = match[0];
			const reference = referenceByLabel.get(label.toLocaleLowerCase());
			transformed.push(reference
				? {
					type: "link",
					url: `#knowledge/${reference.kind}/${encodeURIComponent(reference.id)}`,
					children: [{ type: "text", value: label }],
				}
				: { type: "text", value: label });
			cursor = index + label.length;
		}
		if (cursor === 0) transformed.push(child);
		else if (cursor < child.value.length) transformed.push({ type: "text", value: child.value.slice(cursor) });
	}
	node.children = transformed;
}

function buildKnowledgeReferences(entities: Entity[], relations: Relation[], diagrams: Diagram[]): KnowledgeReference[] {
	return [
		...entities.filter((entity) => !entity.deletedAt).map((entity) => ({
			kind: "entity" as const,
			id: entity.id,
			labels: [entity.name, ...entity.aliases],
			title: entity.name,
			type: entity.type,
			summary: entity.summary,
			relationCount: relations.filter((relation) => !relation.deletedAt && (relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id)).length,
			sourceCount: entity.sourceRefs.length,
		})),
		...diagrams.filter((diagram) => !diagram.deletedAt).map((diagram) => ({
			kind: "diagram" as const,
			id: diagram.id,
			labels: [diagram.name],
			title: diagram.name,
			type: diagram.type,
			summary: `${diagram.nodes.length} nodes and ${diagram.edges.length} edges`,
			relationCount: diagram.edges.length,
			sourceCount: diagram.sourceRefs?.length ?? 0,
		})),
	];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createId(prefix: string) {
	return `${prefix}_${crypto.randomUUID()}`;
}

function summarize(value: string) {
	const firstLine = value.trim().split(/\r?\n/)[0] ?? "Untitled";
	return firstLine.length > 36 ? `${firstLine.slice(0, 33)}...` : firstLine;
}

function summarizeToolTarget(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of ["path", "pattern", "command", "query", "file", "directory"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim().replace(/\s+/g, " ").slice(0, 160);
	}
	return undefined;
}

function formatDuration(durationMs: number): string {
	return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildContextPack(
	prompt: string,
	entities: Entity[],
	relations: Relation[],
	diagrams: Diagram[],
	sourceHits: SourceSearchHit[],
) {
	const lowerPrompt = prompt.toLocaleLowerCase();
	const terms = lowerPrompt.split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 2);
	const ranked = entities
		.filter((entity) => !entity.deletedAt)
		.map((entity) => {
			const names = [entity.name, ...entity.aliases].map((name) => name.toLocaleLowerCase());
			const exact = names.some((name) => lowerPrompt.includes(name));
			const searchable = `${entity.name} ${entity.aliases.join(" ")} ${entity.type} ${entity.summary}`.toLocaleLowerCase();
			const overlap = terms.filter((term) => searchable.includes(term)).length;
			return { entity, score: (exact ? 100 : 0) + overlap * 10 };
		})
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, 8)
		.map(({ entity }) => `${entity.id} | ${entity.name} | ${entity.type} | ${entity.confidence} | ${entity.summary}`);
	const selectedIds = new Set(entities.filter((entity) => ranked.some((line) => line.startsWith(entity.id))).map((entity) => entity.id));
	const relationLines = relations.filter((relation) => !relation.deletedAt && (selectedIds.has(relation.sourceEntityId) || selectedIds.has(relation.targetEntityId))).slice(0, 12).map((relation) => `${relation.sourceEntityId} -[${relation.type}]-> ${relation.targetEntityId}`);
	for (const relation of relations.filter((item) => !item.deletedAt)) {
		if (selectedIds.has(relation.sourceEntityId)) selectedIds.add(relation.targetEntityId);
		if (selectedIds.has(relation.targetEntityId)) selectedIds.add(relation.sourceEntityId);
	}
	const diagramLines = diagrams
		.filter((diagram) => !diagram.deletedAt && (lowerPrompt.includes(diagram.name.toLocaleLowerCase()) || diagram.nodes.some((node) => node.entityId && selectedIds.has(node.entityId))))
		.slice(0, 5)
		.map((diagram) => `${diagram.id} | ${diagram.name} | ${diagram.type} | v${diagram.version} | ${diagram.nodes.map((node) => node.label).slice(0, 12).join(", ")}`);
	const sourceLines = sourceHits.map((hit) => `${hit.path}:${hit.line} | ${hit.preview}`);
	return [`Entities:\n${ranked.join("\n") || "None"}`, `Relations:\n${relationLines.join("\n") || "None"}`, `Diagrams:\n${diagramLines.join("\n") || "None"}`, `Source matches:\n${sourceLines.join("\n") || "None"}`].join("\n\n");
}
