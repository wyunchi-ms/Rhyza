import type { SessionNode, Turn } from "../types";
import { isTurnActive } from "./sessionRuntime";

export interface SessionForkState {
	sessions: SessionNode[];
	turns: Turn[];
}

export interface SessionForkResult extends SessionForkState {
	forkSessionId: string;
	originalSessionId: string;
	branchPointSessionId: string;
}

export interface SelectionContinuationTarget {
	sessionId: string;
	mode: "append" | "fork";
}

export function selectionContinuationTarget(
	state: SessionForkState,
	selectedTurnId: string,
): SelectionContinuationTarget | null {
	const selectedTurn = state.turns.find((turn) => turn.id === selectedTurnId);
	if (!selectedTurn) return null;
	const session = state.sessions.find((candidate) => candidate.id === selectedTurn.sessionId);
	if (!session) return null;
	const sessionTurns = state.turns.filter((turn) => turn.sessionId === session.id);
	const selectedIndex = sessionTurns.findIndex((turn) => turn.id === selectedTurn.id);
	if (selectedIndex < 0) return null;
	const hasLaterTurns = selectedIndex < sessionTurns.length - 1;
	const hasChildren = state.sessions.some((candidate) => candidate.parentId === session.id);
	return { sessionId: session.id, mode: hasLaterTurns || hasChildren ? "fork" : "append" };
}

export function forkSessionAtTurn(
	state: SessionForkState,
	turnId: string,
	createId: (prefix: "session" | "turn") => string,
): SessionForkResult | null {
	const selectedTurn = state.turns.find((turn) => turn.id === turnId);
	if (!selectedTurn) return null;
	const selectedTurns = state.turns.filter((turn) => turn.sessionId === selectedTurn.sessionId);
	const forkIndex = selectedTurns.findIndex((turn) => turn.id === selectedTurn.id);
	if (forkIndex < 0) return null;

	const sourceTurn = selectedTurn.sourceTurnId
		? state.turns.find((turn) => turn.id === selectedTurn.sourceTurnId)
		: undefined;
	if (sourceTurn && sourceTurn.sessionId !== selectedTurn.sessionId) {
		const sourceTurns = state.turns.filter((turn) => turn.sessionId === sourceTurn.sessionId);
		const sourceIndex = sourceTurns.findIndex((turn) => turn.id === sourceTurn.id);
		if (sourceIndex < 0) return null;
		return splitLocalPath(state, sourceTurn, sourceTurns, sourceIndex, createId);
	}
	return splitLocalPath(state, selectedTurn, selectedTurns, forkIndex, createId);
}

/** Node actions stay on the selected session, even when its last turn is inherited. */
export function forkSessionNode(
	state: SessionForkState,
	sessionId: string,
	createId: (prefix: "session" | "turn") => string,
	turnId?: string,
): SessionForkResult | null {
	const session = state.sessions.find((item) => item.id === sessionId);
	const turns = state.turns.filter((turn) => turn.sessionId === sessionId);
	if (!session || turns.some(isTurnActive)) return null;
	const index = turnId ? turns.findIndex((turn) => turn.id === turnId) : turns.length - 1;
	if (turnId && index < 0) return null;
	if (index >= 0) return splitLocalPath(state, turns[index], turns, index, createId);
	const forkSessionId = createId("session");
	return {
		forkSessionId,
		originalSessionId: sessionId,
		branchPointSessionId: sessionId,
		sessions: [...state.sessions, createBranchSession(forkSessionId, sessionId)],
		turns: state.turns,
	};
}

/** An independent copy has new turn identities and no branch or runtime ownership. */
export function cloneSessionNode(
	state: SessionForkState,
	sessionId: string,
	createId: (prefix: "session" | "turn") => string,
	turnId?: string,
): (SessionForkState & { cloneSessionId: string }) | null {
	const source = state.sessions.find((item) => item.id === sessionId);
	const turns = state.turns.filter((turn) => turn.sessionId === sessionId);
	if (!source || turns.some(isTurnActive)) return null;
	const index = turnId ? turns.findIndex((turn) => turn.id === turnId) : turns.length - 1;
	if (turnId && index < 0) return null;
	const history = turns.slice(0, index + 1);
	const cloneSessionId = createId("session");
	const ids = new Map(history.map((turn) => [turn.id, createId("turn")]));
	// Quotes can refer to canonical turns from inherited history.
	for (const turn of history) if (turn.sourceTurnId) ids.set(turn.sourceTurnId, ids.get(turn.id)!);
	const copies = history.map((turn): Turn => ({
		...structuredClone(turn),
		id: ids.get(turn.id)!,
		sessionId: cloneSessionId,
		sourceTurnId: undefined,
		changeSetId: undefined,
		modelRequests: undefined,
		cacheRequest: undefined,
		usage: undefined,
		inheritedUsage: structuredClone(turn.usage ?? turn.inheritedUsage),
		quote: turn.quote
			? { ...turn.quote, turnId: ids.get(turn.quote.turnId) ?? turn.quote.turnId }
			: undefined,
	}));
	return {
		cloneSessionId,
		sessions: [
			...state.sessions,
			{
				id: cloneSessionId,
				parentId: null,
				isRoot: true,
				status: "idle",
				title: `${source.title} (copy)`,
				progressStatus: source.progressStatus,
			},
		],
		turns: [...state.turns, ...copies],
	};
}

function splitLocalPath(
	state: SessionForkState,
	forkTurn: Turn,
	sessionTurns: Turn[],
	forkIndex: number,
	createId: (prefix: "session" | "turn") => string,
): SessionForkResult | null {
	const currentSession = state.sessions.find((session) => session.id === forkTurn.sessionId);
	if (!currentSession) return null;
	const prefix = sessionTurns.slice(0, forkIndex + 1);
	const tail = sessionTurns.slice(forkIndex + 1);
	const forkSessionId = createId("session");

	if (tail.length === 0) {
		const branch = createBranchSession(forkSessionId, currentSession.id, forkTurn.id);
		return {
			forkSessionId,
			originalSessionId: currentSession.id,
			branchPointSessionId: currentSession.id,
			sessions: [...state.sessions, branch],
			turns: [...state.turns, ...copyHistory(prefix, forkSessionId, createId)],
		};
	}

	const originalSessionId = createId("session");
	const branchPoint: SessionNode = {
		...currentSession,
		title: titleAtBranchPoint(prefix, currentSession.title),
		titlePending: false,
		refreshTitleOnNextPrompt: false,
		progressStatus: undefined,
		worktreePath: undefined,
		titleUsage: undefined,
		status: "idle",
	};
	const originalContinuation: SessionNode = {
		...currentSession,
		id: originalSessionId,
		parentId: currentSession.id,
		forkedFromTurnId: forkTurn.id,
		isRoot: false,
		titlePending: false,
		refreshTitleOnNextPrompt: false,
	};
	const newBranch = createBranchSession(forkSessionId, currentSession.id, forkTurn.id);
	const sessions = state.sessions.map((session) => {
		if (session.id === currentSession.id) return branchPoint;
		if (session.parentId === currentSession.id) return { ...session, parentId: originalSessionId };
		return session;
	});
	const otherTurns = state.turns.filter((turn) => turn.sessionId !== currentSession.id);
	const originalTurns = [
		...copyHistory(prefix, originalSessionId, createId),
		...tail.map((turn) => ({ ...turn, sessionId: originalSessionId })),
	];

	return {
		forkSessionId,
		originalSessionId,
		branchPointSessionId: currentSession.id,
		sessions: [...sessions, originalContinuation, newBranch],
		turns: [
			...otherTurns,
			...prefix,
			...originalTurns,
			...copyHistory(prefix, forkSessionId, createId),
		],
	};
}

function createBranchSession(id: string, parentId: string, forkedFromTurnId?: string): SessionNode {
	return {
		id,
		parentId,
		forkedFromTurnId,
		title: "New branch",
		titlePending: true,
		refreshTitleOnNextPrompt: true,
		isRoot: false,
		status: "idle",
	};
}

function copyHistory(
	turns: Turn[],
	sessionId: string,
	createId: (prefix: "session" | "turn") => string,
): Turn[] {
	return turns.map((turn) => ({
		...turn,
		id: createId("turn"),
		sourceTurnId: turn.sourceTurnId ?? turn.id,
		sessionId,
		changeSetId: undefined,
		inheritedUsage: turn.usage ?? turn.inheritedUsage,
		usage: undefined,
	}));
}

function titleAtBranchPoint(turns: Turn[], fallback: string): string {
	const userTurn = [...turns].reverse().find((turn) => turn.role === "user");
	return userTurn?.summary?.trim() || userTurn?.content.trim() || fallback;
}
