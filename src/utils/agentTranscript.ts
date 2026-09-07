import type { AgentTranscriptTurn } from "../shared/ipc";
import type { Turn } from "../types";

export function buildPriorAgentTranscript(
	turns: Turn[],
	sessionId: string,
	excludedTurnIds: Iterable<string>,
): AgentTranscriptTurn[] {
	const excluded = new Set(excludedTurnIds);
	return turns
		.filter((turn) => turn.sessionId === sessionId && !excluded.has(turn.id))
		.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content, images: turn.images }));
}

/** Builds history strictly before a submitted user turn, excluding later queued turns. */
export function buildAgentTranscriptBeforeTurn(
	turns: Turn[],
	sessionId: string,
	beforeTurnId: string,
): AgentTranscriptTurn[] {
	const boundary = turns.findIndex((turn) => turn.id === beforeTurnId);
	return buildPriorAgentTranscript(boundary < 0 ? turns : turns.slice(0, boundary), sessionId, []);
}
