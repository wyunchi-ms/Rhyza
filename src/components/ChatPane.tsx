import clsx from "clsx";
import { AlertCircle, Brain, CheckCircle2, ChevronDown, ChevronUp, Copy, GitFork, LoaderCircle, PanelRight, Send, Sparkles } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	isElectronRuntime,
} from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { SourceSearchHit } from "../shared/ipc";
import type { Diagram, Entity, Relation, Turn } from "../types";
import { MermaidDiagram } from "./MermaidDiagram";
import { TurnNavigator } from "./TurnNavigator";

export const ChatPane: React.FC = () => {
	const store = useAppStore();
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const streamingTurnId = useRef<string | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const activeSessionId = store.activeSessionId;
	const activeSession = store.sessions.find((session) => session.id === activeSessionId);
	const sessionTurns = useMemo(
		() => store.turns.filter((turn) => turn.sessionId === activeSessionId),
		[store.turns, activeSessionId],
	);

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
			if (event.frontendSessionId !== activeSessionId || !streamingTurnId.current) return;
			const turnId = streamingTurnId.current;
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
		if (!prompt || !activeSessionId || isSending) return;
		setInput("");
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
			const summaryPromise = bridge.generateSummary({ text: prompt, model: selectedModel });
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
				transcript: transcript.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content })),
				prompt,
				knowledgeContext,
				thinkingLevel: store.settings.thinkingLevel,
				model: selectedModel,
				writable: true,
			});
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
				? await bridge.extractKnowledge({
					question: prompt,
					answer: response,
					existingEntities: useAppStore.getState().entities
						.filter((entity) => !entity.deletedAt)
						.map((entity) => ({ id: entity.id, name: entity.name, aliases: entity.aliases, type: entity.type, summary: entity.summary, content: entity.content, version: entity.version })),
					existingDiagrams: useAppStore.getState().diagrams
						.filter((diagram) => !diagram.deletedAt)
						.map((diagram) => ({ id: diagram.id, name: diagram.name, type: diagram.type, nodeLabels: diagram.nodes.map((node) => node.label) })),
					model: selectedModel,
				})
				: { entities: [], relations: [], diagrams: [] };
			const currentSources = useAppStore.getState().sources;
			const prefetchedSourceRefs = sourceHits.map((hit) => {
				const source = currentSources.find((item) => item.id === hit.sourceId);
				return { sourceId: hit.sourceId, path: hit.path, revision: source?.revision, lineStart: hit.line, lineEnd: hit.line };
			});
			const sourceRefs = result.sourceRefs?.length ? result.sourceRefs : prefetchedSourceRefs;
			store.finalizeTurn(activeSessionId, assistantTurnId, response, extraction.entities, extraction.relations, extraction.diagrams, sourceRefs);
			const generatedSummary = await summaryPromise;
			if (generatedSummary.summary) {
				store.updateTurn(userTurnId, { summary: generatedSummary.summary });
				const session = useAppStore.getState().sessions.find((item) => item.id === activeSessionId);
				if (session?.continuationTitlePending) {
					store.renameContinuation(activeSessionId, generatedSummary.summary);
				} else if (session?.title === "New session" || session?.titlePending || session?.refreshTitleOnNextPrompt) {
					store.renameSession(activeSessionId, generatedSummary.summary);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			store.updateTurn(assistantTurnId, {
				content: message,
				status: "complete_with_unsynced_knowledge",
				summary: "Request failed",
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
						canFork={index < sessionTurns.length - 1}
						onEntityClick={store.setSelectedEntity}
						onDiagramClick={store.setSelectedDiagram}
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
					<textarea
						className="composer-input"
						placeholder="Message KnowBranch"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void handleSend();
							}
						}}
						rows={1}
					/>
					<button type="button" title="Send" aria-label="Send" onClick={() => void handleSend()} disabled={isSending || !input.trim()} className="composer-send">
						{isSending ? <LoaderCircle size={18} className="animate-spin" /> : <Send size={18} />}
					</button>
				</div>
				<div className="composer-caption">
					{isElectronRuntime() ? `Pi SDK / GitHub Copilot${store.settings.defaultModel ? ` / ${store.settings.defaultModel}` : ""}` : "Electron runtime required for agent execution"}
				</div>
				{sendError && <div className="text-center mt-1 text-xs text-red-600">{sendError}</div>}
			</div>
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
	return (
		<article id={`turn-${turn.id}`} className={clsx("chat-turn group", isUser && "is-user")}>
			{!isUser && <div className="assistant-mark"><Sparkles size={14} /></div>}
			<div className={clsx("turn-content", isUser && "items-end")}>
				<div className={clsx("turn-body", isUser ? "user-bubble" : "assistant-body")}>
					{!isUser && <button type="button" title={collapsed ? "Expand response" : "Collapse response"} aria-label={collapsed ? "Expand response" : "Collapse response"} onClick={() => setCollapsed((value) => !value)} className="response-collapse"><ChevronUp size={15} className={clsx("transition-transform", collapsed && "rotate-180")} /></button>}
					{collapsed && !isUser ? <p className="truncate text-sm font-medium text-secondary">{turn.summary || "Assistant response"}</p> : <>
						<TurnStatus status={turn.status} />
						{!isUser && turn.reasoning && <ReasoningBlock content={turn.reasoning} />}
						{!isUser && turn.tools && turn.tools.length > 0 && <ToolCards tools={turn.tools} />}
						{turn.content && (isUser
							? <MarkdownContent content={turn.content} />
							: <LinkifiedContent turn={turn} entities={entities} relations={relations} diagrams={diagrams} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick} />)}
					</>}
				</div>
				<div className={clsx("turn-actions", isUser && "flex-row-reverse")}>
					{canFork && <button type="button" title="Continue from here" aria-label="Continue from here" onClick={onFork}><GitFork size={14} /></button>}
					<button type="button" title="Copy" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(turn.content)}><Copy size={14} /></button>
					{turn.changeSetId && <span className="knowledge-updated">Knowledge updated</span>}
				</div>
			</div>
		</article>
	);
}

function ToolCards({ tools }: { tools: NonNullable<Turn["tools"]> }) {
	return <div className="mb-3 space-y-2">{tools.map((tool) => <details key={tool.id} className="tool-card"><summary><span className="tool-card-icon">{tool.status === "running" ? <LoaderCircle size={14} className="animate-spin" /> : tool.status === "error" ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}</span><span className="min-w-0 flex-1"><strong>{tool.name}</strong>{tool.target && <span>{tool.target}</span>}</span><small>{tool.durationMs === undefined ? tool.status : formatDuration(tool.durationMs)}</small><ChevronDown size={14} /></summary><div className="tool-card-details">Status: {tool.status}{tool.durationMs !== undefined ? ` · ${formatDuration(tool.durationMs)}` : ""}</div></details>)}</div>;
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
