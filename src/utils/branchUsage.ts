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

// Every recorded model call belongs to exactly one bucket. For a session with
// children, its earliest fork point separates shared history from its original path.
export function allocateBranchUsage(sessions: SessionNode[], turns: Turn[]): BranchUsageAllocation {
	const node = new Map<string, TokenUsage>();
	const continuation = new Map<string, TokenUsage>();
	let total = emptyUsage();

	for (const session of sessions) {
		const sessionTurns = turns.filter((turn) => turn.sessionId === session.id);
		const forkIndexes = sessions
			.filter((child) => child.parentId === session.id && child.forkedFromTurnId)
			.map((child) => sessionTurns.findIndex((turn) => turn.id === child.forkedFromTurnId))
			.filter((index) => index >= 0);
		const splitIndex = forkIndexes.length ? Math.min(...forkIndexes) : Number.POSITIVE_INFINITY;
		let before = addUsage(emptyUsage(), session.usage);
		total = addUsage(total, session.usage);
		let after = emptyUsage();
		sessionTurns.forEach((turn, index) => {
			if (!turn.usage) return;
			total = addUsage(total, turn.usage);
			if (index <= splitIndex) before = addUsage(before, turn.usage);
			else after = addUsage(after, turn.usage);
		});
		node.set(session.id, before);
		if (forkIndexes.length) continuation.set(session.id, after);
	}
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
