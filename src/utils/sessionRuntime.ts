import type { SessionNode, Turn } from "../types";

const activeTurnStatuses = new Set<Turn["status"]>(["retrieving", "running", "finalizing"]);

export function runningSessionIds(turns: Turn[]): Set<string> {
	return new Set(turns.filter((turn) => activeTurnStatuses.has(turn.status)).map((turn) => turn.sessionId));
}

export function syncSessionExecutionStatus(
	sessions: SessionNode[],
	turns: Turn[],
	sessionId: string,
): SessionNode[] {
	const isRunning = turns.some((turn) => turn.sessionId === sessionId && activeTurnStatuses.has(turn.status));
	return sessions.map((session) => session.id !== sessionId ? session : {
		...session,
		status: isRunning ? "running" : session.status === "error" ? "error" : "idle",
	});
}
