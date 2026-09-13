import type { SessionNode, Turn } from "../types";
import { projectConversationGraph, type ConversationRound } from "./conversationGraph";
import { addUsage, allocateBranchUsage, emptyUsage } from "./branchUsage";

export interface ConversationTreeNode {
	id: string;
	parentId: string | null;
	sessionId: string;
	title: string;
	rounds: ConversationRound[];
}

/** Compact the graph's single-child runs, preserving every fork. Session
 * boundaries stay selectable so node actions retain an unambiguous owner. */
export function projectConversationTree(sessions: SessionNode[], turns: Turn[]) {
	const graph = projectConversationGraph(sessions, turns);
	const roundsById = new Map(graph.rounds.map((round) => [round.id, round]));
	const children = new Map<string, ConversationRound[]>();
	for (const round of graph.rounds) {
		if (!round.parentId) continue;
		const siblings = children.get(round.parentId) ?? [];
		siblings.push(round);
		children.set(round.parentId, siblings);
	}
	const canMerge = (round: ConversationRound) => {
		const parent = roundsById.get(round.parentId ?? "");
		return parent?.sessionId === round.sessionId && children.get(parent.id)?.length === 1;
	};
	const nodes: ConversationTreeNode[] = [];
	const nodeByRoundId = new Map<string, string>();
	for (const first of graph.rounds) {
		if (canMerge(first)) continue;
		const rounds = [first];
		let last = first;
		while (children.get(last.id)?.length === 1) {
			const child = children.get(last.id)![0];
			if (!canMerge(child)) break;
			rounds.push(child);
			last = child;
		}
		const node = { id: first.id, parentId: first.parentId, sessionId: first.sessionId, title: last.title, rounds };
		nodes.push(node);
		for (const round of rounds) nodeByRoundId.set(round.id, node.id);
	}
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const childrenById = new Map<string, ConversationTreeNode[]>();
	const roots: ConversationTreeNode[] = [];
	for (const node of nodes) {
		node.parentId = nodeByRoundId.get(node.parentId ?? "") ?? null;
		if (node.parentId) {
			const siblings = childrenById.get(node.parentId) ?? [];
			siblings.push(node);
			childrenById.set(node.parentId, siblings);
		} else roots.push(node);
	}
	return { graph, nodes, byId, roots, childrenById, nodeByRoundId };
}

/** Shared history must keep the current branch and focus its local turn copy. */
export function conversationTreeTarget(tree: ReturnType<typeof projectConversationTree>, nodeId: string, activeSessionId: string | null) {
	const node = tree.byId.get(nodeId);
	if (!node) return null;
	const round = node.rounds[node.rounds.length - 1];
	const sessionId = activeSessionId && tree.graph.paths.get(activeSessionId)?.includes(round.id) ? activeSessionId : round.sessionId;
	return { sessionId, turnId: tree.graph.targets.get(sessionId)?.get(round.id) };
}

/** Keep the existing subtree totals, assigning each call once to its displayed
 * chain instead of rolling it up through the storage session's parent. */
export function allocateConversationTreeUsage(tree: ReturnType<typeof projectConversationTree>, sessions: SessionNode[], turns: Turn[]) {
	const lastNodeBySession = new Map(tree.nodes.map((node) => [node.sessionId, node.id]));
	const bySession = new Map(sessions.map((session) => [session.id, session]));
	const nodes = tree.nodes.map((node): SessionNode => ({
		id: node.id, parentId: node.parentId, isRoot: !node.parentId, title: node.title, status: "idle",
		titleUsage: lastNodeBySession.get(node.sessionId) === node.id ? bySession.get(node.sessionId)?.titleUsage : undefined,
	}));
	const allocation = allocateBranchUsage(nodes, turns.map((turn) => ({
		...turn,
		sessionId: tree.nodeByRoundId.get(tree.graph.roundByTurnId.get(turn.id) ?? "") ?? lastNodeBySession.get(turn.sessionId) ?? turn.sessionId,
	})));
	// Preserve the overall accounting even for malformed sessions with no round.
	allocation.total = sessions.reduce((total, session) => addUsage(total, session.titleUsage),
		turns.reduce((total, turn) => addUsage(total, turn.usage), emptyUsage()));
	return allocation;
}
