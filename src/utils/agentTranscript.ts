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
