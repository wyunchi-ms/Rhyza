import { SessionContextMenu, useSessionContextMenu } from "./SessionContextMenu";
import { ProgressMarker } from "./ProgressMarker";
import clsx from "clsx";
import { AlertCircle, ChevronRight, LoaderCircle, LocateFixed, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getKnowbranchBridge, githubCopilotProviderId } from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import { useConversationFocus } from "../store/conversationFocus";
import { buildTurnSessionMap } from "../utils/sessionVisibility";
import type { SessionNode, SessionProgressStatus, TokenUsage } from "../types";
import { allocateBranchUsage, formatTokens, usageTokens } from "../utils/branchUsage";
import { runningSessionIds } from "../utils/sessionRuntime";
import { announceBranchSwitchEnd, announceBranchSwitchStart } from "../utils/branchSwitch";
import { recordPerformanceTiming } from "../utils/performanceMarks";

export const SessionTree: React.FC<{ embedded?: boolean; viewControl?: React.ReactNode }> = ({ embedded = false, viewControl }) => {
	const { sessions, turns, activeSessionId, setActiveSession, createRootSession, renameSession, setSessionProgressStatus, deleteSession } =
		useAppStore();
	const focus = useConversationFocus();
	const turnSessionMap = useMemo(() => buildTurnSessionMap(turns, sessions), [turns, sessions]);
	const visibleSessionId = focus.sessionId === activeSessionId && focus.turnId ? turnSessionMap.get(focus.turnId) ?? activeSessionId : activeSessionId;
	const treeRef = useRef<HTMLDivElement>(null);
	const branchSwitchFrameRef = useRef<number | null>(null);
	const scrollTargetSessionId = visibleSessionId ?? activeSessionId;
	const usage = allocateBranchUsage(sessions, turns);
	const runningIds = runningSessionIds(turns);
	const navigate = useNavigate();
	const selectSession = (id: string) => {
		if (id === activeSessionId) {
			navigate("/");
			return;
		}
		if (branchSwitchFrameRef.current !== null) window.cancelAnimationFrame(branchSwitchFrameRef.current);
		announceBranchSwitchStart(id);
		// Yield one complete frame so the loading overlay is painted before the
		// potentially expensive conversation tree is reconciled.
		branchSwitchFrameRef.current = window.requestAnimationFrame(() => {
			branchSwitchFrameRef.current = window.requestAnimationFrame(() => {
				branchSwitchFrameRef.current = null;
				const updateStartedAt = performance.now();
				setActiveSession(id);
				recordPerformanceTiming("branch-state-update", performance.now() - updateStartedAt);
				navigate("/");
			});
		});
	};
	const createSession = () => {
		createRootSession();
		navigate("/");
	};
	const rootSessions = sessions.filter((s) => s.isRoot);
	useLayoutEffect(() => {
		if (!scrollTargetSessionId) return;
		const nodes = treeRef.current?.querySelectorAll<HTMLElement>("[data-session-tree-id]");
		const highlighted = nodes ? [...nodes].find((element) => element.dataset.sessionTreeId === scrollTargetSessionId) : undefined;
		highlighted?.scrollIntoView({ block: "nearest" });
	}, [scrollTargetSessionId]);
	useEffect(() => () => {
		if (branchSwitchFrameRef.current !== null) window.cancelAnimationFrame(branchSwitchFrameRef.current);
		announceBranchSwitchEnd();
	}, []);
	const regenerateBranchTitles = async (parentId: string) => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const state = useAppStore.getState();
		const children = state.sessions.filter((session) => session.parentId === parentId);
		const nodes = [state.sessions.find((session) => session.id === parentId), ...children]
			.filter((session): session is SessionNode => Boolean(session));
		const model = state.settings.defaultModel ? { providerId: githubCopilotProviderId, modelId: state.settings.defaultModel } : undefined;
		const summaries = await Promise.all(nodes.map((node) => {
			const nodeTurns = state.turns.filter((turn) => turn.sessionId === node.id);
			const localTurns = nodeTurns.filter((turn) => !turn.sourceTurnId);
			const text = [...localTurns].reverse().find((turn) => turn.role === "user")?.content
				?? localTurns.map((turn) => turn.content).join("\n")
				?? node.title;
			return bridge.generateSummary({ text: text || node.title, model });
		}));
		const current = useAppStore.getState();
		nodes.forEach((node, index) => {
			current.addSessionTitleUsage(node.id, summaries[index]?.usage);
			const title = summaries[index]?.summary;
			if (title) current.renameSession(node.id, title);
		});
	};

	return (
		<div ref={treeRef} className={clsx("session-tree flex flex-col min-h-0", embedded ? "flex-1" : "w-64 h-full shrink-0 border-r border-gray-200")}>
			<div className="session-tree-header">
				<div>
					<h2>Chats</h2>
					<UsageLabel usage={usage.total} prefix="Total" />
				</div>
				<div className="session-tree-header-actions">
				{viewControl}
				<button
					type="button"
					onClick={createSession}
					className="sidebar-icon-button"
					title="New chat"
					aria-label="New chat"
				>
					<Plus size={16} />
				</button>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto px-2 pb-2">
				{rootSessions.map((root) => (
					<SessionGroup
						key={root.id}
						root={root}
						sessions={sessions}
						currentId={visibleSessionId}
						viewportId={visibleSessionId}
						onSelect={selectSession}
						onRename={renameSession}
						onSetProgress={setSessionProgressStatus}
						onRegenerate={(id) => void regenerateBranchTitles(id)}
						onDelete={deleteSession}
						usage={usage}
						runningIds={runningIds}
					/>
				))}
			</div>
		</div>
	);
};

const SessionGroup = ({
	root,
	sessions,
	currentId,
	viewportId,
	onSelect,
	onRename,
	onSetProgress,
	onRegenerate,
	onDelete,
	usage,
	runningIds,
}: {
	root: SessionNode;
	sessions: SessionNode[];
	currentId: string | null;
	viewportId: string | null;
	onSelect: (id: string) => void;
	onRename: (id: string, title: string, keepPending?: boolean) => void;
	onSetProgress: (id: string, status?: SessionProgressStatus, continuation?: boolean) => void;
	onRegenerate: (id: string) => void;
	onDelete: (id: string) => void;
	usage: ReturnType<typeof allocateBranchUsage>;
	runningIds: Set<string>;
}) => {
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
	const { menu: contextMenu, openMenu: openStatusMenu, closeMenu } = useSessionContextMenu();
	const [editingTitle, setEditingTitle] = useState<{
		nodeId: string;
		value: string;
	} | null>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editingTitle) return;
		const frame = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [editingTitle?.nodeId]);

	const getChildren = (parentId: string) =>
		sessions.filter((s) => s.parentId === parentId);

	useEffect(() => {
		if (!currentId) return;
		const ancestors = new Set<string>();
		let current = sessions.find((session) => session.id === currentId);
		while (current?.parentId) {
			const parentId = current.parentId;
			ancestors.add(parentId);
			current = sessions.find((session) => session.id === parentId);
		}
		setCollapsedIds((collapsed) => {
			if (![...ancestors].some((id) => collapsed.has(id))) return collapsed;
			const expanded = new Set(collapsed);
			for (const id of ancestors) expanded.delete(id);
			return expanded;
		});
	}, [currentId, sessions]);

	const toggleBranch = (id: string) => setCollapsedIds((current) => {
		const next = new Set(current);
		if (next.has(id)) next.delete(id); else next.add(id);
		return next;
	});

	const startRename = (nodeId: string, title: string) => {
		closeMenu();
		setEditingTitle({ nodeId, value: title });
	};

	const finishRename = () => {
		if (!editingTitle) return;
		const title = editingTitle.value.trim();
		if (title) onRename(editingTitle.nodeId, title);
		setEditingTitle(null);
	};

	const titleEditor = (leftClassName: string) => editingTitle && (
		<input
			ref={titleInputRef}
			className={clsx("session-node-title-editor", leftClassName)}
			value={editingTitle.value}
			onChange={(event) => setEditingTitle((current) => current ? { ...current, value: event.target.value } : null)}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					finishRename();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					setEditingTitle(null);
				}
			}}
			onBlur={finishRename}
			aria-label="Session title"
		/>
	);

	const renderNode = (node: SessionNode, nested = false) => {
		const children = getChildren(node.id);
		const isBranchPoint = children.length > 0;
		const isCurrent = currentId === node.id;
		const isInView = viewportId === node.id;
		const expanded = !collapsedIds.has(node.id);
		const isEditing = editingTitle?.nodeId === node.id;

		return (
			<div key={node.id} data-session-tree-id={node.id} className={clsx(nested && "session-tree-node")}>
				<div className="relative group">
				<div
					className={clsx(
						"session-node-button",
						isCurrent && "is-current",
						isInView && "is-in-view",
						isBranchPoint && "is-branch",
					)}
				>
					{isBranchPoint ? (
						<button
							type="button"
							className="session-tree-toggle"
							onClick={() => toggleBranch(node.id)}
							aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
							title={expanded ? "Collapse branch" : "Expand branch"}
						>
							<ChevronRight size={14} className={clsx("transition-transform", expanded && "rotate-90")} />
						</button>
					) : null}
					<button
						type="button"
						className="session-tree-select"
						aria-current={isCurrent ? "page" : undefined}
						onClick={() => onSelect(node.id)}
						onContextMenu={(event) => openStatusMenu(event, node.id)}
					>
						{isInView && <span className="session-viewport-rail" aria-hidden="true" />}
						<ProgressMarker status={node.progressStatus} active={isCurrent} />
						<SessionNodeTitle title={node.title} />
						{isInView && <span className="session-viewport-indicator" title="Currently in view" aria-label="Currently in view"><LocateFixed size={12} /></span>}
						{(node.titlePending || runningIds.has(node.id)) && <LoaderCircle size={12} className="animate-spin" aria-label={runningIds.has(node.id) ? "Running" : "Generating title"} />}
						{!isBranchPoint && node.status === "interrupted" && <AlertCircle size={12} className="text-amber-600" aria-label="Interrupted; this session can be continued" />}
						{!isBranchPoint && node.status === "error" && <AlertCircle size={12} className="text-red-500" aria-label="Error" />}
					</button>
				</div>
				{isEditing && titleEditor(isBranchPoint ? "left-12" : "left-8")}
				<div className={clsx("session-node-actions", isEditing && "pointer-events-none")}>
					<HoverUsage usage={usage.node.get(node.id)} />
					{isBranchPoint && <button type="button" title="Regenerate branch titles" aria-label={`Regenerate titles under ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={(event) => { event.stopPropagation(); onRegenerate(node.id); }}><Sparkles size={12} /></button>}
					<button type="button" title="Rename session" aria-label={`Rename ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={(event) => { event.stopPropagation(); startRename(node.id, node.title); }}><Pencil size={12} /></button>
					<button type="button" title="Delete session" aria-label={`Delete ${node.title}`} className="p-1 rounded hover:bg-red-500/20 hover:text-red-600" onClick={() => { if (window.confirm(`Delete “${node.title}”${children.length ? " and all of its branches" : ""}?`)) onDelete(node.id); }}><Trash2 size={12} /></button>
				</div>
				</div>
				{expanded && children.length > 0 && (
					<div className="session-branch-children mt-1 ml-3 pl-2 space-y-1">
						{children.map((child) => renderNode(child, true))}
					</div>
				)}
			</div>
		);
	};

	return <>
		<div className="mb-3">{renderNode(root)}</div>
		{contextMenu && <SessionContextMenu anchor={contextMenu} status={sessions.find((session) => session.id === contextMenu.nodeId)?.progressStatus} onSelect={(status) => onSetProgress(contextMenu.nodeId, status)} onClose={closeMenu} />}
	</>;
};

const SessionNodeTitle = ({ title }: { title: string }) => {
	const titleRef = useRef<HTMLSpanElement>(null);
	const [scrollDistance, setScrollDistance] = useState(0);

	useLayoutEffect(() => {
		const element = titleRef.current;
		if (!element) return;
		const measure = () => setScrollDistance(Math.max(0, element.scrollWidth - element.clientWidth));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [title]);

	return (
		<span
			ref={titleRef}
			className="session-node-title"
			data-overflow={scrollDistance > 0 || undefined}
			style={{ "--session-title-scroll": `-${scrollDistance}px` } as React.CSSProperties}
			title={title}
		>
			<span>{title}</span>
		</span>
	);
};

const HoverUsage = ({ usage }: { usage?: TokenUsage }) => {
	if (!usage) return null;
	const tokens = usageTokens(usage);
	return <span className="session-node-hover-meta" aria-label={`${tokens.toLocaleString()} tokens, $${usage.cost.toFixed(4)}`}>
		{formatTokens(tokens)} · {usage.cost < 0.0001 && usage.cost > 0 ? "<$0.0001" : `$${usage.cost.toFixed(4)}`}
	</span>;
};

const UsageLabel = ({ usage, prefix }: { usage?: TokenUsage; prefix?: string }) => {
	if (!usage) return null;
	const tokens = usageTokens(usage);
	return (
		<span
			className="session-usage"
			title={`Input ${usage.input.toLocaleString()} · Output ${usage.output.toLocaleString()} · Cache read ${usage.cacheRead.toLocaleString()} · Cache write ${usage.cacheWrite.toLocaleString()} · $${usage.cost.toFixed(6)}`}
		>
			{prefix ? `${prefix} ` : ""}{formatTokens(tokens)} · ${usage.cost < 0.0001 && usage.cost > 0 ? "<$0.0001" : `$${usage.cost.toFixed(4)}`}
		</span>
	);
};
