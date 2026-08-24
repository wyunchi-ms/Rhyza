import clsx from "clsx";
import { AlertCircle, Brain, CheckCircle2, ChevronDown, ChevronUp, Copy, GitFork, Info, LoaderCircle, Sparkles, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getKnowbranchBridge } from "../../hooks/useKnowbranchBridge";
import type { Diagram, Entity, Relation, Turn } from "../../types";
import { usageTokens } from "../../utils/branchUsage";
import { formatDuration } from "../../utils/common";
import { isMermaidCodeBlock } from "../../utils/mermaidSource";
import { MermaidDiagram } from "../MermaidDiagram";

export function TurnMessage({ turn, entities, relations, diagrams, onFork, canFork, onEntityClick, onDiagramClick, onTextSelection, isKeyboardActive }: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onFork: () => void;
	canFork: boolean;
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
	onTextSelection: (text: string, rect: DOMRect) => void;
	isKeyboardActive: boolean;
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
		<article id={`turn-${turn.id}`} data-turn-id={turn.id} className={clsx("chat-turn group", isUser && "is-user", isKeyboardActive && "is-keyboard-active")}>
			{!isUser && <div className="assistant-mark"><Sparkles size={14} /></div>}
			<div className={clsx("turn-content", isUser ? "items-end" : "w-full")}>
				<div className={clsx("turn-body", isUser ? "user-bubble" : "assistant-body")}>
					{!isUser && <button type="button" title={collapsed ? "Expand response" : "Collapse response"} aria-label={collapsed ? "Expand response" : "Collapse response"} onClick={() => setCollapsed((value) => !value)} className="response-collapse"><ChevronUp size={15} className={clsx("transition-transform", collapsed && "rotate-180")} /></button>}
					{collapsed && !isUser ? <p className="truncate text-sm font-medium text-secondary">{turn.summary || "Assistant response"}</p> : <>
						<TurnStatus status={turn.status} />
						{!isUser && <TurnWorkDetails turn={turn} />}
						{isUser && turn.quote && <blockquote className="user-message-quote">{turn.quote.text}</blockquote>}
						{isUser && turn.images?.length ? <UserImageAttachments images={turn.images} /> : null}
						{turn.content && <LinkifiedContent turn={turn} entities={entities} relations={relations} diagrams={diagrams} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick} onTextSelection={isUser ? undefined : onTextSelection} />}
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

function TurnWorkDetails({ turn }: { turn: Turn }) {
	const elapsedMs = Math.max(0, new Date(turn.completedAt ?? new Date()).getTime() - new Date(turn.createdAt).getTime());
	return <details className="turn-work-details"><summary><span>Worked for {formatDuration(elapsedMs)}</span><ChevronDown size={14} /></summary><div className="turn-work-details-content">
		{turn.reasoning ? <ReasoningBlock content={turn.reasoning} /> : <p className="turn-work-empty">No reasoning was recorded for this turn.</p>}
		{turn.tools?.length ? <ToolCards tools={turn.tools} /> : <p className="turn-work-empty">No tools were called.</p>}
	</div></details>;
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

function LinkifiedContent({ turn, entities, relations, diagrams, onEntityClick, onDiagramClick, onTextSelection }: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
	onTextSelection?: (text: string, rect: DOMRect) => void;
}) {
	const references = useMemo(() => buildKnowledgeReferences(entities, relations, diagrams), [entities, relations, diagrams]);
	return <MarkdownContent content={turn.content} references={references} onEntityClick={onEntityClick} onDiagramClick={onDiagramClick} onTextSelection={onTextSelection} />;
}

type KnowledgeReference = { kind: "entity" | "diagram"; id: string; labels: string[]; title: string; type: string; summary: string; relationCount: number; sourceCount: number };
const emptyKnowledgeReferences: KnowledgeReference[] = [];

function MarkdownContent({ content, compact = false, references, onEntityClick, onDiagramClick, onTextSelection }: {
	content: string;
	compact?: boolean;
	references?: KnowledgeReference[];
	onEntityClick?: (id: string) => void;
	onDiagramClick?: (id: string) => void;
	onTextSelection?: (text: string, rect: DOMRect) => void;
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
				if (!compact && isMermaidCodeBlock(className, source)) {
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
		<div className={clsx("markdown-body", compact && "markdown-compact")} onMouseUp={(event) => {
			if (!onTextSelection || compact) return;
			const selected = window.getSelection();
			if (!selected || selected.isCollapsed || !selected.toString().trim()) return;
			const range = selected.getRangeAt(0);
			if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
			onTextSelection(selected.toString().trim(), range.getBoundingClientRect());
		}}>
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
