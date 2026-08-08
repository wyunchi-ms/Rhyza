import clsx from "clsx";
import { AlertCircle, Check, CheckCircle2, ChevronRight, Circle, CircleDot, LoaderCircle, PauseCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getKnowbranchBridge, githubCopilotProviderId } from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { SessionNode, SessionProgressStatus } from "../types";

const progressOptions: Array<{
	value?: SessionProgressStatus;
	label: string;
	description: string;
	icon: typeof Circle;
}> = [
	{ label: "未标记", description: "不跟踪该节点", icon: Circle },
	{ value: "todo", label: "待探索", description: "还有问题需要继续了解", icon: Circle },
	{ value: "in_progress", label: "探索中", description: "当前正在梳理", icon: CircleDot },
	{ value: "complete", label: "已完成", description: "当前问题已经问清楚", icon: CheckCircle2 },
	{ value: "parked", label: "暂不处理", description: "保留节点，稍后再看", icon: PauseCircle },
];

export const SessionTree: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
	const { sessions, activeSessionId, setActiveSession, createRootSession, renameSession, renameContinuation, setSessionProgressStatus, deleteSession } =
		useAppStore();
	const navigate = useNavigate();
	const selectSession = (id: string) => {
		setActiveSession(id);
		navigate("/");
	};
	const createSession = () => {
		createRootSession();
		navigate("/");
	};
	const rootSessions = sessions.filter((s) => s.isRoot);
	const regenerateBranchTitles = async (parentId: string) => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const state = useAppStore.getState();
		const children = state.sessions.filter((session) => session.parentId === parentId);
		const parentTurns = state.turns.filter((turn) => turn.sessionId === parentId);
		const firstForkId = children.find((child) => child.forkedFromTurnId)?.forkedFromTurnId;
		const forkIndex = firstForkId ? parentTurns.findIndex((turn) => turn.id === firstForkId) : -1;
		const originalText = parentTurns.slice(forkIndex + 1).filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n")
			|| parentTurns.slice(forkIndex + 1).map((turn) => turn.content).join("\n");
		const model = state.settings.defaultModel ? { providerId: githubCopilotProviderId, modelId: state.settings.defaultModel } : undefined;
		const [original, ...branches] = await Promise.all([
			bridge.generateSummary({ text: originalText || "Original conversation path", model }),
			...children.map((child) => {
				const text = [...state.turns].reverse().find((turn) => turn.sessionId === child.id && turn.role === "user")?.content ?? child.title;
				return bridge.generateSummary({ text, model });
			}),
		]);
		const current = useAppStore.getState();
		if (original.summary) current.renameContinuation(parentId, original.summary);
		children.forEach((child, index) => {
			const title = branches[index]?.summary;
			if (title) current.renameSession(child.id, title);
		});
	};

	return (
		<div className={clsx("session-tree flex flex-col min-h-0", embedded ? "flex-1" : "w-64 h-full shrink-0 border-r border-gray-200")}>
			<div className="session-tree-header">
				<h2>Chats</h2>
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
			<div className="flex-1 overflow-y-auto px-2 pb-2">
				{rootSessions.map((root) => (
					<SessionGroup
						key={root.id}
						root={root}
						sessions={sessions}
						activeId={activeSessionId}
						onSelect={selectSession}
						onRename={renameSession}
						onRenameContinuation={renameContinuation}
						onSetProgress={setSessionProgressStatus}
						onRegenerate={(id) => void regenerateBranchTitles(id)}
						onDelete={deleteSession}
					/>
				))}
			</div>
		</div>
	);
};

const SessionGroup = ({
	root,
	sessions,
	activeId,
	onSelect,
	onRename,
	onRenameContinuation,
	onSetProgress,
	onRegenerate,
	onDelete,
}: {
	root: SessionNode;
	sessions: SessionNode[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onRename: (id: string, title: string, keepPending?: boolean) => void;
	onRenameContinuation: (id: string, title: string) => void;
	onSetProgress: (id: string, status?: SessionProgressStatus, continuation?: boolean) => void;
	onRegenerate: (id: string) => void;
	onDelete: (id: string) => void;
}) => {
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		nodeId: string;
		continuation: boolean;
		status?: SessionProgressStatus;
	} | null>(null);

	useEffect(() => {
		if (!contextMenu) return;
		const close = () => setContextMenu(null);
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("blur", close);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("blur", close);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [contextMenu]);

	const openStatusMenu = (
		event: React.MouseEvent,
		nodeId: string,
		status?: SessionProgressStatus,
		continuation = false,
	) => {
		event.preventDefault();
		const menuWidth = 224;
		const menuHeight = 252;
		setContextMenu({
			x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
			y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
			nodeId,
			continuation,
			status,
		});
	};

	const getChildren = (parentId: string) =>
		sessions.filter((s) => s.parentId === parentId);

	const toggleBranch = (id: string) => setCollapsedIds((current) => {
		const next = new Set(current);
		if (next.has(id)) next.delete(id); else next.add(id);
		return next;
	});

	const renderContinuation = (node: SessionNode) => {
		const title = node.continuationTitle ?? "Original path";
		const isActive = activeId === node.id;
		return <div className="session-tree-node relative group" key={`${node.id}-continuation`}>
			<button type="button" className={clsx("session-node-button pr-10", isActive && "is-active")} onClick={() => onSelect(node.id)} onContextMenu={(event) => openStatusMenu(event, node.id, node.continuationProgressStatus, true)}>
				<ProgressMarker status={node.continuationProgressStatus} active={isActive} />
				<span className="truncate flex-1 font-medium">{title}</span>
				{node.continuationTitlePending && <LoaderCircle size={12} className="animate-spin" aria-label="Generating title" />}
			</button>
			<div className={clsx("absolute right-1 top-1/2 -translate-y-1/2 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100", isActive ? "text-white" : "text-secondary")}>
				<button type="button" title="Rename original path" aria-label={`Rename ${title}`} className="p-1 rounded hover:bg-black/10" onClick={() => { const next = window.prompt("Rename original path", title); if (next?.trim()) onRenameContinuation(node.id, next); }}><Pencil size={12} /></button>
			</div>
		</div>;
	};

	const renderNode = (node: SessionNode, nested = false) => {
		const children = getChildren(node.id);
		const isBranchPoint = children.length > 0;
		const isActive = !isBranchPoint && activeId === node.id;
		const expanded = !collapsedIds.has(node.id);

		return (
			<div key={node.id} className={clsx(nested && "session-tree-node")}>
				<div className="relative group">
				<button
					type="button"
					className={clsx(
						"session-node-button pr-14",
						isActive
							? "is-active"
							: isBranchPoint ? "is-branch" : "",
					)}
					onClick={() => isBranchPoint ? toggleBranch(node.id) : onSelect(node.id)}
					onContextMenu={(event) => openStatusMenu(event, node.id, node.progressStatus)}
				>
					{isBranchPoint ? (
						<ChevronRight
							size={14}
							className={clsx(
								"mr-1 transition-transform",
								expanded && "rotate-90",
								isActive ? "text-white/80" : "text-gray-400",
							)}
						/>
					) : (
						<ProgressMarker status={node.progressStatus} active={isActive} />
					)}
					{isBranchPoint && <ProgressMarker status={node.progressStatus} active={isActive} />}
					<span className="truncate flex-1 font-medium">{node.title}</span>
					{!isBranchPoint && node.status === "running" && <LoaderCircle size={12} className="animate-spin" aria-label="Running" />}
					{!isBranchPoint && node.status === "error" && <AlertCircle size={12} className="text-red-500" aria-label="Error" />}
				</button>
				<div className={clsx("absolute right-1 top-1/2 -translate-y-1/2 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100", isActive ? "text-white" : "text-secondary")}>
					{isBranchPoint && <button type="button" title="Regenerate branch titles" aria-label={`Regenerate titles under ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={(event) => { event.stopPropagation(); onRegenerate(node.id); }}><Sparkles size={12} /></button>}
					<button type="button" title="Rename session" aria-label={`Rename ${node.title}`} className="p-1 rounded hover:bg-black/10" onClick={() => { const title = window.prompt("Rename session", node.title); if (title?.trim()) onRename(node.id, title); }}><Pencil size={12} /></button>
					<button type="button" title="Delete session" aria-label={`Delete ${node.title}`} className="p-1 rounded hover:bg-red-500/20 hover:text-red-600" onClick={() => { if (window.confirm(`Delete “${node.title}”${children.length ? " and all of its branches" : ""}?`)) onDelete(node.id); }}><Trash2 size={12} /></button>
				</div>
				</div>
				{expanded && children.length > 0 && (
					<div className="session-branch-children mt-1 ml-3 pl-2 space-y-1">
						{renderContinuation(node)}
						{children.map((child) => renderNode(child, true))}
					</div>
				)}
			</div>
		);
	};

	return <>
		<div className="mb-3">{renderNode(root)}</div>
		{contextMenu && (
			<div
				role="menu"
				aria-label="设置节点状态"
				className="session-status-menu"
				style={{ left: contextMenu.x, top: contextMenu.y }}
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div className="session-status-menu-title">节点状态</div>
				{progressOptions.map((option) => {
					const Icon = option.icon;
					const selected = contextMenu.status === option.value;
					return (
						<button
							key={option.value ?? "unmarked"}
							type="button"
							role="menuitemradio"
							aria-checked={selected}
							className={clsx("session-status-option", option.value && `status-${option.value}`)}
							onClick={() => {
								onSetProgress(contextMenu.nodeId, option.value, contextMenu.continuation);
								setContextMenu(null);
							}}
						>
							<Icon size={16} className="session-status-option-icon" />
							<span className="min-w-0 flex-1">
								<span className="block font-semibold text-primary">{option.label}</span>
								<span className="block truncate text-[11px] text-secondary">{option.description}</span>
							</span>
							{selected && <Check size={14} className="text-accent" />}
						</button>
					);
				})}
			</div>
		)}
	</>;
};

const ProgressMarker = ({ status, active }: { status?: SessionProgressStatus; active: boolean }) => {
	const option = progressOptions.find((item) => item.value === status) ?? progressOptions[0];
	const Icon = option.icon;
	return (
		<span title={option.label} aria-label={`节点状态：${option.label}`} className={clsx("session-progress-marker", status && `status-${status}`, active && "is-active")}>
			<Icon size={status ? 12 : 7} strokeWidth={status ? 2.25 : 3} />
		</span>
	);
};
