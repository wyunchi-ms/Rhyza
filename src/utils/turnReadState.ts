import type { Turn } from "../types";
import { isTurnActive, isTurnFailed } from "./sessionRuntime";

export function isTurnUnread(turn: Turn): boolean {
	return (
		turn.role === "assistant" &&
		turn.unread === true &&
		(turn.status === "complete" || turn.status === "complete_with_unsynced_knowledge") &&
		!isTurnFailed(turn)
	);
}

export function patchTurnReadState(turn: Turn, patch: Partial<Turn>): Turn {
	const next = { ...turn, ...patch };
	if (
		next.role !== "assistant" ||
		isTurnActive(next) ||
		next.status === "interrupted" ||
		isTurnFailed(next)
	) {
		if (next.unread) next.unread = false;
	} else if (
		isTurnActive(turn) &&
		(next.status === "complete" || next.status === "complete_with_unsynced_knowledge")
	) {
		next.unread = true;
	}
	return next;
}

export function markTurnsRead(turns: Turn[], turnId: string): Turn[] {
	const byId = new Map(turns.map((turn) => [turn.id, turn]));
	const canonicalId = (id: string): string => {
		const seen = new Set<string>();
		while (!seen.has(id)) {
			seen.add(id);
			const source = byId.get(id)?.sourceTurnId;
			if (!source) break;
			id = source;
		}
		return id;
	};
	const target = canonicalId(turnId);
	let changed = false;
	const next = turns.map((turn) => {
		if (!isTurnUnread(turn) || canonicalId(turn.id) !== target) return turn;
		changed = true;
		return { ...turn, unread: false };
	});
	return changed ? next : turns;
}
