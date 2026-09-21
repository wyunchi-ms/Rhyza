import type { SessionNode, SessionProgressStatus } from "../types";
import type { ConversationRound } from "./conversationGraph";

export type LeafStatusFilter = SessionProgressStatus | "unmarked";

export function filterConversationRounds(
	rounds: ConversationRound[],
	sessions: SessionNode[],
	statuses: readonly LeafStatusFilter[],
): ConversationRound[] {
	if (statuses.length === 0) return rounds;
	const bySession = new Map(sessions.map((session) => [session.id, session]));
	const byId = new Map(rounds.map((round) => [round.id, round]));
	const parents = new Set(rounds.map((round) => round.parentId));
	const visible = new Set<string>();
	for (const leaf of rounds) {
		if (parents.has(leaf.id)) continue;
		const status = bySession.get(leaf.sessionId)?.progressStatus ?? "unmarked";
		if (!statuses.includes(status)) continue;
		let round: ConversationRound | undefined = leaf;
		while (round && !visible.has(round.id)) {
			visible.add(round.id);
			round = byId.get(round.parentId ?? "");
		}
	}
	return rounds.filter((round) => visible.has(round.id));
}
