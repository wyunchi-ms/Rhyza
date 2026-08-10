import type { SessionNode, TokenUsage, Turn } from "../types";

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

export function addUsage(left: TokenUsage, right?: TokenUsage): TokenUsage {
	if (!right) return left;
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		cost: left.cost + right.cost,
	};
}

export interface BranchUsageAllocation {
	node: Map<string, TokenUsage>;
	continuation: Map<string, TokenUsage>;
	total: TokenUsage;
}

// Each direct model call belongs to exactly one bucket. A node's displayed value
// is then the recursive total of that node, its original continuation, and all
// child branches. The overall total is accumulated from direct buckets so parent
// subtree totals do not double-count descendants.
export function allocateBranchUsage(sessions: SessionNode[], turns: Turn[]): BranchUsageAllocation {
	const directNode = new Map<string, TokenUsage>();
	const continuation = new Map<string, TokenUsage>();
	let total = emptyUsage();

	for (const session of sessions) {
		const sessionTurns = turns.filter((turn) => turn.sessionId === session.id);
		const forkIndexes = sessions
			.filter((child) => child.parentId === session.id && child.forkedFromTurnId)
			.map((child) => sessionTurns.findIndex((turn) => turn.id === child.forkedFromTurnId))
			.filter((index) => index >= 0);
		const splitIndex = forkIndexes.length ? Math.min(...forkIndexes) : Number.POSITIVE_INFINITY;
		let before = addUsage(emptyUsage(), session.titleUsage);
		total = addUsage(total, session.titleUsage);
		let after = emptyUsage();
		sessionTurns.forEach((turn, index) => {
			if (!turn.usage) return;
			total = addUsage(total, turn.usage);
			if (index <= splitIndex) before = addUsage(before, turn.usage);
			else after = addUsage(after, turn.usage);
		});
		directNode.set(session.id, before);
		if (forkIndexes.length) {
			after = addUsage(after, session.continuationTitleUsage);
			total = addUsage(total, session.continuationTitleUsage);
			continuation.set(session.id, after);
		}
	}

	const children = new Map<string, SessionNode[]>();
	for (const session of sessions) {
		if (!session.parentId) continue;
		children.set(session.parentId, [...(children.get(session.parentId) ?? []), session]);
	}
	const node = new Map<string, TokenUsage>();
	const calculateSubtree = (sessionId: string, visiting = new Set<string>()): TokenUsage => {
		const cached = node.get(sessionId);
		if (cached) return cached;
		if (visiting.has(sessionId)) return emptyUsage();
		const nextVisiting = new Set(visiting).add(sessionId);
		let subtree = addUsage(emptyUsage(), directNode.get(sessionId));
		subtree = addUsage(subtree, continuation.get(sessionId));
		for (const child of children.get(sessionId) ?? []) {
			subtree = addUsage(subtree, calculateSubtree(child.id, nextVisiting));
		}
		node.set(sessionId, subtree);
		return subtree;
	};
	for (const session of sessions) calculateSubtree(session.id);
	return { node, continuation, total };
}

export function usageTokens(usage: TokenUsage): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function formatTokens(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}
