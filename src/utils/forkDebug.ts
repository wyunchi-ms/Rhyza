import type { SessionNode, Turn } from "../types";
import type {
	SelectionContinuationTarget,
	SessionForkResult,
	SessionForkState,
} from "./sessionFork";

export const forkDebugEventName = "rhyza:fork-debug";

export interface ForkDebugEventDetail {
	ok: boolean;
	message: string;
}

interface ForkDebugTreeNode {
	sessionId: string;
	title: string;
	parentSessionId: string | null;
	turns: Array<{ id: string; role: Turn["role"]; summary?: string; sourceTurnId?: string }>;
	children: ForkDebugTreeNode[];
}

export interface ForkDebugSnapshot {
	timestamp: string;
	selectedTurnId: string;
	forkEvent: {
		selectedTurn: ReturnType<typeof serializeTurn> | null;
		sourceTurn: ReturnType<typeof serializeTurn> | null;
		branchPointSessionId: string;
		originalSessionId: string;
		forkSessionId: string;
	};
	before: ReturnType<typeof serializeState>;
	after: ReturnType<typeof serializeState>;
	beforeTree: ReturnType<typeof serializeTree>;
	afterTree: ReturnType<typeof serializeTree>;
}

export function createForkDebugSnapshot(
	before: SessionForkState,
	selectedTurnId: string,
	after: SessionForkResult,
): ForkDebugSnapshot {
	const selectedTurn = before.turns.find((turn) => turn.id === selectedTurnId);
	const sourceTurn = selectedTurn?.sourceTurnId
		? before.turns.find((turn) => turn.id === selectedTurn.sourceTurnId)
		: undefined;
	return {
		timestamp: new Date().toISOString(),
		selectedTurnId,
		forkEvent: {
			selectedTurn: selectedTurn ? serializeTurn(selectedTurn, before.turns) : null,
			sourceTurn: sourceTurn ? serializeTurn(sourceTurn, before.turns) : null,
			branchPointSessionId: after.branchPointSessionId,
			originalSessionId: after.originalSessionId,
			forkSessionId: after.forkSessionId,
		},
		before: serializeState(before.sessions, before.turns),
		after: serializeState(after.sessions, after.turns),
		beforeTree: serializeTree(before.sessions, before.turns),
		afterTree: serializeTree(after.sessions, after.turns),
	};
}

export function createSelectionAppendDebugSnapshot(
	state: SessionForkState,
	selectedTurnId: string,
	target: SelectionContinuationTarget,
) {
	const selectedTurn = state.turns.find((turn) => turn.id === selectedTurnId);
	const sourceTurn = selectedTurn?.sourceTurnId
		? state.turns.find((turn) => turn.id === selectedTurn.sourceTurnId)
		: undefined;
	const sessionTurns = selectedTurn
		? state.turns.filter((turn) => turn.sessionId === selectedTurn.sessionId)
		: [];
	const selectedIndex = selectedTurn
		? sessionTurns.findIndex((turn) => turn.id === selectedTurn.id)
		: -1;
	return {
		timestamp: new Date().toISOString(),
		selectedTurnId,
		decision: {
			mode: target.mode,
			targetSessionId: target.sessionId,
			reason:
				"The selected turn is the end of the current path and the session has no child branches, so the question is appended instead of creating a fork.",
			selectedTurnIndex: selectedIndex,
			sessionTurnCount: sessionTurns.length,
			hasLaterTurns: selectedIndex >= 0 && selectedIndex < sessionTurns.length - 1,
			childSessionIds: state.sessions
				.filter((session) => session.parentId === target.sessionId)
				.map((session) => session.id),
			selectedTurn: selectedTurn ? serializeTurn(selectedTurn, state.turns) : null,
			sourceTurn: sourceTurn ? serializeTurn(sourceTurn, state.turns) : null,
		},
		state: serializeState(state.sessions, state.turns),
		tree: serializeTree(state.sessions, state.turns),
	};
}

export function announceForkDebug(detail: ForkDebugEventDetail): void {
	if (typeof window === "undefined") return;
	if (detail.ok) console.debug("[Rhyza fork]", detail.message);
	else console.warn("[Rhyza fork]", detail.message);
	window.dispatchEvent(new CustomEvent<ForkDebugEventDetail>(forkDebugEventName, { detail }));
}

function serializeState(sessions: SessionNode[], turns: Turn[]) {
	return {
		sessions: sessions.map((session) => ({
			...session,
			childSessionIds: sessions
				.filter((child) => child.parentId === session.id)
				.map((child) => child.id),
			ancestorSessionIds: ancestorIds(session, sessions),
			turnIds: turns.filter((turn) => turn.sessionId === session.id).map((turn) => turn.id),
		})),
		turns: turns.map((turn) => serializeTurn(turn, turns)),
	};
}

function serializeTree(sessions: SessionNode[], turns: Turn[]): ForkDebugTreeNode[] {
	const visit = (session: SessionNode): ForkDebugTreeNode => ({
		sessionId: session.id,
		title: session.title,
		parentSessionId: session.parentId,
		turns: turns
			.filter((turn) => turn.sessionId === session.id)
			.map((turn) => ({
				id: turn.id,
				role: turn.role,
				summary: turn.summary,
				sourceTurnId: turn.sourceTurnId,
			})),
		children: sessions.filter((candidate) => candidate.parentId === session.id).map(visit),
	});
	return sessions.filter((session) => session.parentId === null).map(visit);
}

function serializeTurn(turn: Turn, turns: Turn[]) {
	return {
		id: turn.id,
		sessionId: turn.sessionId,
		sourceTurnId: turn.sourceTurnId,
		sourceSessionId: turn.sourceTurnId
			? turns.find((candidate) => candidate.id === turn.sourceTurnId)?.sessionId
			: undefined,
		role: turn.role,
		status: turn.status,
		summary: turn.summary,
		content: turn.content,
		usage: turn.usage,
		inheritedUsage: turn.inheritedUsage,
		createdAt: turn.createdAt,
		completedAt: turn.completedAt,
	};
}

function ancestorIds(session: SessionNode, sessions: SessionNode[]): string[] {
	const result: string[] = [];
	const visited = new Set<string>([session.id]);
	let parentId = session.parentId;
	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		result.unshift(parentId);
		parentId = sessions.find((candidate) => candidate.id === parentId)?.parentId ?? null;
	}
	return result;
}
