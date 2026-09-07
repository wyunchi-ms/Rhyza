import clsx from "clsx";
import { AlertCircle, CheckCircle2, ChevronDown, Circle, FileText, ListChecks, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getKnowbranchBridge } from "../hooks/useKnowbranchBridge";
import type { WorkspaceTodoNode, WorkspaceTodosResponse } from "../shared/ipc";
import { useAppStore } from "../store";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";
import { TurnInspectorPanel } from "./chat/TurnInspectorDrawer";

export const KnowledgePane = () => {
	const store = useAppStore();
	const viewportWidth = useViewportWidth();
	const paneMax = Math.min(560, Math.max(320, viewportWidth * 0.45));
	const paneSize = usePanelSize("knowbranch-layout-right-pane-width", 340, 280, paneMax);
	const paneWidth = Math.min(paneSize.value, paneMax);
	const isOpen = store.rightPaneOpen;
	const inspectedTurn = store.turns.find((turn) => turn.id === store.inspectedTurnId);
	const inspectedSessionTurns = inspectedTurn ? store.turns.filter((turn) => turn.sessionId === inspectedTurn.sessionId) : [];
	const loadedTelemetrySessions = useRef(new Set<string>());
	const todoRequestSequence = useRef(0);
	const [todos, setTodos] = useState<WorkspaceTodosResponse | null>(null);
	const [todoLoading, setTodoLoading] = useState(false);
	const [todoError, setTodoError] = useState<string | null>(null);

	useEffect(() => {
		if (store.rightPaneView === "todo") return;
		const frontendSessionId = inspectedTurn?.sessionId;
		const bridge = getKnowbranchBridge();
		if (!frontendSessionId || !bridge || typeof bridge.modelRequestHistory !== "function" || loadedTelemetrySessions.current.has(frontendSessionId)) return;
		loadedTelemetrySessions.current.add(frontendSessionId);
		void bridge.modelRequestHistory({ frontendSessionId }).then(({ turns }) => {
			for (const [turnId, snapshots] of Object.entries(turns)) {
				const current = useAppStore.getState().turns.find((turn) => turn.id === turnId)?.modelRequests ?? [];
				const merged = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
				for (const snapshot of current) merged.set(snapshot.id, snapshot);
				useAppStore.getState().updateTurn(turnId, { modelRequests: [...merged.values()].sort((left, right) => left.sequence - right.sequence) });
			}
		}).catch((error) => {
			loadedTelemetrySessions.current.delete(frontendSessionId);
			console.warn("Could not load model request history", error);
		});
	}, [inspectedTurn?.sessionId, store.rightPaneView]);

	const loadTodos = useCallback(async (quiet = false) => {
		const requestSequence = ++todoRequestSequence.current;
		const bridge = getKnowbranchBridge();
		if (!bridge || typeof bridge.workspaceTodos !== "function") {
			setTodoError("Restart Electron to load the workspace TODO bridge.");
			return;
		}
		if (!quiet) setTodoLoading(true);
		try {
			const result = await bridge.workspaceTodos({ frontendSessionId: store.activeSessionId ?? undefined });
			if (requestSequence !== todoRequestSequence.current) return;
			setTodos(result);
			setTodoError(null);
		} catch (error) {
			if (requestSequence !== todoRequestSequence.current) return;
			setTodoError(error instanceof Error ? error.message : "Could not read workspace TODO files.");
		} finally {
			if (requestSequence === todoRequestSequence.current) setTodoLoading(false);
		}
	}, [store.activeSessionId]);

	useEffect(() => {
		if (!isOpen || store.rightPaneView !== "todo") return;
		void loadTodos();
		const interval = window.setInterval(() => void loadTodos(true), 4_000);
		return () => window.clearInterval(interval);
	}, [isOpen, loadTodos, store.rightPaneView]);

	return <>
		{isOpen && <PanelResizeHandle side="right" label="Resize right panel" value={paneWidth} min={280} max={paneMax} defaultValue={340} onChange={paneSize.setValue} onCommit={paneSize.commit} />}
		<aside className={clsx("knowledge-pane", !isOpen && "is-closed")} aria-hidden={!isOpen} style={{ width: isOpen ? paneWidth : 0, flexBasis: isOpen ? paneWidth : 0, maxWidth: "calc(100vw - 4rem)" }}>
			{isOpen && (store.rightPaneView !== "todo" && inspectedTurn
				? <TurnInspectorPanel turn={inspectedTurn} turns={inspectedSessionTurns} view={store.rightPaneView} onClose={store.closeRightPane} />
				: <TodoChecklistPanel todos={todos} loading={todoLoading} error={todoError} onRefresh={() => void loadTodos()} onClose={store.closeRightPane} />)}
		</aside>
	</>;
};

function TodoChecklistPanel({ todos, loading, error, onRefresh, onClose }: {
	todos: WorkspaceTodosResponse | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	onClose: () => void;
}) {
	const progress = todos?.total ? Math.round((todos.completed / todos.total) * 100) : 0;
	return <section className="workspace-todo-panel" aria-labelledby="workspace-todo-title">
		<header>
			<div className="min-w-0">
				<h2 id="workspace-todo-title"><ListChecks size={17} aria-hidden="true" /> Workspace TODOs</h2>
				<p title={todos?.workspacePath}>{todos?.workspacePath ?? "Current workspace"}</p>
			</div>
			<div className="workspace-todo-actions">
				<button type="button" title="Refresh TODOs" aria-label="Refresh workspace TODOs" disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading ? "animate-spin" : undefined} /></button>
				<button type="button" title="Close" aria-label="Close workspace TODOs" onClick={onClose}><X size={16} /></button>
			</div>
		</header>
		<div className="workspace-todo-scroll">
			{todos && todos.total > 0 && <div className="workspace-todo-progress">
				<div><strong>{todos.completed} of {todos.total} completed</strong><span>{progress}%</span></div>
				<progress value={todos.completed} max={todos.total} aria-label={`${todos.completed} of ${todos.total} workspace TODOs completed`} />
			</div>}
			{error && <div className="workspace-todo-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
			{loading && !todos && <div className="workspace-todo-empty">Loading workspace checklists…</div>}
			{!loading && !error && todos?.files.length === 0 && <div className="workspace-todo-empty"><ListChecks size={28} /><strong>No TODO checklist found</strong><span>Create a TODO.md with Markdown checkboxes to track agent progress here.</span></div>}
			{todos?.files.map((file) => <details className="workspace-todo-file" key={file.path} open>
				<summary><ChevronDown size={15} className="workspace-todo-chevron" /><FileText size={15} /><span title={file.path}>{file.path}</span><small>{file.completed}/{file.total}</small></summary>
				<TodoTree nodes={file.nodes} />
			</details>)}
		</div>
	</section>;
}

function TodoTree({ nodes, level = 1 }: { nodes: WorkspaceTodoNode[]; level?: number }) {
	return <ul className="workspace-todo-tree" role={level === 1 ? "tree" : "group"}>
		{nodes.map((node) => <li key={node.id} role="treeitem" aria-level={level} aria-checked={node.completed}>
			<div className={clsx("workspace-todo-node", node.completed && "is-complete")}>
				{node.completed ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
				<span>{node.text}</span>
				<small className="workspace-todo-status">{node.completed ? "Done" : "Open"}</small>
				<small className="workspace-todo-line">L{node.line}</small>
			</div>
			{node.children.length > 0 && <TodoTree nodes={node.children} level={level + 1} />}
		</li>)}
	</ul>;
}
