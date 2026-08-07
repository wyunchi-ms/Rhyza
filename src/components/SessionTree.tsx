import clsx from "clsx";
import { ChevronRight, GitFork, Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useAppStore } from "../store";
import type { SessionNode } from "../types";

export const SessionTree: React.FC = () => {
	const { sessions, activeSessionId, setActiveSession, createRootSession } =
		useAppStore();
	const rootSessions = sessions.filter((s) => s.isRoot);

	return (
		<div className="w-64 flex flex-col bg-surface border-r border-gray-200 h-full shrink-0">
			<div className="p-4 flex items-center justify-between border-b border-gray-100">
				<h2 className="font-semibold text-sm uppercase tracking-wider text-secondary">
					Sessions
				</h2>
				<button
					type="button"
					onClick={createRootSession}
					className="p-1 hover:bg-gray-100 rounded text-secondary hover:text-primary transition-colors"
				>
					<Plus size={16} />
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-2">
				{rootSessions.map((root) => (
					<SessionGroup
						key={root.id}
						root={root}
						sessions={sessions}
						activeId={activeSessionId}
						onSelect={setActiveSession}
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
}: {
	root: SessionNode;
	sessions: SessionNode[];
	activeId: string | null;
	onSelect: (id: string) => void;
}) => {
	const [expanded, setExpanded] = useState(true);

	const getChildren = (parentId: string) =>
		sessions.filter((s) => s.parentId === parentId);

	const renderNode = (node: SessionNode, depth: number) => {
		const children = getChildren(node.id);
		const isActive = activeId === node.id;

		return (
			<div key={node.id}>
				<button
					type="button"
					className={clsx(
						"flex w-full items-center py-1.5 px-2 rounded-lg cursor-pointer text-sm transition-colors group",
						isActive
							? "bg-accent text-white shadow-sm"
							: "hover:bg-gray-100 text-primary",
					)}
					style={{ paddingLeft: `${depth * 12 + 8}px` }}
					onClick={() => onSelect(node.id)}
				>
					{children.length > 0 ? (
						<ChevronRight
							size={14}
							className={clsx(
								"mr-1 transition-transform",
								expanded && "rotate-90",
								isActive ? "text-white/80" : "text-gray-400",
							)}
							onClick={(e) => {
								e.stopPropagation();
								setExpanded(!expanded);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									setExpanded(!expanded);
								}
							}}
							role="button"
							tabIndex={0}
						/>
					) : (
						<span className="w-3.5 mr-1" />
					)}
					<span className="truncate flex-1 font-medium">{node.title}</span>
					{!isActive && (
						<GitFork
							size={12}
							className="opacity-0 group-hover:opacity-100 text-gray-400"
						/>
					)}
				</button>
				{expanded && children.length > 0 && (
					<div className="mt-0.5 space-y-0.5">
						{children.map((child) => renderNode(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return <div className="mb-2">{renderNode(root, 0)}</div>;
};
