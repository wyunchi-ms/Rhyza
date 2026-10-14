import { HtmlPreviewReference } from "../HtmlPreview";
import { isHtmlPreviewBlock, type HtmlPreviewDocument } from "../../shared/html-preview";
import {
	cacheHitDescription,
	formatCacheHitRate,
	resolveTurnUsage,
	usageMetrics,
} from "../../utils/usageMetrics";
import clsx from "clsx";
import {
	AlertCircle,
	Brain,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Copy,
	GitFork,
	Info,
	LoaderCircle,
	Pencil,
	Quote,
	RotateCcw,
	Sparkles,
} from "lucide-react";
import React, {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { createPortal, flushSync } from "react-dom";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { getRhyzaBridge } from "../../hooks/useRhyzaBridge";
import { useTranslation } from "../../i18n";
import { useAppStore } from "../../store";
import { parseReferences } from "../../utils/composerInput";
import type { Diagram, Entity, Relation, Turn, TurnActivity } from "../../types";
import { usageTokens } from "../../utils/branchUsage";
import { formatChatTimestamp, formatFullChatTimestamp } from "../../utils/chatTimestamp";
import { formatDuration } from "../../utils/common";
import { toolLabel } from "../../utils/toolLabel";
import { isMermaidCodeBlock } from "../../utils/mermaidSource";
import {
	isMarkdownCodeBlock,
	normalizeMarkdownEmphasis,
	normalizeMarkdownMathDelimiters,
} from "../../utils/markdown";
import { markdownRehypePlugins } from "../../utils/markdownHtml";
import {
	markdownHeadingSelector,
	rehypeMarkdownSections,
	remarkMarkdownSections,
	revealMarkdownHeadingEvent,
	revealMarkdownDetails,
} from "../../utils/markdownSections";
import { MermaidDiagram } from "../MermaidDiagram";
import { isTurnActive, isTurnFailed, turnExecutionLabel } from "../../utils/sessionRuntime";
import { errorToMessage } from "../../shared/value";
import { recordPerformanceTiming } from "../../utils/performanceMarks";
import { PathSummarySources } from "../PathSummarySources";
import "./markdownSections.css";

export const TurnMessage = memo(function TurnMessage({
	turn,
	sessionNodeId,
	entities,
	relations,
	diagrams,
	onFork,
	canFork,
	onEntityClick,
	onDiagramClick,
	onTextSelection,
	onOpenContextMenu,
	isFocused,
	onRetry,
	onEditRetry,
	recoveryDisabled = false,
}: {
	turn: Turn;
	sessionNodeId: string;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onFork: (turn: Turn) => void;
	canFork: boolean;
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
	onTextSelection: (turnId: string, text: string, rect: DOMRect) => void;
	onOpenContextMenu: (turnId: string, position: { x: number; y: number }) => void;
	isFocused: boolean;
	onRetry?: (turn: Turn) => void;
	onEditRetry?: (turn: Turn) => void;
	recoveryDisabled?: boolean;
}) {
	const { t } = useTranslation();
	const renderStartedAt = performance.now();
	useLayoutEffect(() => {
		recordPerformanceTiming("chat-turn-render-commit", performance.now() - renderStartedAt);
	});
	const selectText = useCallback(
		(text: string, rect: DOMRect) => {
			onTextSelection(turn.id, text, rect);
		},
		[turn.id, onTextSelection],
	);
	const isUser = turn.role === "user";
	const timestamp = formatChatTimestamp(turn.createdAt);
	const fullTimestamp = formatFullChatTimestamp(turn.createdAt);
	const [collapsed, setCollapsed] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [detailsPinned, setDetailsPinned] = useState(false);
	const [detailsPlacement, setDetailsPlacement] = useState<"top" | "bottom">("top");
	const detailsTrigger = useRef<HTMLButtonElement>(null);
	const detailsCloseTimer = useRef<number | null>(null);
	const [copyState, setCopyState] = useState<string | null>(null);
	const revealResponse = useCallback(() => setCollapsed(false), []);
	const updateDetailsPlacement = useCallback(() => {
		const bounds = detailsTrigger.current?.getBoundingClientRect();
		if (bounds) {
			setDetailsPlacement(
				bounds.top + bounds.height / 2 > window.innerHeight / 2 ? "bottom" : "top",
			);
		}
	}, []);
	const openDetailsPopover = useCallback(() => {
		if (detailsCloseTimer.current !== null) window.clearTimeout(detailsCloseTimer.current);
		detailsCloseTimer.current = null;
		updateDetailsPlacement();
		setDetailsOpen(true);
	}, [updateDetailsPlacement]);
	const scheduleDetailsClose = useCallback(() => {
		if (detailsPinned) return;
		if (detailsCloseTimer.current !== null) window.clearTimeout(detailsCloseTimer.current);
		detailsCloseTimer.current = window.setTimeout(() => {
			detailsCloseTimer.current = null;
			setDetailsOpen(false);
		}, 650);
	}, [detailsPinned]);
	useEffect(
		() => () => {
			if (detailsCloseTimer.current !== null) window.clearTimeout(detailsCloseTimer.current);
		},
		[],
	);
	useEffect(() => {
		if (!detailsOpen) return;
		const dismiss = (event: KeyboardEvent | PointerEvent) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") {
				setDetailsPinned(false);
				setDetailsOpen(false);
				detailsTrigger.current?.blur();
			}
			if (
				detailsPinned &&
				event instanceof PointerEvent &&
				event.target instanceof Element &&
				!event.target.closest(".turn-detail-popover-anchor, .turn-detail-popover")
			) {
				setDetailsPinned(false);
				setDetailsOpen(false);
			}
		};
		document.addEventListener("keydown", dismiss);
		document.addEventListener("pointerdown", dismiss);
		return () => {
			document.removeEventListener("keydown", dismiss);
			document.removeEventListener("pointerdown", dismiss);
		};
	}, [detailsOpen, detailsPinned]);
	return (
		<article
			id={`turn-${turn.id}`}
			data-turn-id={turn.id}
			data-session-node-id={sessionNodeId}
			aria-current={isFocused ? "true" : undefined}
			className={clsx("chat-turn group", isUser && "is-user", isFocused && "is-focused")}
			onContextMenu={(event) => {
				event.preventDefault();
				onOpenContextMenu(turn.id, { x: event.clientX, y: event.clientY });
			}}
		>
			{!isUser && (
				<div className="assistant-mark">
					<Sparkles size={14} />
				</div>
			)}
			<div className={clsx("turn-content", isUser ? "items-end" : "w-full")}>
				<div className={clsx("turn-body", isUser ? "user-bubble" : "assistant-body")}>
					{!isUser && (
						<button
							type="button"
							title={collapsed ? "Expand response" : "Collapse response"}
							aria-label={collapsed ? "Expand response" : "Collapse response"}
							onClick={() => setCollapsed((value) => !value)}
							className="response-collapse"
							aria-expanded={!collapsed}
							style={{ opacity: 1 }}
						>
							<ChevronUp
								size={15}
								className={clsx("transition-transform", collapsed && "rotate-180")}
							/>
						</button>
					)}
					{collapsed && !isUser && (
						<p className="truncate text-sm font-medium text-secondary">
							{turn.summary || "Assistant response"}
						</p>
					)}
					<div className="turn-expanded-content" hidden={collapsed && !isUser}>
						{isUser && turn.pathSummary && <PathSummarySources snapshot={turn.pathSummary} />}
						<TurnBubbleContent
							turn={turn}
							entities={entities}
							relations={relations}
							diagrams={diagrams}
							onEntityClick={onEntityClick}
							onDiagramClick={onDiagramClick}
							onTextSelection={selectText}
							collapsibleSections={!isUser}
							onRevealHeading={revealResponse}
						/>
					</div>
				</div>
				<div className={clsx("turn-actions", isUser && "flex-row-reverse")}>
					{timestamp && (
						<time className="turn-timestamp" dateTime={turn.createdAt} title={fullTimestamp}>
							{timestamp}
						</time>
					)}
					{!isUser && canFork && (
						<button
							type="button"
							title="Continue from here"
							aria-label="Continue from here"
							onClick={() => onFork(turn)}
						>
							<GitFork size={14} />
						</button>
					)}
					<button
						type="button"
						title="Copy"
						aria-label="Copy"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(turn.content);
								setCopyState("Copied");
							} catch (error) {
								setCopyState(`Could not copy: ${errorToMessage(error)}`);
							}
						}}
					>
						<Copy size={14} />
					</button>
					{copyState && <span role="status">{copyState}</span>}
					{!isUser && (isTurnFailed(turn) || turn.status === "interrupted") && onRetry && (
						<div className="turn-recovery-actions">
							<button
								type="button"
								className="icon-button turn-recovery-action"
								aria-label={t("Retry")}
								disabled={recoveryDisabled}
								title={
									recoveryDisabled
										? t("Wait for this chat to finish.")
										: t("Resend the original question and attachments")
								}
								onClick={() => onRetry(turn)}
							>
								<RotateCcw size={14} aria-hidden="true" />
							</button>
							<button
								type="button"
								className="icon-button turn-recovery-action"
								aria-label={t("Edit and retry")}
								disabled={recoveryDisabled}
								title={
									recoveryDisabled
										? t("Wait for this chat to finish.")
										: t("Edit the original question before resending")
								}
								onClick={() => onEditRetry?.(turn)}
							>
								<Pencil size={14} aria-hidden="true" />
							</button>
						</div>
					)}
					{turn.changeSetId && <span className="knowledge-updated">Knowledge updated</span>}
					{!isUser && (
						<span
							className="turn-detail-popover-anchor"
							onPointerEnter={(event) => {
								if (event.pointerType !== "touch") openDetailsPopover();
							}}
							onPointerLeave={scheduleDetailsClose}
						>
							<button
								ref={detailsTrigger}
								type="button"
								className="turn-detail-trigger"
								aria-label={t("Turn details")}
								aria-describedby={`turn-detail-popover-${turn.id}`}
								aria-controls={`turn-detail-popover-${turn.id}`}
								aria-expanded={detailsOpen}
								onFocus={openDetailsPopover}
								onBlur={scheduleDetailsClose}
								onClick={() => {
									if (detailsPinned) {
										setDetailsPinned(false);
										setDetailsOpen(false);
									} else {
										openDetailsPopover();
										setDetailsPinned(true);
									}
								}}
							>
								<Info size={14} />
							</button>
						</span>
					)}
				</div>
			</div>
			{detailsOpen && (
				<TurnDetailsPopover
					turn={turn}
					placement={detailsPlacement}
					onPointerEnter={openDetailsPopover}
					onPointerLeave={scheduleDetailsClose}
				/>
			)}
		</article>
	);
});

/** Shared by the transcript and node hover previews; no transcript identity or actions. */
export function TurnBubbleContent({
	turn,
	entities,
	relations,
	diagrams,
	onEntityClick,
	onDiagramClick,
	onTextSelection,
	collapsibleSections = false,
	onRevealHeading,
}: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
	onTextSelection?: (text: string, rect: DOMRect) => void;
	collapsibleSections?: boolean;
	onRevealHeading?: () => void;
}) {
	const isUser = turn.role === "user";
	return (
		<>
			<TurnStatus turn={turn} />
			{!isUser && <TurnWorkDetails turn={turn} />}
			{isUser && turn.quote && (
				<blockquote className="user-message-quote" aria-label="Quoted passage">
					<span className="user-message-quote-label">
						<Quote size={13} aria-hidden="true" />
						Quoted passage
					</span>
					<span className="user-message-quote-text">{turn.quote.text}</span>
				</blockquote>
			)}
			{isUser && turn.images?.length ? <UserImageAttachments images={turn.images} /> : null}
			{turn.content && (
				<div data-turn-search-content>
					<LinkifiedContent
						turn={turn}
						entities={entities}
						relations={relations}
						diagrams={diagrams}
						onEntityClick={onEntityClick}
						onDiagramClick={onDiagramClick}
						onTextSelection={isUser ? undefined : onTextSelection}
						collapsibleSections={!isUser && collapsibleSections}
						onRevealHeading={onRevealHeading}
					/>
				</div>
			)}
		</>
	);
}

function TurnWorkDetails({ turn }: { turn: Turn }) {
	const { t } = useTranslation();
	const elapsedMs = Math.max(
		0,
		new Date(turn.completedAt ?? new Date()).getTime() - new Date(turn.createdAt).getTime(),
	);
	const activities = turn.activities?.length ? turn.activities : fallbackTurnActivities(turn);
	return (
		<details className="turn-work-details">
			<summary>
				<span>
					{t(turnExecutionLabel(turn))} · {formatDuration(elapsedMs)}
				</span>
				<ChevronDown size={14} />
			</summary>
			<div className="turn-work-details-content">
				{activities.length > 0 && <TurnActivityTimeline activities={activities} />}
				{turn.reasoning && <ReasoningBlock content={turn.reasoning} />}
				{turn.tools?.length ? <ToolCards tools={turn.tools} /> : null}
				{!turn.reasoning && !turn.tools?.length && !isTurnActive(turn) && (
					<p className="turn-work-note">
						This model did not expose reasoning or agent tool calls for this turn.
					</p>
				)}
			</div>
		</details>
	);
}

function fallbackTurnActivities(turn: Turn): TurnActivity[] {
	if (!isTurnActive(turn)) return [];
	const label =
		turn.status === "queued"
			? "Waiting for the previous message"
			: turn.status === "retrieving"
				? "Retrieving workspace context"
				: turn.status === "finalizing"
					? "Updating workspace knowledge"
					: "Generating response";
	return [
		{
			id:
				turn.status === "queued"
					? "queue"
					: turn.status === "retrieving"
						? "retrieval"
						: turn.status === "finalizing"
							? "knowledge"
							: "agent",
			label,
			status: "running",
			startedAt: turn.createdAt,
		},
	];
}

function TurnActivityTimeline({ activities }: { activities: TurnActivity[] }) {
	return (
		<ol className="turn-activity-timeline" aria-label="Turn execution timeline">
			{activities.map((activity) => (
				<li key={activity.id} className={`is-${activity.status}`}>
					<span className="turn-activity-icon">
						{activity.status === "running" ? (
							<LoaderCircle size={13} className="animate-spin" />
						) : activity.status === "error" || activity.status === "warning" ? (
							<AlertCircle size={13} />
						) : (
							<CheckCircle2 size={13} />
						)}
					</span>
					<span className="turn-activity-copy">
						<strong>{activity.label}</strong>
						{activity.detail && <small>{activity.detail}</small>}
					</span>
					<small className="turn-activity-duration">
						{activity.durationMs === undefined
							? activity.status
							: formatDuration(activity.durationMs)}
					</small>
				</li>
			))}
		</ol>
	);
}

function UserImageAttachments({ images }: { images: NonNullable<Turn["images"]> }) {
	return (
		<div className="user-message-images">
			{images.map((image, index) => (
				<img
					key={`${image.mimeType}-${index}`}
					src={`data:${image.mimeType};base64,${image.data}`}
					alt={`Attached image ${index + 1}`}
				/>
			))}
		</div>
	);
}

function TurnDetailsPopover({
	turn,
	placement,
	onPointerEnter,
	onPointerLeave,
}: {
	turn: Turn;
	placement: "top" | "bottom";
	onPointerEnter: () => void;
	onPointerLeave: () => void;
}) {
	const { t } = useTranslation();
	const { usage } = resolveTurnUsage(turn);
	const { cacheHitRate } = usageMetrics(usage);
	const elapsedMs = Math.max(
		0,
		new Date(turn.completedAt ?? new Date().toISOString()).getTime() -
			new Date(turn.createdAt).getTime(),
	);
	const tools = Object.values(
		(turn.tools ?? []).reduce<
			Record<string, { name: string; count: number; errors: number; durationMs: number }>
		>((groups, tool) => {
			const group = groups[tool.name] ?? { name: tool.name, count: 0, errors: 0, durationMs: 0 };
			group.count += 1;
			group.errors += tool.status === "error" ? 1 : 0;
			group.durationMs += tool.durationMs ?? 0;
			groups[tool.name] = group;
			return groups;
		}, {}),
	);
	const toolDuration = tools.reduce((sum, tool) => sum + tool.durationMs, 0);
	return createPortal(
		<div
			id={`turn-detail-popover-${turn.id}`}
			className={`turn-detail-popover turn-detail-popover-${placement}`}
			role="tooltip"
			aria-label={t("Turn details")}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
		>
			<div className="turn-detail-summary">
				<DetailMetric
					label="Tokens"
					value={usage ? usageTokens(usage).toLocaleString() : "Not recorded"}
				/>
				<DetailMetric label="Elapsed" value={formatDuration(elapsedMs)} />
				<DetailMetric
					label="Cost"
					value={
						usage
							? usage.cost < 0.0001 && usage.cost > 0
								? "<$0.0001"
								: `$${usage.cost.toFixed(4)}`
							: "Not recorded"
					}
				/>
			</div>
			<div className="turn-detail-section">
				<h3>Token breakdown</h3>
				<dl className="turn-detail-grid">
					<DetailRow label="Input" value={usage?.input} />
					<DetailRow label="Output" value={usage?.output} />
					<DetailRow label="Cache read" value={usage?.cacheRead} />
					<DetailRow label="Cache write" value={usage?.cacheWrite} />
					<DetailRow
						label="Cache hit rate"
						value={cacheHitRate === undefined ? undefined : formatCacheHitRate(cacheHitRate)}
						title={cacheHitRate === undefined ? undefined : cacheHitDescription}
					/>
				</dl>
			</div>
			<div className="turn-detail-section">
				<h3>
					Tool calls{" "}
					<span>
						{turn.tools?.length ?? 0} total · {formatDuration(toolDuration)}
					</span>
				</h3>
				{tools.length ? (
					<div className="turn-tool-list">
						{tools.map((tool) => (
							<div key={tool.name}>
								<strong title={tool.name}>{toolLabel(tool.name)}</strong>
								<span>
									{tool.count} call{tool.count === 1 ? "" : "s"}
									{tool.errors ? ` · ${tool.errors} failed` : ""} ·{" "}
									{formatDuration(tool.durationMs)}
								</span>
							</div>
						))}
					</div>
				) : (
					<p className="turn-detail-empty">No tools were called.</p>
				)}
			</div>
		</div>,
		document.body,
	);
}

const DetailMetric = ({ label, value }: { label: string; value: string }) => (
	<div>
		<span>{label}</span>
		<strong>{value}</strong>
	</div>
);
const DetailRow = ({
	label,
	value,
	title,
}: {
	label: string;
	value?: number | string;
	title?: string;
}) => (
	<div title={title}>
		<dt>{label}</dt>
		<dd>
			{value === undefined ? "—" : typeof value === "number" ? value.toLocaleString() : value}
		</dd>
	</div>
);

function ToolCards({ tools }: { tools: NonNullable<Turn["tools"]> }) {
	const running = tools.filter((tool) => tool.status === "running").length;
	const errors = tools.filter((tool) => tool.status === "error").length;
	const warnings = tools.filter((tool) => tool.status !== "error" && tool.warning).length;
	const summary = running
		? `${running} running`
		: [
				errors ? `${errors} failed` : "",
				warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
			]
				.filter(Boolean)
				.join(" · ") || "completed";
	return (
		<details
			className={clsx(
				"tools-section mb-3",
				errors ? "has-errors" : warnings ? "has-warnings" : !running && "has-complete",
			)}
		>
			<summary>
				{running ? (
					<LoaderCircle size={14} className="animate-spin" />
				) : errors ? (
					<AlertCircle size={14} />
				) : warnings ? (
					<AlertCircle size={14} />
				) : (
					<CheckCircle2 size={14} />
				)}
				<strong>Tools</strong>
				<small>
					{tools.length} call{tools.length === 1 ? "" : "s"} · {summary}
				</small>
				<ChevronDown size={14} className="tools-chevron" />
			</summary>
			<div className="tools-section-content space-y-2">
				{tools.map((tool) => {
					const severity =
						tool.status === "error" ? "error" : tool.warning ? "warning" : tool.status;
					const statusLabel =
						severity === "error"
							? "Failed"
							: severity === "warning"
								? "Warning"
								: severity === "running"
									? "Running"
									: "Completed";
					return (
						<details key={tool.id} className={`tool-card is-${severity}`}>
							<summary>
								<span className="tool-card-icon">
									{severity === "running" ? (
										<LoaderCircle size={14} className="animate-spin" />
									) : severity === "error" || severity === "warning" ? (
										<AlertCircle size={14} />
									) : (
										<CheckCircle2 size={14} />
									)}
								</span>
								<span className="min-w-0 flex-1">
									<strong title={tool.name}>{toolLabel(tool.name)}</strong>
									{tool.target && <span>{tool.target}</span>}
								</span>
								<small className="tool-card-status">
									{statusLabel}
									{tool.durationMs !== undefined ? ` · ${formatDuration(tool.durationMs)}` : ""}
								</small>
								<ChevronDown size={14} />
							</summary>
							<div className="tool-card-details">
								{tool.output ? (
									<pre>{tool.output}</pre>
								) : (
									<p>No output was captured for this tool call.</p>
								)}
							</div>
						</details>
					);
				})}
			</div>
		</details>
	);
}

function TurnStatus({ turn }: { turn: Turn }) {
	const { status } = turn;
	if (isTurnFailed(turn)) {
		return (
			<div className="turn-execution-error" role="alert">
				<AlertCircle size={15} /> Request failed. Retry the original question or edit it before
				resending.
			</div>
		);
	}
	if (status === "interrupted") {
		return (
			<div className="mb-3 flex items-center gap-2 text-sm text-amber-700">
				<AlertCircle size={15} /> Previous run was interrupted
			</div>
		);
	}
	if (
		!isTurnActive(status) &&
		(status === "complete_with_unsynced_knowledge" ||
			turn.activities?.some((activity) => activity.status === "warning"))
	) {
		return (
			<div className="turn-execution-warning" role="status">
				<AlertCircle size={15} /> Response completed; knowledge update needs attention. See work
				details.
			</div>
		);
	}
	if (!isTurnActive(status)) return null;
	return (
		<div className="mb-3 flex items-center gap-2 text-sm text-secondary">
			<LoaderCircle size={15} className="animate-spin" />
			{status === "queued"
				? "Queued"
				: status === "finalizing"
					? "Organizing knowledge"
					: status === "retrieving"
						? "Retrieving knowledge"
						: "Agent is working"}
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

function LinkifiedContent({
	turn,
	entities,
	relations,
	diagrams,
	onEntityClick,
	onDiagramClick,
	onTextSelection,
	collapsibleSections,
	onRevealHeading,
}: {
	turn: Turn;
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	onEntityClick: (id: string) => void;
	onDiagramClick: (id: string) => void;
	onTextSelection?: (text: string, rect: DOMRect) => void;
	collapsibleSections?: boolean;
	onRevealHeading?: () => void;
}) {
	const references = useMemo(
		() => buildKnowledgeReferences(entities, relations, diagrams),
		[entities, relations, diagrams],
	);
	return (
		<MarkdownContent
			htmlPreviews={turn.htmlPreviews}
			content={turn.content}
			finalized={!isTurnActive(turn)}
			references={references}
			onEntityClick={onEntityClick}
			onDiagramClick={onDiagramClick}
			onTextSelection={onTextSelection}
			collapsibleSections={collapsibleSections}
			onRevealHeading={onRevealHeading}
		/>
	);
}

type KnowledgeReference = {
	kind: "entity" | "diagram";
	id: string;
	labels: string[];
	title: string;
	type: string;
	summary: string;
	relationCount: number;
	sourceCount: number;
};
const emptyKnowledgeReferences: KnowledgeReference[] = [];

interface MarkdownRenderContextValue {
	htmlPreviews?: HtmlPreviewDocument[];
	compact: boolean;
	finalized: boolean;
	renderMarkdownFences: boolean;
	references: KnowledgeReference[];
	onEntityClick?: (id: string) => void;
	onDiagramClick?: (id: string) => void;
}

const MarkdownRenderContext = React.createContext<MarkdownRenderContextValue>({
	compact: false,
	finalized: true,
	renderMarkdownFences: true,
	references: emptyKnowledgeReferences,
});

const MarkdownSectionContext = React.createContext<{
	collapsedIds: ReadonlySet<string>;
	toggle: (id: string) => void;
}>({ collapsedIds: new Set(), toggle: () => {} });

function MarkdownHeading({
	node,
	children,
	className,
	...props
}: React.ComponentProps<"h2"> & { node?: import("hast").Element }) {
	const { collapsedIds, toggle } = React.useContext(MarkdownSectionContext);
	const Heading = (node?.tagName ?? "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
	const id = node?.properties.dataMarkdownHeadingId;
	if (typeof id !== "string") {
		return (
			<Heading className={className} {...props}>
				{children}
			</Heading>
		);
	}
	const expanded = !collapsedIds.has(id);
	const label = String(node?.properties.dataMarkdownHeadingText || "Untitled");
	return (
		<Heading
			{...props}
			className={clsx(className, "markdown-section-heading")}
			onClick={(event) => {
				if (
					(event.target instanceof Element &&
						event.target.closest("a, button, input, select, textarea, [role='button']")) ||
					window.getSelection()?.isCollapsed === false
				) {
					return;
				}
				toggle(id);
			}}
		>
			<button
				type="button"
				className="markdown-section-toggle"
				aria-expanded={expanded}
				aria-controls={`${id}-body`}
				aria-label={`${expanded ? "Collapse" : "Expand"} ${label} section`}
				onClick={() => toggle(id)}
			>
				<ChevronDown size={16} aria-hidden="true" />
			</button>
			<span className="markdown-section-heading-text">{children}</span>
		</Heading>
	);
}

// Stable component types preserve iframe documents and diagram state across parent updates.
const markdownComponents: NonNullable<React.ComponentProps<typeof ReactMarkdown>["components"]> = {
	h1: MarkdownHeading,
	h2: MarkdownHeading,
	h3: MarkdownHeading,
	h4: MarkdownHeading,
	h5: MarkdownHeading,
	h6: MarkdownHeading,
	div: function MarkdownDiv({ node, children, ...props }) {
		const { collapsedIds } = React.useContext(MarkdownSectionContext);
		const id = node?.properties.dataMarkdownSectionBody;
		return (
			<div {...props} hidden={typeof id === "string" ? collapsedIds.has(id) : undefined}>
				{children}
			</div>
		);
	},
	pre: ({ children }) => <>{children}</>,
	code: function MarkdownCode({ node: _node, className, children, ...props }) {
		const {
			compact,
			finalized,
			htmlPreviews,
			renderMarkdownFences,
			references,
			onEntityClick,
			onDiagramClick,
		} = React.useContext(MarkdownRenderContext);
		const rawSource = String(children);
		const source = rawSource.replace(/\n$/, "");
		if (!compact && isMermaidCodeBlock(className, source)) {
			return <MermaidDiagram source={source} />;
		}
		if (!compact && isHtmlPreviewBlock(className)) {
			return (
				<HtmlPreviewReference source={source} documents={htmlPreviews} finalized={finalized} />
			);
		}
		const isBlock = Boolean(className) || rawSource.includes("\n");
		const renderMarkdown = renderMarkdownFences && isMarkdownCodeBlock(className, source);
		return isBlock ? (
			<MarkdownSourceBlock source={source} rendered={renderMarkdown}>
				{renderMarkdown ? (
					<MarkdownContent
						content={source}
						compact={compact}
						finalized={finalized}
						htmlPreviews={htmlPreviews}
						references={references}
						onEntityClick={onEntityClick}
						onDiagramClick={onDiagramClick}
						renderMarkdownFences={false}
					/>
				) : (
					<pre>
						<code className={className} {...props}>
							{children}
						</code>
					</pre>
				)}
			</MarkdownSourceBlock>
		) : (
			<code className={className} {...props}>
				{children}
			</code>
		);
	},
	a: function MarkdownAnchor({ href, children }) {
		const { references, onEntityClick, onDiagramClick } = React.useContext(MarkdownRenderContext);
		return (
			<KnowledgeAnchor
				href={href}
				references={references}
				onEntityClick={onEntityClick}
				onDiagramClick={onDiagramClick}
			>
				{children}
			</KnowledgeAnchor>
		);
	},
};

function MarkdownSourceBlock({
	source,
	rendered,
	children,
}: {
	source: string;
	rendered: boolean;
	children: React.ReactNode;
}) {
	const { t } = useTranslation();
	const [copyResult, setCopyResult] = useState<{ source: string; failed: boolean } | null>(null);
	const currentResult = copyResult?.source === source ? copyResult : null;
	useEffect(() => {
		if (!copyResult || copyResult.failed) return;
		const timeout = window.setTimeout(() => setCopyResult(null), 1_500);
		return () => window.clearTimeout(timeout);
	}, [copyResult]);
	const copySource = async () => {
		try {
			await navigator.clipboard.writeText(source);
			setCopyResult({ source, failed: false });
		} catch (error) {
			console.warn("Could not copy code block source", error);
			setCopyResult({ source, failed: true });
		}
	};
	const copied = currentResult !== null && !currentResult.failed;
	return (
		<div className={clsx("markdown-source-block", rendered && "is-markdown-preview")}>
			<button
				type="button"
				className="markdown-source-copy"
				title={t("Copy source")}
				aria-label={t("Copy source")}
				onMouseUp={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					void copySource();
				}}
			>
				{copied ? (
					<CheckCircle2 size={14} aria-hidden="true" />
				) : (
					<Copy size={14} aria-hidden="true" />
				)}
				<span aria-live="polite">{copied ? t("Copied") : t("Copy source")}</span>
			</button>
			{rendered ? <div className="markdown-fence-preview">{children}</div> : children}
			{currentResult?.failed && (
				<p className="markdown-source-copy-error" role="alert">
					{t("Copy failed. Try again.")}
				</p>
			)}
		</div>
	);
}

const MarkdownContent = memo(function MarkdownContent({
	htmlPreviews,
	content,
	compact = false,
	finalized = true,
	renderMarkdownFences = true,
	references,
	onEntityClick,
	onDiagramClick,
	onTextSelection,
	collapsibleSections = false,
	onRevealHeading,
}: {
	htmlPreviews?: HtmlPreviewDocument[];
	content: string;
	compact?: boolean;
	finalized?: boolean;
	renderMarkdownFences?: boolean;
	references?: KnowledgeReference[];
	onEntityClick?: (id: string) => void;
	onDiagramClick?: (id: string) => void;
	onTextSelection?: (text: string, rect: DOMRect) => void;
	collapsibleSections?: boolean;
	onRevealHeading?: () => void;
}) {
	const headingPrefix = React.useId();
	const containerRef = useRef<HTMLDivElement>(null);
	const sectionsEnabled = collapsibleSections && !compact;
	const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
	const toggle = useCallback((id: string) => {
		setCollapsedIds((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);
	const sectionContext = useMemo(() => ({ collapsedIds, toggle }), [collapsedIds, toggle]);
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container || !sectionsEnabled) return;
		const reveal = (event: Event) => {
			if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
			const target = event.target.closest<HTMLElement>(
				`${markdownHeadingSelector}, [data-markdown-section-id]`,
			);
			if (
				!target ||
				!container.contains(target) ||
				event.detail?.headingId !==
					(target.dataset.markdownHeadingId ?? target.dataset.markdownSectionId)
			) {
				return;
			}
			const ancestors = new Set<string>();
			for (
				let element: HTMLElement | null = target;
				element && element !== container;
				element = element.parentElement
			) {
				const id = element.dataset.markdownSectionId;
				if (id) ancestors.add(id);
			}
			revealMarkdownDetails(target);
			// Native outline events must reveal the entire path before the caller's next frame.
			flushSync(() => {
				setCollapsedIds((previous) => {
					if (![...ancestors].some((id) => previous.has(id))) return previous;
					return new Set([...previous].filter((id) => !ancestors.has(id)));
				});
				onRevealHeading?.();
			});
		};
		container.addEventListener(revealMarkdownHeadingEvent, reveal);
		return () => container.removeEventListener(revealMarkdownHeadingEvent, reveal);
	}, [onRevealHeading, sectionsEnabled]);
	const renderStartedAt = performance.now();
	useLayoutEffect(() => {
		recordPerformanceTiming("chat-markdown-render-commit", performance.now() - renderStartedAt);
	});
	const knowledgeReferences = references ?? emptyKnowledgeReferences;
	const normalizedContent = useMemo(
		() => normalizeMarkdownMathDelimiters(normalizeMarkdownEmphasis(content)),
		[content],
	);
	const remarkPlugins = useMemo<
		NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>
	>(
		() => [
			remarkGfm,
			remarkMath,
			[remarkKnowledgeLinks, { references: knowledgeReferences }],
			...(sectionsEnabled
				? [
						[remarkMarkdownSections, { idPrefix: `markdown-${headingPrefix}` }] as [
							typeof remarkMarkdownSections,
							{ idPrefix: string },
						],
					]
				: []),
		],
		[headingPrefix, knowledgeReferences, sectionsEnabled],
	);
	const rehypePlugins = useMemo<
		NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>
	>(
		() => [...markdownRehypePlugins, ...(sectionsEnabled ? [rehypeMarkdownSections] : [])],
		[sectionsEnabled],
	);
	const renderContext = useMemo<MarkdownRenderContextValue>(
		() => ({
			compact,
			finalized,
			renderMarkdownFences,
			htmlPreviews,
			references: knowledgeReferences,
			onEntityClick,
			onDiagramClick,
		}),
		[
			compact,
			finalized,
			renderMarkdownFences,
			htmlPreviews,
			knowledgeReferences,
			onDiagramClick,
			onEntityClick,
		],
	);
	return (
		<MarkdownRenderContext.Provider value={renderContext}>
			<MarkdownSectionContext.Provider value={sectionContext}>
				<div
					ref={containerRef}
					className={clsx("markdown-body", compact && "markdown-compact")}
					onMouseUp={(event) => {
						if (!onTextSelection || compact) return;
						const selected = window.getSelection();
						if (!selected || selected.isCollapsed || !selected.toString().trim()) return;
						const range = selected.getRangeAt(0);
						if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
						onTextSelection(selected.toString().trim(), range.getBoundingClientRect());
					}}
				>
					<ReactMarkdown
						remarkPlugins={remarkPlugins}
						rehypePlugins={rehypePlugins}
						components={markdownComponents}
					>
						{normalizedContent}
					</ReactMarkdown>
				</div>
			</MarkdownSectionContext.Provider>
		</MarkdownRenderContext.Provider>
	);
});

function KnowledgeAnchor({
	href,
	references,
	children,
	onEntityClick,
	onDiagramClick,
}: {
	href?: string;
	references: KnowledgeReference[];
	children: React.ReactNode;
	onEntityClick?: (id: string) => void;
	onDiagramClick?: (id: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const timer = useRef<number | null>(null);
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const reference = href?.startsWith("#knowledge/")
		? references.find((item) => href.endsWith(encodeURIComponent(item.id)))
		: undefined;
	const open = () => {
		timer.current = window.setTimeout(() => setHovered(true), 300);
	};
	const close = () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setHovered(false), 150);
	};
	useEffect(() => {
		if (!hovered) return;
		const dismiss = () => setHovered(false);
		window.addEventListener("scroll", dismiss, true);
		window.addEventListener("resize", dismiss);
		return () => {
			window.removeEventListener("scroll", dismiss, true);
			window.removeEventListener("resize", dismiss);
		};
	}, [hovered]);
	const contextReference = href ? parseReferences(`[@reference](${href})`)[0] : undefined;
	if (contextReference?.kind === "skill") {
		return (
			<span className="knowledge-link-wrap" title={contextReference.id}>
				{children}
			</span>
		);
	}
	if (contextReference?.kind === "source") {
		return <a href="#/sources">{children}</a>;
	}
	if (contextReference?.kind === "session") {
		return (
			<a
				href={href}
				onClick={(event) => {
					event.preventDefault();
					const state = useAppStore.getState();
					if (state.sessions.some((session) => session.id === contextReference.id)) {
						state.setActiveSession(contextReference.id);
					}
				}}
			>
				{children}
			</a>
		);
	}
	return (
		<span ref={anchorRef} className="knowledge-link-wrap" onMouseEnter={open} onMouseLeave={close}>
			<a
				href={href}
				onFocus={() => setHovered(Boolean(reference))}
				onBlur={() => setHovered(false)}
				onClick={(event) => {
					if (href?.startsWith("#knowledge/entity/")) {
						event.preventDefault();
						onEntityClick?.(decodeURIComponent(href.slice("#knowledge/entity/".length)));
					} else if (href?.startsWith("#knowledge/diagram/")) {
						event.preventDefault();
						onDiagramClick?.(decodeURIComponent(href.slice("#knowledge/diagram/".length)));
					} else if (href?.startsWith("http")) {
						event.preventDefault();
						void getRhyzaBridge()?.openExternal({ url: href });
					}
				}}
			>
				{children}
			</a>
			{hovered &&
				reference &&
				anchorRef.current &&
				createPortal(
					<KnowledgeHoverCard
						reference={reference}
						anchor={anchorRef.current}
						onMouseEnter={() => {
							if (timer.current !== null) window.clearTimeout(timer.current);
						}}
						onMouseLeave={close}
					/>,
					document.body,
				)}
		</span>
	);
}

function KnowledgeHoverCard({
	reference,
	anchor,
	onMouseEnter,
	onMouseLeave,
}: {
	reference: KnowledgeReference;
	anchor: HTMLElement;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}) {
	const cardRef = useRef<HTMLSpanElement | null>(null);
	const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;
		const anchorRect = anchor.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const gap = 8;
		const margin = 8;
		const left = Math.max(
			margin,
			Math.min(anchorRect.left, window.innerWidth - cardRect.width - margin),
		);
		const top =
			anchorRect.top >= cardRect.height + gap + margin
				? anchorRect.top - cardRect.height - gap
				: Math.min(anchorRect.bottom + gap, window.innerHeight - cardRect.height - margin);
		setPosition({ left, top: Math.max(margin, top), ready: true });
	}, [anchor, reference]);
	return (
		<span
			ref={cardRef}
			role="tooltip"
			className="knowledge-hover-card"
			style={{
				left: position.left,
				top: position.top,
				visibility: position.ready ? "visible" : "hidden",
			}}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<span className="flex items-center justify-between gap-3">
				<strong>{reference.title}</strong>
				<small>{reference.type}</small>
			</span>
			<span className="mt-1 line-clamp-2">{reference.summary}</span>
			<small className="mt-2 block">
				{reference.relationCount} relations · {reference.sourceCount} sources
			</small>
		</span>
	);
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
	const referenceByLabel = new Map(
		labels.map(({ label, reference }) => [label.toLocaleLowerCase(), reference]),
	);
	const pattern =
		labels.length > 0
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
	if (["link", "linkReference", "code", "inlineCode", "html"].includes(node.type) || !node.children)
		return;
	const transformed: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type === "inlineCode" && child.value) {
			const reference = referenceByLabel.get(child.value.trim().toLocaleLowerCase());
			transformed.push(
				reference
					? {
							type: "link",
							url: `#knowledge/${reference.kind}/${encodeURIComponent(reference.id)}`,
							children: [{ type: "text", value: child.value }],
						}
					: child,
			);
			continue;
		}
		if (child.type !== "text" || !child.value) {
			transformMarkdownChildren(child, pattern, referenceByLabel);
			transformed.push(child);
			continue;
		}
		let cursor = 0;
		pattern.lastIndex = 0;
		for (const match of child.value.matchAll(pattern)) {
			const index = match.index ?? 0;
			if (index > cursor)
				transformed.push({ type: "text", value: child.value.slice(cursor, index) });
			const label = match[0];
			const reference = referenceByLabel.get(label.toLocaleLowerCase());
			transformed.push(
				reference
					? {
							type: "link",
							url: `#knowledge/${reference.kind}/${encodeURIComponent(reference.id)}`,
							children: [{ type: "text", value: label }],
						}
					: { type: "text", value: label },
			);
			cursor = index + label.length;
		}
		if (cursor === 0) transformed.push(child);
		else if (cursor < child.value.length)
			transformed.push({ type: "text", value: child.value.slice(cursor) });
	}
	node.children = transformed;
}

function buildKnowledgeReferences(
	entities: Entity[],
	relations: Relation[],
	diagrams: Diagram[],
): KnowledgeReference[] {
	return [
		...entities
			.filter((entity) => !entity.deletedAt)
			.map((entity) => ({
				kind: "entity" as const,
				id: entity.id,
				labels: [entity.name, ...entity.aliases],
				title: entity.name,
				type: entity.type,
				summary: entity.summary,
				relationCount: relations.filter(
					(relation) =>
						!relation.deletedAt &&
						(relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id),
				).length,
				sourceCount: entity.sourceRefs.length,
			})),
		...diagrams
			.filter((diagram) => !diagram.deletedAt)
			.map((diagram) => ({
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
