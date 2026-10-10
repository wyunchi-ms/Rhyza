import type { PathSummaryRequest, PathSummaryRound } from "../shared/ipc";
import type { PathSummarySource, SessionNode, Turn } from "../types";
import { projectConversationGraph, resolveGraphHistory } from "./conversationGraph";
import { isTurnActive } from "./sessionRuntime";

export function pathSummaryHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	}
	return (hash >>> 0).toString(16);
}

export function buildPathSummaryInput(
	sessions: SessionNode[],
	turns: Turn[],
	selectedRoundIds: readonly string[],
): {
	rounds: PathSummaryRound[];
	paths: PathSummaryRequest["paths"];
	sources: PathSummarySource[];
} {
	if (!selectedRoundIds.length) throw new Error("Select at least one node to summarize.");
	const resolved = resolveGraphHistory(sessions, turns);
	const graph = projectConversationGraph(sessions, resolved);
	const byRound = new Map(graph.rounds.map((round) => [round.id, round]));
	const byTurn = new Map(resolved.map((turn) => [turn.id, turn]));
	const canonical = (turn: Turn): string => {
		const seen = new Set<string>();
		while (turn.sourceTurnId) {
			if (seen.has(turn.id)) throw new Error("The selected history contains a message cycle.");
			seen.add(turn.id);
			const source = byTurn.get(turn.sourceTurnId);
			if (!source) return turn.sourceTurnId;
			turn = source;
		}
		return turn.id;
	};
	const messageByRound = new Map<string, Map<string, Turn>>();
	for (const turn of resolved) {
		const roundId = graph.roundByTurnId.get(turn.id);
		if (!roundId) continue;
		const messages = messageByRound.get(roundId) ?? new Map<string, Turn>();
		const id = canonical(turn);
		if (!messages.has(id) || !turn.sourceTurnId) messages.set(id, turn);
		messageByRound.set(roundId, messages);
	}
	const rounds = new Map<string, PathSummaryRound>();
	const paths: PathSummaryRequest["paths"] = [];
	const sources: PathSummarySource[] = [];
	for (const selectedId of new Set(selectedRoundIds)) {
		const endpoint = byRound.get(selectedId);
		if (!endpoint) throw new Error("A selected node no longer exists. Remove it and try again.");
		const roundIds: string[] = [];
		const seen = new Set<string>();
		let current = endpoint;
		while (current) {
			if (seen.has(current.id)) throw new Error("The selected history contains a path cycle.");
			seen.add(current.id);
			roundIds.unshift(current.id);
			if (!current.parentId) break;
			const parent = byRound.get(current.parentId);
			if (!parent) throw new Error("A selected path has missing history.");
			current = parent;
		}
		for (const id of roundIds) {
			if (rounds.has(id)) continue;
			const messages = [...(messageByRound.get(id)?.entries() ?? [])];
			if (messages.some(([, turn]) => isTurnActive(turn))) {
				throw new Error("Wait for the selected paths to finish responding before summarizing.");
			}
			if (messages.some(([, turn]) => turn.status === "interrupted")) {
				throw new Error(
					"A selected path contains an interrupted response. Complete it before summarizing.",
				);
			}
			rounds.set(id, {
				id,
				messages: messages
					.filter(([, turn]) => turn.content.trim() || turn.quote?.text.trim())
					.map(([messageId, turn]) => ({
						id: messageId,
						role: turn.role,
						content: turn.quote?.text
							? `Quoted passage:\n${turn.quote.text}\n\n${turn.content}`
							: turn.content,
					})),
			});
		}
		paths.push({ id: selectedId, title: endpoint.title, roundIds });
		const sourceMessages = roundIds.map((id) => rounds.get(id));
		sources.push({
			roundId: selectedId,
			sessionId: endpoint.sessionId,
			turnId: endpoint.answers[endpoint.answers.length - 1]?.id ?? endpoint.user?.id,
			title: endpoint.title,
			roundIds,
			contentHash: pathSummaryHash(JSON.stringify(sourceMessages)),
		});
	}
	if (![...rounds.values()].some((round) => round.messages.length)) {
		throw new Error("The selected paths contain no messages to summarize.");
	}
	return { rounds: [...rounds.values()], paths, sources };
}

export function summarySourceEdges(
	rounds: ReturnType<typeof projectConversationGraph>["rounds"],
): Array<{ source: string; target: string }> {
	const ids = new Set(rounds.map((round) => round.id));
	return rounds.flatMap((round) =>
		(round.user?.pathSummary?.sources ?? [])
			.filter((source) => ids.has(source.roundId) && source.roundId !== round.id)
			.map((source) => ({ source: source.roundId, target: round.id })),
	);
}
