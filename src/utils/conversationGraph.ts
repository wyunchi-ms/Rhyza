import type { SessionNode, Turn } from "../types";

export interface ConversationRound {
	id: string;
	parentId: string | null;
	sessionId: string;
	user?: Turn;
	answers: Turn[];
	title: string;
}

/** User messages own a round. Copied fork history references the same round. */
export function projectConversationGraph(sessions: SessionNode[], turns: Turn[]) {
	turns = resolveGraphHistory(sessions, turns);
	const byTurn = new Map(turns.map((turn) => [turn.id, turn]));
	const canonical = (turn: Turn): string => {
		const seen = new Set<string>();
		while (turn.sourceTurnId && !seen.has(turn.id)) {
			seen.add(turn.id);
			const source = byTurn.get(turn.sourceTurnId);
			if (!source) return turn.sourceTurnId;
			turn = source;
		}
		return turn.id;
	};
	const rounds = new Map<string, ConversationRound>();
	const paths = new Map<string, string[]>();
	const targets = new Map<string, Map<string, string>>();
	const roundByTurnId = new Map<string, string>();
	const grouped = new Map<string, Turn[]>();
	for (const turn of turns) {
		const group = grouped.get(turn.sessionId) ?? [];
		group.push(turn);
		grouped.set(turn.sessionId, group);
		if (turn.role === "user") {
			const id = canonical(turn);
			if (!rounds.has(id) || !turn.sourceTurnId) rounds.set(id, {
				id, parentId: null, sessionId: turn.sessionId, user: turn, answers: [],
				title: turn.summary?.trim() || turn.content.trim() || "Image prompt",
			});
		}
	}
	for (const session of sessions) {
		const path: string[] = [];
		const target = new Map<string, string>();
		let current: ConversationRound | undefined;
		let hasLocalRound = false;
		for (const turn of grouped.get(session.id) ?? []) {
			if (turn.role === "user") {
				current = rounds.get(canonical(turn));
				if (!current) continue;
				if (!turn.sourceTurnId || !current.parentId) current.parentId = path[path.length - 1] ?? null;
				if (path[path.length - 1] !== current.id) path.push(current.id);
				target.set(current.id, turn.id);
			}
			if (!turn.sourceTurnId) {
				hasLocalRound = true;
				if (turn.role === "assistant" && current) current.answers.push(turn);
			}
			if (current) roundByTurnId.set(turn.id, current.id);
		}
		if (!hasLocalRound) {
			const id = `empty:${session.id}`;
			rounds.set(id, { id, parentId: path[path.length - 1] ?? paths.get(session.parentId ?? "")?.slice(-1)[0] ?? null, sessionId: session.id, answers: [], title: session.title });
			path.push(id);
		}
		paths.set(session.id, path);
		targets.set(session.id, target);
	}
	return { rounds: [...rounds.values()], paths, targets, roundByTurnId };
}

/** Older forks copied history without sourceTurnId. Match only the verified
 * parent prefix through its fork anchor, never equal text in unrelated chats. */
export function resolveGraphHistory(sessions: SessionNode[], turns: Turn[]): Turn[] {
	const grouped = new Map<string, Turn[]>();
	const bySession = new Map(sessions.map((session) => [session.id, session]));
	const aliases = new Map<string, string>();
	for (const turn of turns) {
		const group = grouped.get(turn.sessionId) ?? [];
		group.push(turn);
		grouped.set(turn.sessionId, group);
		if (turn.sourceTurnId) aliases.set(turn.id, turn.sourceTurnId);
	}
	const canonical = (id: string): string => {
		const seen = new Set<string>();
		while (aliases.has(id) && !seen.has(id)) {
			seen.add(id);
			id = aliases.get(id)!;
		}
		return id;
	};
	const visited = new Set<string>();
	const resolve = (session: SessionNode) => {
		if (visited.has(session.id)) return;
		visited.add(session.id);
		const parent = bySession.get(session.parentId ?? "");
		if (!parent) return;
		resolve(parent);
		if (!session.forkedFromTurnId) return;
		const parentTurns = grouped.get(parent.id) ?? [];
		const forkId = canonical(session.forkedFromTurnId);
		const end = parentTurns.findIndex((turn) => canonical(turn.id) === forkId);
		if (end < 0) return;
		const childTurns = grouped.get(session.id) ?? [];
		for (let i = 0; i <= end && i < childTurns.length; i++) {
			const source = parentTurns[i];
			const copy = childTurns[i];
			if (canonical(copy.id) === canonical(source.id)) continue;
			if (copy.sourceTurnId || copy.role !== source.role || copy.createdAt !== source.createdAt
				|| copy.content !== source.content || JSON.stringify(copy.images) !== JSON.stringify(source.images)) break;
			aliases.set(copy.id, canonical(source.id));
		}
	};
	for (const session of sessions) resolve(session);
	return turns.map((turn) => {
		const sourceTurnId = aliases.get(turn.id);
		return sourceTurnId && sourceTurnId !== turn.sourceTurnId ? { ...turn, sourceTurnId } : turn;
	});
}
