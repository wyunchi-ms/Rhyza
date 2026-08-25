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
	total: TokenUsage;
}

// Each model call belongs to the session node that initiated it. Displayed node
// usage is the recursive sum of that session and its child sessions; the overall
// total is accumulated from direct calls so descendants are never double-counted.
export function allocateBranchUsage(sessions: SessionNode[], turns: Turn[]): BranchUsageAllocation {
	const directNode = new Map<string, TokenUsage>();
	let total = emptyUsage();

	for (const session of sessions) {
		const sessionTurns = turns.filter((turn) => turn.sessionId === session.id);
		let direct = addUsage(emptyUsage(), session.titleUsage);
		total = addUsage(total, session.titleUsage);
		sessionTurns.forEach((turn) => {
			if (!turn.usage) return;
			total = addUsage(total, turn.usage);
			direct = addUsage(direct, turn.usage);
		});
		directNode.set(session.id, direct);
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
		for (const child of children.get(sessionId) ?? []) {
			subtree = addUsage(subtree, calculateSubtree(child.id, nextVisiting));
		}
		node.set(sessionId, subtree);
		return subtree;
	};
	for (const session of sessions) calculateSubtree(session.id);
	return { node, total };
}

export function usageTokens(usage: TokenUsage): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function formatTokens(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}
