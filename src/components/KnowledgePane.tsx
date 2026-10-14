import clsx from "clsx";
import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	Circle,
	FileText,
	ListChecks,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import type { WorkspaceTodoNode, WorkspaceTodosResponse } from "../shared/ipc";
import { useAppStore } from "../store";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";
import { TurnInspectorPanel } from "./chat/TurnInspectorDrawer";

export const KnowledgePane = () => {
	const store = useAppStore();
	const viewportWidth = useViewportWidth();
	const paneMax = Math.min(560, Math.max(320, viewportWidth * 0.45));
	const paneSize = usePanelSize("rhyza-layout-right-pane-width", 340, 280);
	const paneWidth = Math.min(paneSize.value, paneMax);
	const isOpen = store.rightPaneOpen;
	const inspectedTurn = store.turns.find((turn) => turn.id === store.inspectedTurnId);
	const inspectedSessionTurns = inspectedTurn
		? store.turns.filter((turn) => turn.sessionId === inspectedTurn.sessionId)
		: [];
	const loadedTelemetrySessions = useRef(new Set<string>());
	const todoRequestSequence = useRef(0);
	const todoSaveInFlight = useRef(false);
	const [todos, setTodos] = useState<WorkspaceTodosResponse | null>(null);
	const [todoLoading, setTodoLoading] = useState(false);
	const [todoError, setTodoError] = useState<string | null>(null);
	const [todoSaveError, setTodoSaveError] = useState<string | null>(null);
	const [savingTodoId, setSavingTodoId] = useState<string | null>(null);

	useEffect(() => {
		if (store.rightPaneView === "todo") return;
		const frontendSessionId = inspectedTurn?.sessionId;
		const bridge = getRhyzaBridge();
		if (
			!frontendSessionId ||
			!bridge ||
			typeof bridge.modelRequestHistory !== "function" ||
			loadedTelemetrySessions.current.has(frontendSessionId)
		)
			return;
		loadedTelemetrySessions.current.add(frontendSessionId);
		void bridge
			.modelRequestHistory({ frontendSessionId })
			.then(({ turns }) => {
				for (const [turnId, snapshots] of Object.entries(turns)) {
					const current =
						useAppStore.getState().turns.find((turn) => turn.id === turnId)?.modelRequests ?? [];
					const merged = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
					for (const snapshot of current) merged.set(snapshot.id, snapshot);
					useAppStore.getState().updateTurn(turnId, {
						modelRequests: [...merged.values()].sort(
							(left, right) => left.sequence - right.sequence,
						),
					});
				}
			})
			.catch((error) => {
				loadedTelemetrySessions.current.delete(frontendSessionId);
				console.warn("Could not load model request history", error);
			});
	}, [inspectedTurn?.sessionId, store.rightPaneView]);

	const loadTodos = useCallback(
		async (quiet = false) => {
			if (todoSaveInFlight.current) return;
			const requestSequence = ++todoRequestSequence.current;
			const bridge = getRhyzaBridge();
			if (!bridge || typeof bridge.workspaceTodos !== "function") {
				setTodoError("Restart Electron to load the workspace TODO bridge.");
				return;
			}
			if (!quiet) setTodoLoading(true);
			try {
				const result = await bridge.workspaceTodos({
					frontendSessionId: store.activeSessionId ?? undefined,
				});
				if (requestSequence !== todoRequestSequence.current) return;
				setTodos(result);
				setTodoError(null);
			} catch (error) {
				if (requestSequence !== todoRequestSequence.current) return;
				setTodoError(
					error instanceof Error ? error.message : "Could not read workspace TODO files.",
				);
			} finally {
				if (requestSequence === todoRequestSequence.current) setTodoLoading(false);
			}
		},
		[store.activeSessionId],
	);

	useEffect(() => {
		if (!isOpen || store.rightPaneView !== "todo") return;
		setTodos(null);
		setTodoSaveError(null);
		void loadTodos();
		const interval = window.setInterval(() => void loadTodos(true), 4_000);
		return () => {
			window.clearInterval(interval);
			++todoRequestSequence.current;
		};
	}, [isOpen, loadTodos, store.rightPaneView]);

	const toggleTodo = async (filePath: string, node: WorkspaceTodoNode) => {
		if (!todos || todoSaveInFlight.current) return;
		const bridge = getRhyzaBridge();
		if (!bridge || typeof bridge.workspaceTodoUpdate !== "function") {
			setTodoSaveError("Restart Electron to load the workspace TODO editing bridge.");
			return;
		}
		const requestSequence = ++todoRequestSequence.current;
		todoSaveInFlight.current = true;
		setSavingTodoId(node.id);
		setTodoSaveError(null);
		try {
			const result = await bridge.workspaceTodoUpdate({
				frontendSessionId: store.activeSessionId ?? undefined,
				workspacePath: todos.workspacePath,
				path: filePath,
				line: node.line,
				text: node.text,
				expectedCompleted: node.completed,
				completed: !node.completed,
			});
			if (requestSequence !== todoRequestSequence.current) return;
			setTodos(result);
			setTodoError(null);
		} catch (error) {
			if (requestSequence !== todoRequestSequence.current) return;
			setTodoSaveError(
				error instanceof Error ? error.message : "Could not save the workspace TODO.",
			);
		} finally {
			todoSaveInFlight.current = false;
			setSavingTodoId(null);
			setTodoLoading(false);
		}
	};

	return (
		<>
			{isOpen && (
				<PanelResizeHandle
					side="right"
					label="Resize right panel"
					value={paneWidth}
					min={280}
					max={paneMax}
					defaultValue={340}
					onChange={paneSize.setValue}
					onCommit={paneSize.commit}
				/>
			)}
			<aside
				className={clsx("knowledge-pane", !isOpen && "is-closed")}
				aria-hidden={!isOpen}
				style={{
					width: isOpen ? paneWidth : 0,
					flexBasis: isOpen ? paneWidth : 0,
					maxWidth: "calc(100vw - 4rem)",
				}}
			>
				{isOpen &&
					(store.rightPaneView !== "todo" && inspectedTurn ? (
						<TurnInspectorPanel
							turn={inspectedTurn}
							turns={inspectedSessionTurns}
							view={store.rightPaneView}
							onClose={store.closeRightPane}
						/>
					) : (
						<TodoChecklistPanel
							todos={todos}
							loading={todoLoading}
							error={todoSaveError ?? todoError}
							savingTodoId={savingTodoId}
							onToggle={(filePath, node) => void toggleTodo(filePath, node)}
							onRefresh={() => {
								setTodoSaveError(null);
								void loadTodos();
							}}
							onClose={store.closeRightPane}
						/>
					))}
			</aside>
		</>
	);
};

function TodoChecklistPanel({
	todos,
	loading,
	error,
	savingTodoId,
	onToggle,
	onRefresh,
	onClose,
}: {
	todos: WorkspaceTodosResponse | null;
	loading: boolean;
	error: string | null;
	savingTodoId: string | null;
	onToggle: (filePath: string, node: WorkspaceTodoNode) => void;
	onRefresh: () => void;
	onClose: () => void;
}) {
	const progress = todos?.total ? Math.round((todos.completed / todos.total) * 100) : 0;
	return (
		<section className="workspace-todo-panel" aria-labelledby="workspace-todo-title">
			<header>
				<div className="min-w-0">
					<h2 id="workspace-todo-title">
						<ListChecks size={17} aria-hidden="true" /> Workspace TODOs
					</h2>
					<p title={todos?.workspacePath}>{todos?.workspacePath ?? "Current workspace"}</p>
				</div>
				<div className="workspace-todo-actions">
					<button
						type="button"
						title="刷新待办事项"
						aria-label="刷新工作区待办事项"
						disabled={loading || savingTodoId !== null}
						onClick={onRefresh}
					>
						<RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
					</button>
					<button type="button" title="关闭" aria-label="关闭工作区待办事项" onClick={onClose}>
						<X size={16} />
					</button>
				</div>
			</header>
			<div className="workspace-todo-scroll">
				{todos && todos.total > 0 && (
					<div className="workspace-todo-progress">
						<div>
							<strong>
								{todos.completed} of {todos.total} completed
							</strong>
							<span>{progress}%</span>
						</div>
						<progress
							value={todos.completed}
							max={todos.total}
							aria-label={`${todos.completed} of ${todos.total} workspace TODOs completed`}
						/>
					</div>
				)}
				{error && (
					<div className="workspace-todo-error" role="alert">
						<AlertCircle size={16} />
						<span>{error}</span>
					</div>
				)}
				{loading && !todos && <div className="workspace-todo-empty">正在加载工作区清单…</div>}
				{!loading && !error && todos?.files.length === 0 && (
					<div className="workspace-todo-empty">
						<ListChecks size={28} />
						<strong>未找到待办清单</strong>
						<span>创建包含 Markdown 复选框的 TODO.md，即可在此跟踪 Agent 进度。</span>
					</div>
				)}
				{todos?.files.map((file) => (
					<details className="workspace-todo-file" key={file.path} open>
						<summary>
							<ChevronDown size={15} className="workspace-todo-chevron" />
							<FileText size={15} />
							<span title={file.path}>{file.path}</span>
							<small>
								{file.completed}/{file.total}
							</small>
						</summary>
						<TodoTree
							nodes={file.nodes}
							savingTodoId={savingTodoId}
							onToggle={(node) => onToggle(file.path, node)}
						/>
					</details>
				))}
			</div>
		</section>
	);
}

function TodoTree({
	nodes,
	level = 1,
	savingTodoId,
	onToggle,
}: {
	nodes: WorkspaceTodoNode[];
	level?: number;
	savingTodoId: string | null;
	onToggle: (node: WorkspaceTodoNode) => void;
}) {
	return (
		<ul className="workspace-todo-tree" role={level === 1 ? "tree" : "group"}>
			{nodes.map((node) => (
				<li key={node.id} role="treeitem" aria-level={level} aria-checked={node.completed}>
					<button
						type="button"
						role="checkbox"
						aria-checked={node.completed}
						aria-label={
							savingTodoId === node.id
								? `正在保存：${node.text}`
								: `${node.completed ? "标记为未完成" : "标记为已完成"}：${node.text}`
						}
						aria-busy={savingTodoId === node.id}
						disabled={savingTodoId !== null}
						className={clsx("workspace-todo-node", node.completed && "is-complete")}
						onClick={() => onToggle(node)}
					>
						{savingTodoId === node.id ? (
							<RefreshCw size={16} className="animate-spin" aria-hidden="true" />
						) : node.completed ? (
							<CheckCircle2 size={16} aria-hidden="true" />
						) : (
							<Circle size={16} aria-hidden="true" />
						)}
						<span>{node.text}</span>
					</button>
					{node.children.length > 0 && (
						<TodoTree
							nodes={node.children}
							level={level + 1}
							savingTodoId={savingTodoId}
							onToggle={onToggle}
						/>
					)}
				</li>
			))}
		</ul>
	);
}
