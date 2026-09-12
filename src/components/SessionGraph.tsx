import clsx from "clsx";
import {
	ArrowDown,
	ArrowRight,
	CheckCircle2,
	Circle,
	CircleDot,
	ExternalLink,
	LocateFixed,
	GitBranch,
	LoaderCircle,
	PauseCircle,
	Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useAppStore } from "../store";
import type { SessionProgressStatus } from "../types";
import { formatTokens, usageTokens } from "../utils/branchUsage";
import { layoutSessionGraph, sessionGraphNodeSize, type SessionGraphOrientation } from "../utils/sessionGraph";
import { isTurnActive } from "../utils/sessionRuntime";
import { projectConversationGraph, type ConversationRound } from "../utils/conversationGraph";
import { IconSwitch } from "./IconSwitch";

const orientationStorageKey = "rhyza-session-graph-orientation";

interface SessionGraphNodeData {
	round: ConversationRound;
	preview: string;
	toolCount: number;
	childCount: number;
	isActive: boolean;
	isRunning: boolean;
	orientation: SessionGraphOrientation;
	usageTokens?: number;
	onSelect: (id: string) => void;
	onOpen: (id: string) => void;
}

const nodeTypes = { session: SessionGraphNode };

export function SessionGraph({ viewControl }: { viewControl?: ReactNode }) {
	const sessions = useAppStore((state) => state.sessions);
	const turns = useAppStore((state) => state.turns);
	const activeSessionId = useAppStore((state) => state.activeSessionId);
	const setActiveSession = useAppStore((state) => state.setActiveSession);
	const createRootSession = useAppStore((state) => state.createRootSession);
	const navigate = useNavigate();
	const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
	const [orientation, setOrientation] = useState<SessionGraphOrientation>(() => readOrientation());
	const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
	const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
	const projection = useMemo(() => projectConversationGraph(sessions, turns), [sessions, turns]);
	const activePath = projection.paths.get(activeSessionId ?? "") ?? [];
	const activeRoundId = selectedRoundId && activePath.includes(selectedRoundId) ? selectedRoundId : activePath[activePath.length - 1];
	const topology = JSON.stringify(projection.rounds.map(({ id, parentId }) => ({ id, parentId })));
	const positions = useMemo(() => new Map(layoutSessionGraph(JSON.parse(topology), orientation).map((node) => [node.id, node])), [topology, orientation]);
	const [displayPositions, setDisplayPositions] = useState(positions);
	const lastPositions = useRef(positions);
	useEffect(() => {
		const before = lastPositions.current;
		let frame = 0;
		const start = performance.now();
		const duration = reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
		const animate = () => {
			const progress = duration ? Math.min(1, (performance.now() - start) / duration) : 1;
			const eased = 1 - (1 - progress) ** 3;
			const next = new Map([...positions].map(([id, target]) => {
				const source = before.get(id) ?? target;
				return [id, { ...target, x: source.x + (target.x - source.x) * eased, y: source.y + (target.y - source.y) * eased }];
			}));
			lastPositions.current = next;
			setDisplayPositions(next);
			if (progress < 1) frame = requestAnimationFrame(animate);
		};
		frame = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(frame);
	}, [positions, reduceMotion]);

	const selectRound = useCallback((id: string) => {
		const round = projection.rounds.find((item) => item.id === id);
		if (!round) return;
		// Keep the current branch when selecting its shared history.
		const sessionId = activeSessionId && projection.paths.get(activeSessionId)?.includes(id) ? activeSessionId : round.sessionId;
		const turnId = projection.targets.get(sessionId)?.get(id);
		if (turnId) window.sessionStorage.setItem("rhyza-focus-turn", turnId);
		else window.sessionStorage.removeItem("rhyza-focus-turn");
		setSelectedRoundId(id);
		setActiveSession(sessionId);
		navigate("/");
		if (turnId) window.dispatchEvent(new CustomEvent("rhyza:focus-turn", { detail: { turnId } }));
	}, [navigate, setActiveSession, projection, activeSessionId]);

	const graph = useMemo(() => buildGraph({
		rounds: projection.rounds,
		activePath,
		activeRoundId,
		orientation,
		positions: displayPositions,
		onSelect: selectRound,
	}), [activePath, activeRoundId, orientation, displayPositions, selectRound, projection.rounds]);

	useEffect(() => {
		window.localStorage.setItem(orientationStorageKey, orientation);
	}, [orientation]);
	// Fit once after the sidebar's opening transition. Subsequent resizing must
	// preserve the user's viewport, including zoom and pan.
	useEffect(() => {
		if (!flow) return;
		const timer = window.setTimeout(() => void flow.fitView({ padding: 0.18, duration: 0 }), 360);
		return () => window.clearTimeout(timer);
	}, [flow]);

	const focusActive = () => {
		const node = graph.nodes.find((item) => item.id === activeRoundId);
		if (!node || !flow) return;
		void flow.setCenter(
			node.position.x + sessionGraphNodeSize.width / 2,
			node.position.y + sessionGraphNodeSize.height / 2,
			{ zoom: flow.getZoom(), duration: reduceMotion ? 0 : 280 },
		);
	};

	const createSession = () => {
		createRootSession();
		navigate("/");
	};

	return (
		<section className="session-graph-page" aria-label="Conversation graph">
			<header className="session-graph-toolbar">
				<div className="session-graph-heading">
					<div><h1>Chats <span className="graph-round-count">{projection.rounds.filter((round) => round.user).length} rounds</span></h1></div>
				</div>
				<div className="session-graph-actions">
					{viewControl}
					<span className="graph-toolbar-divider" aria-hidden="true" />
					<IconSwitch checked={orientation === "vertical"} onChange={(vertical) => setOrientation(vertical ? "vertical" : "horizontal")} icon={orientation === "vertical" ? ArrowDown : ArrowRight} label="Vertical layout" description="On: top to bottom. Off: left to right. Nodes move smoothly between layouts." />
					<button type="button" className="secondary-button" onClick={focusActive} disabled={!activeSessionId} title="Locate current round" aria-label="Locate current round"><LocateFixed size={16} /></button>
					<button type="button" className="secondary-button" onClick={createSession} title="New chat" aria-label="New chat"><Plus size={16} /></button>
				</div>
			</header>
			<div className="session-graph-canvas">
				{sessions.length ? (
					<ReactFlow
						nodes={graph.nodes}
						edges={graph.edges}
						nodeTypes={nodeTypes}
						onInit={setFlow}
						fitView
						fitViewOptions={{ padding: 0.18 }}
						minZoom={0.2}
						maxZoom={1.65}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable
						proOptions={{ hideAttribution: true }}
					>
						<Background color="#cbd5e1" gap={22} size={1} />
						<Controls showInteractive={false} />
						{/* MiniMap uses numeric style dimensions for its SVG and viewport math. */}
						<MiniMap style={{ width: 100, height: 70 }} pannable zoomable nodeColor={(node) => node.id === activeRoundId ? "#10a37f" : "#a8b4c5"} maskColor="rgb(248 250 252 / 76%)" />
					</ReactFlow>
				) : (
					<div className="session-graph-empty"><GitBranch size={38} /><strong>No conversations yet</strong><span>Create a chat to start growing your graph.</span><button type="button" className="command-button" onClick={createSession}><Plus size={15} /> New chat</button></div>
				)}
			</div>
			<footer className="session-graph-footer"><span>Drag to pan · scroll to zoom · click a node to chat</span></footer>
		</section>
	);
}

function SessionGraphNode({ data }: NodeProps<SessionGraphNodeData>) {
	const updateNodeInternals = useUpdateNodeInternals();
	useEffect(() => { updateNodeInternals(data.round.id); }, [data.orientation, data.round.id, updateNodeInternals]);
	const sourcePosition = data.orientation === "horizontal" ? Position.Right : Position.Bottom;
	const targetPosition = data.orientation === "horizontal" ? Position.Left : Position.Top;
	const ProgressIcon = progressIcon(data.isRunning ? "in_progress" : data.round.answers.length ? "complete" : undefined);
	return (
		<div className={clsx("session-graph-node", data.isActive && "is-active", data.isRunning && "is-running")}>
			<Handle type="target" position={targetPosition} isConnectable={false} />
			<button type="button" className="session-graph-node-main" onClick={() => data.onSelect(data.round.id)} aria-current={data.isActive ? "page" : undefined}>
				<header><span className="session-graph-status"><ProgressIcon size={13} /></span><strong title={data.round.user?.content || data.round.title}>{data.round.title}</strong>{data.isRunning && <LoaderCircle size={13} className="animate-spin" />}</header>
				<p>{data.preview || (data.round.user ? "Waiting for response" : "Start a new conversation")}</p>
				<footer><span>{data.round.user ? "1 round" : "New branch"}</span>{data.toolCount > 0 && <span>{data.toolCount} tools</span>}{data.childCount > 1 && <span><GitBranch size={11} /> {data.childCount}</span>}{data.usageTokens !== undefined && <span>{formatTokens(data.usageTokens)} tokens</span>}</footer>
			</button>
			<button type="button" className="session-graph-open nodrag" onClick={() => data.onOpen(data.round.id)} title="Go to this round" aria-label={`Go to ${data.round.title}`}><ExternalLink size={13} /></button>
			<Handle type="source" position={sourcePosition} isConnectable={false} />
		</div>
	);
}

function buildGraph({ rounds, activePath, activeRoundId, orientation, positions, onSelect }: {
	rounds: ConversationRound[];
	activePath: string[];
	activeRoundId?: string;
	orientation: SessionGraphOrientation;
	positions: Map<string, { x: number; y: number }>;
	onSelect: (id: string) => void;
}): { nodes: Array<Node<SessionGraphNodeData>>; edges: Edge[] } {
	const children = new Map<string, number>();
	for (const round of rounds) if (round.parentId) children.set(round.parentId, (children.get(round.parentId) ?? 0) + 1);
	const activeIds = new Set(activePath);
	const byId = new Map(rounds.map((round) => [round.id, round]));
	const nodes = rounds.map((round): Node<SessionGraphNodeData> => {
		const usage = round.answers.reduce((total, turn) => total + (turn.usage ? usageTokens(turn.usage) : 0), 0);
		return {
			id: round.id,
			type: "session",
			position: positions.get(round.id) ?? { x: 0, y: 0 },
			data: {
				round,
				preview: clipPreview(round.answers.map((turn) => turn.content || turn.summary || "").join(" ")),
				toolCount: round.answers.reduce((total, turn) => total + (turn.tools?.length ?? 0), 0),
				childCount: children.get(round.id) ?? 0,
				isActive: round.id === activeRoundId,
				isRunning: round.answers.some(isTurnActive),
				orientation,
				usageTokens: usage || undefined,
				onSelect,
				onOpen: onSelect,
			},
		};
	});
	const edges = rounds.flatMap((round): Edge[] => round.parentId && byId.has(round.parentId) ? [{
		id: `${round.parentId}:${round.id}`,
		source: round.parentId,
		target: round.id,
		type: "smoothstep",
		animated: round.answers.some(isTurnActive),
		className: clsx(activeIds.has(round.parentId) && activeIds.has(round.id) && "is-active", round.answers.some(isTurnActive) && "is-running"),
		markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
	}] : []);
	return { nodes, edges };
}

function progressIcon(status?: SessionProgressStatus) {
	if (status === "in_progress") return CircleDot;
	if (status === "complete") return CheckCircle2;
	if (status === "parked") return PauseCircle;
	return Circle;
}

function clipPreview(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 92 ? `${normalized.slice(0, 89)}…` : normalized;
}

function readOrientation(): SessionGraphOrientation {
	if (typeof window === "undefined") return "horizontal";
	return window.localStorage.getItem(orientationStorageKey) === "vertical" ? "vertical" : "horizontal";
}
