import { useHoverRetention } from "../hooks/useHoverRetention";
import clsx from "clsx";
import { ArrowDown, ArrowRight, GitBranch, Plus, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import ReactFlow, {
	Background,
	Controls,
	Handle,
	MarkerType,
	MiniMap,
	Position,
	useUpdateNodeInternals,
	type Edge,
	type Node,
	type NodeProps,
	type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import "./sessionGraphInteraction.css";
import { useAppStore } from "../store";
import { UnreadIndicator } from "./UnreadIndicator";
import { isTurnUnread } from "../utils/turnReadState";
import { useConversationFocus } from "../store/conversationFocus";
import type { SessionNode, SessionProgressStatus } from "../types";
import { NodeInformation } from "./NodeInformation";
import { CacheStatus } from "./chat/CacheStatus";
import { lastCacheRequest } from "../utils/cacheStatus";
import { formatChatTimestamp, formatFullChatTimestamp } from "../utils/chatTimestamp";
import { SessionNodeContextMenu, useSessionContextMenu } from "./SessionContextMenu";
import { executionAppearance, roundMetrics } from "../utils/roundMetrics";
import { ProgressMarker } from "./ProgressMarker";
import {
	groupSummarySourceEdges,
	layoutSessionGraph,
	type SessionGraphOrientation,
	type SummarySourceGroup,
} from "../utils/sessionGraph";
import { isTurnActive } from "../utils/sessionRuntime";
import { projectConversationGraph, type ConversationRound } from "../utils/conversationGraph";
import { IconSwitch } from "./IconSwitch";
import { graphMaxZoom, useGraphFocus } from "../hooks/useGraphFocus";
import { TurnBubbleContent } from "./chat/TurnMessage";
import { useKnowledgePreviewActions } from "../hooks/useKnowledgePreview";
import { graphPreviewPosition } from "../utils/graphPreviewPosition";
import { ConversationPathEdge } from "./ConversationPathEdge";
import { createGraphPreviewOwner } from "../utils/graphPreviewOwner";
import { filterConversationRounds, type LeafStatusFilter } from "../utils/conversationFilter";
import { usePathSummarySelection } from "./PathSummarySelection";
import { summarySourceEdges } from "../utils/pathSummary";
import { useTranslation } from "../i18n";

const orientationStorageKey = "rhyza-session-graph-orientation";

interface SessionGraphNodeData {
	round: ConversationRound;
	preview: string;
	progressStatus?: SessionProgressStatus;
	isActive: boolean;
	isRunning: boolean;
	isLeaf: boolean;
	previewOwner: ReturnType<typeof createGraphPreviewOwner>;
	orientation: SessionGraphOrientation;
	onSelect: (id: string, additive: boolean) => void;
	selecting: boolean;
	isSelected: boolean;
	isSelectedAncestor: boolean;
	isSummarySource: boolean;
	selectionRunning: boolean;
}

interface SummaryJunctionData {
	orientation: SessionGraphOrientation;
}

const nodeTypes = { session: SessionGraphNode, summaryJunction: SummaryJunctionNode };
const edgeTypes = { conversation: ConversationPathEdge };
const edgeArrow = {
	type: MarkerType.ArrowClosed,
	width: 14,
	height: 14,
	color: "var(--color-secondary)",
};

export function SessionGraph({
	viewControl,
	visible = true,
	leafStatuses = [],
	onClearFilter,
}: {
	viewControl?: ReactNode;
	visible?: boolean;
	leafStatuses?: readonly LeafStatusFilter[];
	onClearFilter?: () => void;
}) {
	const selection = usePathSummarySelection();
	const sessions = useAppStore((state) => state.sessions);
	const turns = useAppStore((state) => state.turns);
	const activeSessionId = useAppStore((state) => state.activeSessionId);
	const setActiveSession = useAppStore((state) => state.setActiveSession);
	const createRootSession = useAppStore((state) => state.createRootSession);
	const navigate = useNavigate();
	const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
	const [orientation, setOrientation] = useState<SessionGraphOrientation>(() => readOrientation());
	const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const previewOwner = useMemo(createGraphPreviewOwner, []);
	useEffect(() => {
		if (!visible) previewOwner.close();
		return () => previewOwner.close();
	}, [visible, previewOwner]);
	const focus = useConversationFocus();
	const projection = useMemo(() => projectConversationGraph(sessions, turns), [sessions, turns]);
	const visibleRounds = useMemo(
		() => filterConversationRounds(projection.rounds, sessions, leafStatuses),
		[projection, sessions, leafStatuses],
	);
	const activePath = projection.paths.get(activeSessionId ?? "") ?? [];
	const focusedRoundId =
		focus.sessionId === activeSessionId && focus.turnId
			? projection.roundByTurnId.get(focus.turnId)
			: undefined;
	const activeRoundId = focusedRoundId ?? activePath[activePath.length - 1];
	const topology = JSON.stringify(visibleRounds.map(({ id, parentId }) => ({ id, parentId })));
	const summaryEdges = useMemo(() => summarySourceEdges(visibleRounds), [visibleRounds]);
	const summaryGroups = useMemo(() => groupSummarySourceEdges(summaryEdges), [summaryEdges]);
	const activeSummarySources = useMemo(
		() =>
			new Set(
				summaryEdges.filter((edge) => edge.target === activeRoundId).map((edge) => edge.source),
			),
		[summaryEdges, activeRoundId],
	);
	const summaryEdgeTopology = JSON.stringify(summaryGroups);
	const visibleIds = JSON.stringify(visibleRounds.map((round) => round.id));
	const reportVisible = selection.reportVisible;
	useEffect(() => {
		reportVisible("graph", visible ? JSON.parse(visibleIds) : null);
		return () => reportVisible("graph", null);
	}, [visible, visibleIds, reportVisible]);
	const selectedAncestors = useMemo(() => {
		const byId = new Map(projection.rounds.map((round) => [round.id, round]));
		const ids = new Set<string>();
		for (const selected of selection.selected) {
			let round = byId.get(selected);
			while (round?.parentId && !ids.has(round.parentId)) {
				ids.add(round.parentId);
				round = byId.get(round.parentId);
			}
		}
		return ids;
	}, [projection, selection.selected]);
	const positions = useMemo(
		() =>
			new Map(
				layoutSessionGraph(JSON.parse(topology), orientation, JSON.parse(summaryEdgeTopology)).map(
					(node) => [node.id, node],
				),
			),
		[topology, orientation, summaryEdgeTopology],
	);
	const [displayPositions, setDisplayPositions] = useState(positions);
	const lastPositions = useRef(positions);
	useEffect(() => {
		const before = lastPositions.current;
		let frame = 0;
		const start = performance.now();
		const duration =
			reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
		const animate = () => {
			const progress = duration ? Math.min(1, (performance.now() - start) / duration) : 1;
			const eased = 1 - (1 - progress) ** 3;
			const next = new Map(
				[...positions].map(([id, target]) => {
					const source = before.get(id) ?? target;
					return [
						id,
						{
							...target,
							x: source.x + (target.x - source.x) * eased,
							y: source.y + (target.y - source.y) * eased,
						},
					];
				}),
			);
			lastPositions.current = next;
			setDisplayPositions(next);
			if (progress < 1) frame = requestAnimationFrame(animate);
		};
		frame = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(frame);
	}, [positions, reduceMotion]);

	const selectRound = useCallback(
		(id: string, additive: boolean) => {
			if (selection.selecting) {
				selection.toggle(id);
				return;
			}
			if (additive) {
				selection.begin([id]);
				return;
			}
			const round = projection.rounds.find((item) => item.id === id);
			if (!round) return;
			// Keep the current branch when selecting its shared history.
			const sessionId =
				activeSessionId && projection.paths.get(activeSessionId)?.includes(id)
					? activeSessionId
					: round.sessionId;
			const turnId = projection.targets.get(sessionId)?.get(id);
			if (turnId) window.sessionStorage.setItem("rhyza-focus-turn", turnId);
			else window.sessionStorage.removeItem("rhyza-focus-turn");
			useConversationFocus.getState().setFocus(sessionId, turnId ?? null);
			setActiveSession(sessionId);
			navigate("/");
			if (turnId) window.dispatchEvent(new CustomEvent("rhyza:focus-turn", { detail: { turnId } }));
		},
		[
			navigate,
			setActiveSession,
			projection,
			activeSessionId,
			selection.selecting,
			selection.toggle,
			selection.begin,
		],
	);

	const graph = useMemo(
		() =>
			buildGraph({
				rounds: visibleRounds,
				sessions,
				activeRoundId,
				activePath,
				previewOwner,
				orientation,
				positions: displayPositions,
				onSelect: selectRound,
				selecting: selection.selecting,
				selected: selection.selected,
				selectedAncestors,
				activeSummarySources,
				selectionRunning: selection.running,
				summaryGroups,
			}),
		[
			activeRoundId,
			activePath,
			previewOwner,
			orientation,
			displayPositions,
			selectRound,
			visibleRounds,
			sessions,
			selection.selecting,
			selection.selected,
			selection.running,
			selectedAncestors,
			activeSummarySources,
			summaryGroups,
		],
	);

	useEffect(() => {
		window.localStorage.setItem(orientationStorageKey, orientation);
	}, [orientation]);
	const { interrupt } = useGraphFocus(
		flow,
		canvasRef,
		visible,
		activeRoundId,
		positions.get(activeRoundId ?? ""),
		reduceMotion,
	);
	const lastSummaryTopology = useRef(summaryEdgeTopology);
	useEffect(() => {
		if (selection.selecting || lastSummaryTopology.current !== summaryEdgeTopology) interrupt();
		lastSummaryTopology.current = summaryEdgeTopology;
	}, [selection.selecting, summaryEdgeTopology, interrupt]);

	const createSession = () => {
		createRootSession();
		navigate("/");
	};

	return (
		<section className="session-graph-page" aria-label="对话关系图">
			<header className="session-graph-toolbar">
				<div className="session-graph-heading">
					<div>
						<h1>
							Chats{" "}
							<span className="graph-round-count">
								{visibleRounds.filter((round) => round.user).length} rounds
							</span>
						</h1>
					</div>
				</div>
				<div className="session-graph-actions">
					{viewControl}
					<span className="graph-toolbar-divider" aria-hidden="true" />
					<IconSwitch
						checked={orientation === "vertical"}
						onChange={(vertical) => setOrientation(vertical ? "vertical" : "horizontal")}
						icon={orientation === "vertical" ? ArrowDown : ArrowRight}
						label="Vertical layout"
						description="On: top to bottom. Off: left to right. Nodes move smoothly between layouts."
					/>
					<button
						type="button"
						className="secondary-button"
						onClick={createSession}
						title="新建对话"
						aria-label="新建对话"
					>
						<Plus size={16} />
					</button>
				</div>
			</header>
			<div
				ref={canvasRef}
				className="session-graph-canvas"
				onPointerDownCapture={interrupt}
				onWheelCapture={interrupt}
			>
				{visibleRounds.length ? (
					<ReactFlow
						nodes={graph.nodes}
						edges={graph.edges}
						nodeTypes={nodeTypes}
						edgeTypes={edgeTypes}
						onInit={setFlow}
						defaultViewport={{ x: 0, y: 0, zoom: graphMaxZoom }}
						onMoveStart={(event) => {
							if (event) interrupt();
						}}
						minZoom={0.2}
						maxZoom={graphMaxZoom}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable
						proOptions={{ hideAttribution: true }}
					>
						<Background color="var(--ui-border)" gap={22} size={1} />
						<Controls
							showInteractive={false}
							onZoomIn={interrupt}
							onZoomOut={interrupt}
							onFitView={interrupt}
						/>
						{/* MiniMap uses numeric style dimensions for its SVG and viewport math. */}
						<MiniMap
							style={{ width: 100, height: 70 }}
							pannable
							zoomable
							nodeColor={(node) =>
								node.id === activeRoundId ? "var(--ui-brand-accent)" : "var(--color-secondary)"
							}
							maskColor="rgb(238 242 255 / 76%)"
						/>
					</ReactFlow>
				) : leafStatuses.length > 0 ? (
					<div className="session-filter-empty" role="status">
						<p>没有符合这些状态的末端节点。</p>
						<button type="button" className="secondary-button" onClick={onClearFilter}>
							Clear filter
						</button>
					</div>
				) : (
					<div className="session-graph-empty">
						<GitBranch size={38} />
						<strong>还没有对话</strong>
						<span>新建对话，开始构建你的思路网络。</span>
						<button type="button" className="command-button" onClick={createSession}>
							<Plus size={15} /> New chat
						</button>
					</div>
				)}
			</div>
			<footer className="session-graph-footer">
				<span>拖动平移 · 滚动缩放 · 点击节点开始对话</span>
			</footer>
		</section>
	);
}

function SessionGraphNode({ data }: NodeProps<SessionGraphNodeData>) {
	const { t } = useTranslation();
	const updateNodeInternals = useUpdateNodeInternals();
	const { menu, openMenu, closeMenu } = useSessionContextMenu();
	const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
	const [informationCloseSignal, setInformationCloseSignal] = useState(0);
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!data.isRunning) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [data.isRunning]);
	const metrics = roundMetrics(data.round, now);
	const cacheRequest = lastCacheRequest(data.round.answers);
	const execution = executionAppearance(metrics.status);
	const roundCreatedAt = data.round.user?.createdAt ?? data.round.answers[0]?.createdAt;
	const timestamp = roundCreatedAt ? formatChatTimestamp(roundCreatedAt) : "";
	const [previewRect, setPreviewRect] = useState<{ anchor: DOMRect; graph: DOMRect } | null>(null);
	const previewGraph = useRef<Element | null>(null);
	const previewSource = useRef<HTMLButtonElement>(null);
	const previewPanel = useRef<HTMLDivElement>(null);
	const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const hidePreview = useCallback(() => {
		clearTimeout(previewTimer.current);
		setPreviewRect(null);
		data.previewOwner.release(data.round.id);
	}, [data.previewOwner, data.round.id]);
	const previewHover = useHoverRetention(
		Boolean(previewRect),
		previewSource,
		previewPanel,
		hidePreview,
	);
	const showPreview = (element: HTMLElement) => {
		if (menu || data.selecting) return;
		data.previewOwner.claim(data.round.id, hidePreview);
		previewHover.retain();
		clearTimeout(previewTimer.current);
		previewTimer.current = setTimeout(() => {
			if (!data.previewOwner.owns(data.round.id)) return;
			setInformationCloseSignal((value) => value + 1);
			const graph = element.closest(".session-graph-canvas");
			previewGraph.current = graph;
			if (graph)
				setPreviewRect({
					anchor: element.getBoundingClientRect(),
					graph: graph.getBoundingClientRect(),
				});
		}, 220);
	};
	const leavePreview = () => {
		clearTimeout(previewTimer.current);
		if (previewRect) previewHover.leave();
		else data.previewOwner.release(data.round.id);
	};
	useEffect(() => {
		const unsubscribe = useConversationFocus.subscribe(hidePreview);
		return () => {
			unsubscribe();
			clearTimeout(previewTimer.current);
			data.previewOwner.release(data.round.id);
		};
	}, [hidePreview, data.previewOwner, data.round.id]);
	useEffect(() => {
		if (!previewRect) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") hidePreview();
		};
		window.addEventListener("keydown", closeOnEscape);
		window.addEventListener("resize", hidePreview);
		return () => {
			window.removeEventListener("keydown", closeOnEscape);
			window.removeEventListener("resize", hidePreview);
		};
	}, [previewRect, hidePreview]);
	useEffect(() => {
		if (!previewRect) return;
		// Ignore the observer's initial measurement; dismiss if sidebar resizing
		// makes the saved placement stale.
		let initial = true;
		const resizeObserver = new ResizeObserver(() => {
			if (initial) initial = false;
			else hidePreview();
		});
		if (previewGraph.current) resizeObserver.observe(previewGraph.current);
		return () => resizeObserver.disconnect();
	}, [previewRect, hidePreview]);
	useEffect(() => {
		updateNodeInternals(data.round.id);
	}, [data.orientation, data.round.id, updateNodeInternals]);
	const sourcePosition = data.orientation === "horizontal" ? Position.Right : Position.Bottom;
	const targetPosition = data.orientation === "horizontal" ? Position.Left : Position.Top;
	const sourcePaths = data.round.user?.pathSummary?.sources;
	return (
		<div
			className={clsx(
				"session-graph-node",
				data.isActive && "is-active",
				`execution-${execution}`,
				reduceMotion && "reduce-motion",
				data.selecting && !data.selectionRunning && data.isSelected && "is-summary-selected",
				data.selecting &&
					!data.selectionRunning &&
					data.isSelectedAncestor &&
					"is-summary-ancestor",
				data.isSummarySource && "is-summary-source",
			)}
			data-execution-status={metrics.status}
			onClick={() => {
				if (data.selecting && !data.selectionRunning) data.onSelect(data.round.id, false);
			}}
			onContextMenu={(event) => {
				hidePreview();
				if (data.selecting) {
					event.preventDefault();
					return;
				}

				openMenu(event, data.round.sessionId);
			}}
		>
			{execution === "running" && (
				<svg className="graph-execution-ring" aria-hidden="true">
					<rect x="1" y="1" width="278" height="134" rx="11" pathLength="100" />
				</svg>
			)}
			<Handle type="target" position={targetPosition} isConnectable={false} />
			<button
				ref={previewSource}
				type="button"
				className="session-graph-node-main"
				onClick={(event) => {
					event.stopPropagation();
					data.onSelect(data.round.id, event.ctrlKey || event.metaKey);
				}}
				disabled={data.selecting && data.selectionRunning}
				aria-pressed={data.selecting && !data.selectionRunning ? data.isSelected : undefined}
				aria-label={`${data.round.title}. Execution: ${metrics.status.replace(/_/g, " ")}`}
				aria-current={data.isActive ? "page" : undefined}
				aria-describedby={previewRect ? `round-preview-${data.round.id}` : undefined}
				onMouseEnter={(event) => showPreview(event.currentTarget)}
				onMouseLeave={leavePreview}
				onFocus={(event) => showPreview(event.currentTarget)}
				onBlur={leavePreview}
				onPointerDown={hidePreview}
			>
				<header>
					<ProgressMarker status={data.progressStatus} active={false} />
					<strong>{data.round.title}</strong>
					{!data.isRunning && data.round.answers.some(isTurnUnread) && <UnreadIndicator />}
					{sourcePaths && (
						<span className="summary-node-badge" title={t("Summary")}>
							<FileText size={12} /> {sourcePaths.length}
						</span>
					)}
					{roundCreatedAt && timestamp && (
						<time
							className="session-graph-node-time"
							dateTime={roundCreatedAt}
							title={formatFullChatTimestamp(roundCreatedAt)}
						>
							{timestamp}
						</time>
					)}
				</header>
				<p className={clsx(sourcePaths && "summary-node-preview")}>
					{data.preview || (data.round.user ? "Waiting for response" : "Start a new conversation")}
				</p>
				{sourcePaths && (
					<div
						className="summary-node-sources"
						title={sourcePaths.map((source) => source.title).join(" · ")}
					>
						<span>{t("Source paths")}:</span>
						{sourcePaths.slice(0, 2).map((source) => (
							<span key={source.roundId} className="summary-node-source" title={source.title}>
								{source.title}
							</span>
						))}
						{sourcePaths.length > 2 && <span>+{sourcePaths.length - 2}</span>}
					</div>
				)}
			</button>
			{data.isLeaf && <CacheStatus compact request={cacheRequest} />}
			<NodeInformation
				metrics={metrics}
				cacheRequest={cacheRequest}
				nodeId={data.round.id}
				closeSignal={informationCloseSignal}
				disabled={Boolean(menu)}
				onOpen={hidePreview}
			/>
			{menu && (
				<SessionNodeContextMenu
					anchor={menu}
					nodeId={menu.nodeId}
					turnId={data.round.answers[data.round.answers.length - 1]?.id ?? data.round.user?.id}
					roundId={data.round.id}
					onClose={closeMenu}
				/>
			)}
			<Handle type="source" position={sourcePosition} isConnectable={false} />
			{previewRect &&
				createPortal(
					<div
						ref={previewPanel}
						id={`round-preview-${data.round.id}`}
						role="tooltip"
						className="graph-content-preview"
						style={graphPreviewPosition(previewRect.anchor, previewRect.graph, {
							width: window.innerWidth,
							height: window.innerHeight,
						})}
						onMouseEnter={previewHover.retain}
						onMouseLeave={leavePreview}
						onFocus={previewHover.retain}
						onBlur={leavePreview}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<header>对话预览</header>
						<RoundPreviewContent round={data.round} />
					</div>,
					document.body,
				)}
		</div>
	);
}

function RoundPreviewContent({ round }: { round: ConversationRound }) {
	const entities = useAppStore((state) => state.entities);
	const relations = useAppStore((state) => state.relations);
	const diagrams = useAppStore((state) => state.diagrams);
	const { openEntityById, openDiagramById } = useKnowledgePreviewActions();
	const turns = round.user ? [round.user, ...round.answers] : round.answers;
	return (
		<>
			{turns.map((turn) => (
				<section key={turn.id}>
					<strong>{turn.role === "user" ? "You" : "Agent"}</strong>
					<div
						className={clsx("turn-body", turn.role === "user" ? "user-bubble" : "assistant-body")}
					>
						<TurnBubbleContent
							turn={turn}
							entities={entities}
							relations={relations}
							diagrams={diagrams}
							onEntityClick={openEntityById}
							onDiagramClick={openDiagramById}
						/>
					</div>
				</section>
			))}
			{!round.answers.length && (
				<section>
					<p>{round.user ? "Waiting for response" : round.title}</p>
				</section>
			)}
		</>
	);
}

function SummaryJunctionNode({ data }: NodeProps<SummaryJunctionData>) {
	const sourcePosition = data.orientation === "horizontal" ? Position.Right : Position.Bottom;
	const targetPosition = data.orientation === "horizontal" ? Position.Left : Position.Top;
	return (
		<div className="summary-graph-junction" aria-hidden="true">
			<Handle type="target" position={targetPosition} isConnectable={false} />
			<Handle type="source" position={sourcePosition} isConnectable={false} />
		</div>
	);
}

function buildGraph({
	rounds,
	sessions,
	activeRoundId,
	activePath,
	previewOwner,
	orientation,
	positions,
	onSelect,
	selecting,
	selected,
	selectedAncestors,
	activeSummarySources,
	selectionRunning,
	summaryGroups,
}: {
	rounds: ConversationRound[];
	sessions: SessionNode[];
	activeRoundId?: string;
	activePath: string[];
	previewOwner: ReturnType<typeof createGraphPreviewOwner>;
	orientation: SessionGraphOrientation;
	positions: Map<string, { x: number; y: number }>;
	onSelect: (id: string, additive: boolean) => void;
	selecting: boolean;
	selected: ReadonlySet<string>;
	selectedAncestors: ReadonlySet<string>;
	activeSummarySources: ReadonlySet<string>;
	selectionRunning: boolean;
	summaryGroups: readonly SummarySourceGroup[];
}): {
	nodes: Array<Node<SessionGraphNodeData> | Node<SummaryJunctionData>>;
	edges: Edge[];
} {
	const bySession = new Map(sessions.map((session) => [session.id, session]));
	const parents = new Set(rounds.map((round) => round.parentId));
	const byId = new Map(rounds.map((round) => [round.id, round]));
	const activeEdges = new Set(activePath.slice(1).map((id, index) => `${activePath[index]}:${id}`));
	const nodes: Array<Node<SessionGraphNodeData> | Node<SummaryJunctionData>> = rounds.map(
		(round): Node<SessionGraphNodeData> => {
			return {
				id: round.id,
				type: "session",
				position: positions.get(round.id) ?? { x: 0, y: 0 },
				data: {
					round,
					preview: clipPreview(
						round.answers.map((turn) => turn.content || turn.summary || "").join(" "),
					),
					progressStatus: bySession.get(round.sessionId)?.progressStatus,
					isActive: round.id === activeRoundId,
					isRunning: round.answers.some(isTurnActive),
					isLeaf: !parents.has(round.id),
					previewOwner,
					orientation,
					onSelect,
					selecting,
					isSelected: selected.has(round.id),
					isSelectedAncestor: selectedAncestors.has(round.id),
					isSummarySource: activeSummarySources.has(round.id),
					selectionRunning,
				},
			};
		},
	);
	nodes.push(
		...summaryGroups.map((group): Node<SummaryJunctionData> => ({
			id: group.id,
			type: "summaryJunction",
			position: positions.get(group.id) ?? { x: 0, y: 0 },
			selectable: false,
			data: { orientation },
		})),
	);
	const edges = rounds.flatMap((round): Edge[] =>
		round.parentId && byId.has(round.parentId)
			? [
					{
						id: `${round.parentId}:${round.id}`,
						source: round.parentId,
						target: round.id,
						type: "conversation",
						data: { active: activeEdges.has(`${round.parentId}:${round.id}`) },
						className: clsx(
							activeEdges.has(`${round.parentId}:${round.id}`) && "is-active",
							round.answers.some(isTurnActive) && "is-running",
						),
						markerEnd: edgeArrow,
					},
				]
			: [],
	);
	for (const group of summaryGroups) {
		const activeGroup = group.targets.includes(activeRoundId ?? "");
		for (const source of group.sources) {
			edges.push({
				id: `summary-source:${source}:${group.id}`,
				source,
				target: group.id,
				type: "conversation",
				data: { active: activeGroup },
				className: clsx("summary-provenance-edge", activeGroup && "is-active"),
				style: { strokeDasharray: "5 5" },
			});
		}
		for (const target of group.targets) {
			const active = target === activeRoundId;
			edges.push({
				id: `summary-target:${group.id}:${target}`,
				source: group.id,
				target,
				type: "conversation",
				data: { active },
				className: clsx("summary-provenance-edge", active && "is-active"),
				style: { strokeDasharray: "5 5" },
				markerEnd: edgeArrow,
			});
		}
	}
	return { nodes, edges };
}

function clipPreview(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 92 ? `${normalized.slice(0, 89)}…` : normalized;
}

function readOrientation(): SessionGraphOrientation {
	if (typeof window === "undefined") return "horizontal";
	return window.localStorage.getItem(orientationStorageKey) === "vertical"
		? "vertical"
		: "horizontal";
}
