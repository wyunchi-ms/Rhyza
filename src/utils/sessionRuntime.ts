import type { SessionNode, Turn } from "../types";

export const activeTurnStatuses: ReadonlySet<Turn["status"]> = new Set(["queued", "retrieving", "running", "finalizing"]);

export function isTurnActive(turnOrStatus: Turn | Turn["status"]): boolean {
	return activeTurnStatuses.has(typeof turnOrStatus === "string" ? turnOrStatus : turnOrStatus.status);
}

export function isSessionRunning(turns: Turn[], sessionId: string): boolean {
	return turns.some((turn) => turn.sessionId === sessionId && isTurnActive(turn));
}

export function runningSessionIds(turns: Turn[]): Set<string> {
	return new Set(turns.filter(isTurnActive).map((turn) => turn.sessionId));
}

export function syncSessionExecutionStatus(
	sessions: SessionNode[],
	turns: Turn[],
	sessionId: string,
): SessionNode[] {
	const isRunning = isSessionRunning(turns, sessionId);
	return sessions.map((session) => session.id !== sessionId ? session : {
		...session,
		status: isRunning ? "running" : session.status === "error" ? "error" : "idle",
	});
}
