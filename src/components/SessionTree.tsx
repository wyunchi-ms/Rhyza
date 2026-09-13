import { SessionNodeContextMenu, useSessionContextMenu } from "./SessionContextMenu";
import { ProgressMarker } from "./ProgressMarker";
import clsx from "clsx";
import { AlertCircle, ChevronRight, LoaderCircle, LocateFixed, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getKnowbranchBridge, githubCopilotProviderId } from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import { useConversationFocus } from "../store/conversationFocus";
import { allocateConversationTreeUsage, conversationTreeTarget, projectConversationTree, type ConversationTreeNode } from "../utils/conversationTree";
import type { SessionNode, TokenUsage } from "../types";
import { formatTokens, usageTokens } from "../utils/branchUsage";
import { isTurnActive } from "../utils/sessionRuntime";
import { roundMetrics } from "../utils/roundMetrics";
import { announceBranchSwitchEnd, announceBranchSwitchStart } from "../utils/branchSwitch";
import { recordPerformanceTiming } from "../utils/performanceMarks";

export const SessionTree: React.FC<{ embedded?: boolean; viewControl?: React.ReactNode }> = ({ embedded = false, viewControl }) => {
	const { sessions, turns, activeSessionId, setActiveSession, createRootSession, renameSession, updateTurn, deleteSession } =
		useAppStore();
	const focus = useConversationFocus();
	const tree = useMemo(() => projectConversationTree(sessions, turns), [turns, sessions]);
	const activePath = tree.graph.paths.get(activeSessionId ?? "") ?? [];
	const focusedRoundId = focus.sessionId === activeSessionId && focus.turnId ? tree.graph.roundByTurnId.get(focus.turnId) : undefined;
	const visibleNodeId = tree.nodeByRoundId.get(focusedRoundId ?? activePath[activePath.length - 1]) ?? null;
	const treeRef = useRef<HTMLDivElement>(null);
	const branchSwitchFrameRef = useRef<number | null>(null);
	const scrollTargetSessionId = visibleNodeId;
	const usage = useMemo(() => allocateConversationTreeUsage(tree, sessions, turns), [tree, sessions, turns]);
	const navigate = useNavigate();
	const selectSession = (id: string) => {
		const target = conversationTreeTarget(tree, id, activeSessionId);
		if (!target) return;
		if (branchSwitchFrameRef.current !== null) window.cancelAnimationFrame(branchSwitchFrameRef.current);
		const select = () => {
			const { sessionId, turnId } = target;
			if (turnId) window.sessionStorage.setItem("rhyza-focus-turn", turnId);
			else window.sessionStorage.removeItem("rhyza-focus-turn");
			useConversationFocus.getState().setFocus(sessionId, turnId ?? null);
			setActiveSession(sessionId);
			navigate("/");
			if (turnId) window.dispatchEvent(new CustomEvent("rhyza:focus-turn", { detail: { turnId } }));
		};
		if (target.sessionId === activeSessionId) {
			branchSwitchFrameRef.current = null;
			announceBranchSwitchEnd();
			select();
			return;
		}
		announceBranchSwitchStart(target.sessionId);
		// Yield one complete frame so the loading overlay is painted before the
		// potentially expensive conversation tree is reconciled.
		branchSwitchFrameRef.current = window.requestAnimationFrame(() => {
			branchSwitchFrameRef.current = window.requestAnimationFrame(() => {
				branchSwitchFrameRef.current = null;
				const updateStartedAt = performance.now();
				select();
				recordPerformanceTiming("branch-state-update", performance.now() - updateStartedAt);
			});
		});
	};
	const createSession = () => {
		createRootSession();
		navigate("/");
	};
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
	const renameNode = (id: string, title: string) => {
		const node = tree.byId.get(id);
		if (!node) return;
		const last = node.rounds[node.rounds.length - 1];
		if (last.user) updateTurn(last.user.id, { summary: title });
		else renameSession(node.sessionId, title);
	};
	const regenerateBranchTitles = async (parentId: string) => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const state = useAppStore.getState();
		const nodes = [tree.byId.get(parentId), ...(tree.childrenById.get(parentId) ?? [])]
			.filter((node): node is ConversationTreeNode => Boolean(node));
		const model = state.settings.defaultModel ? { providerId: githubCopilotProviderId, modelId: state.settings.defaultModel } : undefined;
		const summaries = await Promise.all(nodes.map((node) => {
			const localTurns = node.rounds.flatMap((round) => round.user ? [round.user, ...round.answers] : round.answers);
			const text = [...localTurns].reverse().find((turn) => turn.role === "user")?.content
				?? localTurns.map((turn) => turn.content).join("\n")
				?? node.title;
			return bridge.generateSummary({ text: text || node.title, model });
		}));
		const current = useAppStore.getState();
		nodes.forEach((node, index) => {
			current.addSessionTitleUsage(node.sessionId, summaries[index]?.usage);
			const title = summaries[index]?.summary;
			if (title) renameNode(node.id, title);
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
				{tree.roots.map((root) => (
					<SessionGroup
						key={root.id}
						root={root}
						sessions={sessions}
						tree={tree}
						currentId={visibleNodeId}
						viewportId={visibleNodeId}
						onSelect={selectSession}
						onRename={renameNode}
						onRegenerate={(id) => void regenerateBranchTitles(id)}
						onDelete={deleteSession}
						usage={usage}
					/>
				))}
			</div>
		</div>
	);
};

const SessionGroup = ({
	root,
	sessions,
	tree,
	currentId,
	viewportId,
	onSelect,
	onRename,
	onRegenerate,
	onDelete,
	usage,
}: {
	root: ConversationTreeNode;
	sessions: SessionNode[];
	tree: ReturnType<typeof projectConversationTree>;
	currentId: string | null;
	viewportId: string | null;
	onSelect: (id: string) => void;
	onRename: (id: string, title: string) => void;
	onRegenerate: (id: string) => void;
	onDelete: (id: string) => void;
	usage: ReturnType<typeof allocateConversationTreeUsage>;
}) => {
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
	const { menu: contextMenu, openMenu, closeMenu } = useSessionContextMenu();
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
		tree.childrenById.get(parentId) ?? [];

	useEffect(() => {
		if (!currentId) return;
		const ancestors = new Set<string>();
		let current = tree.byId.get(currentId);
		while (current?.parentId && !ancestors.has(current.parentId)) {
			const parentId = current.parentId;
			ancestors.add(parentId);
			current = tree.byId.get(parentId);
		}
		setCollapsedIds((collapsed) => {
			if (![...ancestors].some((id) => collapsed.has(id))) return collapsed;
			const expanded = new Set(collapsed);
			for (const id of ancestors) expanded.delete(id);
			return expanded;
		});
	}, [currentId, tree]);

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

	const renderNode = (node: ConversationTreeNode, nested = false) => {
		const children = getChildren(node.id);
		const session = sessions.find((item) => item.id === node.sessionId);
		const running = node.rounds.some((round) => round.answers.some(isTurnActive));
		const last = node.rounds[node.rounds.length - 1];
		const status = roundMetrics(last).status;
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
							aria-expanded={expanded}
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
						onContextMenu={(event) => openMenu(event, node.id)}
					>
						{isInView && <span className="session-viewport-rail" aria-hidden="true" />}
						<ProgressMarker status={session?.progressStatus} active={isCurrent} />
						<SessionNodeTitle title={node.title} />
						{isInView && <span className="session-viewport-indicator" title="Currently in view" aria-label="Currently in view"><LocateFixed size={12} /></span>}
						{(session?.titlePending || running) && <LoaderCircle size={12} className="animate-spin" aria-label={running ? "Running" : "Generating title"} />}
						{!isBranchPoint && status === "interrupted" && <AlertCircle size={12} className="text-amber-600" aria-label="Interrupted; this session can be continued" />}
						{!isBranchPoint && status === "error" && <AlertCircle size={12} className="text-red-500" aria-label="Error" />}
					</button>
				</div>
				{isEditing && titleEditor(isBranchPoint ? "left-12" : "left-8")}
				<div className={clsx("session-node-actions", isEditing && "pointer-events-none")}>
					<HoverUsage usage={usage.node.get(node.id)} />
					{isBranchPoint && <button type="button" title="Regenerate branch titles" aria-label={`Regenerate titles under ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={(event) => { event.stopPropagation(); onRegenerate(node.id); }}><Sparkles size={12} /></button>}
					<button type="button" title="Rename session" aria-label={`Rename ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={(event) => { event.stopPropagation(); startRename(node.id, node.title); }}><Pencil size={12} /></button>
					<button type="button" title="Delete session" aria-label={`Delete session ${session?.title ?? node.title}`} className="p-1 rounded hover:bg-red-500/20 hover:text-red-600" onClick={() => { if (window.confirm(`Delete session “${session?.title ?? node.title}” and all its messages and branches?`)) onDelete(node.sessionId); }}><Trash2 size={12} /></button>
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

	const menuNode = contextMenu ? tree.byId.get(contextMenu.nodeId) : undefined;
	const menuRound = menuNode?.rounds[menuNode.rounds.length - 1];
	return <>
		<div className="mb-3">{renderNode(root)}</div>
		{contextMenu && menuNode && <SessionNodeContextMenu anchor={contextMenu} nodeId={menuNode.sessionId} turnId={menuRound?.answers[menuRound.answers.length - 1]?.id ?? menuRound?.user?.id} onClose={closeMenu} />}
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
