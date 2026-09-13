import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { allocateConversationTreeUsage, conversationTreeTarget, projectConversationTree } from "../src/utils/conversationTree.js";
import { allocateBranchUsage } from "../src/utils/branchUsage.js";

const session = (id: string, parentId: string | null = null, forkedFromTurnId?: string): SessionNode => ({
	id, parentId, forkedFromTurnId, isRoot: !parentId, title: `Session ${id}`, status: "idle",
});
const round = (id: string, sessionId = "root"): Turn[] => ["user", "assistant"].map((role) => ({
	id: role === "user" ? id : `${id}-answer`, role: role as Turn["role"], sessionId,
	content: id, summary: id, status: "complete", createdAt: "2026-09-13T00:00:00Z",
}));
const copy = (turns: Turn[], sessionId: string, legacy = false) => turns.map((turn) => ({
	...turn, id: `${sessionId}-${turn.id}`, sessionId, sourceTurnId: legacy ? undefined : turn.id,
}));

function branchingHistory(legacy = false) {
	const prefix = [...round("Intro"), ...round("Fiber")];
	const identify = round("Identify Current Context");
	const clarify = round("Clarifying Repeated Issue");
	const rootTurns = [...prefix, ...identify, ...clarify, ...round("Clarifying the Meaning of Again")];
	const greetingHistory = copy([...prefix, ...identify, ...clarify], "greeting", legacy);
	// Explain was created from inherited history in greeting, but its actual
	// graph parent is Fiber, not the greeting session or its terminal round.
	return {
		sessions: [session("root"), session("greeting", "root", clarify[1].id), session("explain", "greeting", greetingHistory[3].id)],
		turns: [...rootTurns, ...greetingHistory, ...round("Respond to Greeting", "greeting"),
			...copy(greetingHistory.slice(0, 4), "explain", legacy), ...round("Explain Current Context", "explain")],
	};
}

for (const legacy of [false, true]) test(`compressed list preserves nested forks from ${legacy ? "legacy" : "modern"} shared history`, () => {
	const state = branchingHistory(legacy);
	const before = JSON.stringify(state);
	const tree = projectConversationTree(state.sessions, state.turns);
	assert.deepEqual(tree.roots.map((node) => node.id), ["Intro"]);
	assert.deepEqual(tree.byId.get("Intro")?.rounds.map((r) => r.id), ["Intro", "Fiber"]);
	assert.deepEqual(tree.childrenById.get("Intro")?.map((n) => n.title), ["Clarifying Repeated Issue", "Explain Current Context"]);
	const clarification = tree.byId.get("Identify Current Context")!;
	assert.deepEqual(clarification.rounds.map((r) => r.id), ["Identify Current Context", "Clarifying Repeated Issue"]);
	assert.deepEqual(tree.childrenById.get(clarification.id)?.map((n) => n.title), ["Clarifying the Meaning of Again", "Respond to Greeting"]);
	assert.equal(tree.byId.get("Explain Current Context")?.parentId, "Intro");
	assert.equal(tree.nodes.length, 5);
	assert.equal(tree.nodeByRoundId.size, tree.graph.rounds.length);
	// Every graph edge either stays within one compressed chain or is exactly
	// an edge in the list. No branch can disappear during compression.
	for (const r of tree.graph.rounds) {
		if (!r.parentId) continue;
		const childId = tree.nodeByRoundId.get(r.id)!;
		const parentId = tree.nodeByRoundId.get(r.parentId)!;
		if (childId !== parentId) assert.equal(tree.byId.get(childId)?.parentId, parentId);
	}
	assert.equal(JSON.stringify(state), before);
});

test("single-child rounds compress while empty chats and independent chats remain selectable", () => {
	const sessions = [session("root"), session("empty", "root"), session("other")];
	const tree = projectConversationTree(sessions, [...round("One"), ...round("Two"), ...round("Three"), ...round("One", "other").map((t) => ({ ...t, id: `other-${t.id}` }))]);
	assert.deepEqual(tree.byId.get("One")?.rounds.map((r) => r.id), ["One", "Two", "Three"]);
	assert.equal(tree.byId.get("empty:empty")?.parentId, "One");
	assert.equal(tree.roots.length, 2);
	assert.deepEqual(conversationTreeTarget(tree, "empty:empty", "root"), { sessionId: "empty", turnId: undefined });
});

test("list selection and reading focus resolve compressed rounds through the current branch", () => {
	const state = branchingHistory();
	const tree = projectConversationTree(state.sessions, state.turns);
	assert.deepEqual(conversationTreeTarget(tree, "Identify Current Context", "greeting"), {
		sessionId: "greeting", turnId: "greeting-Clarifying Repeated Issue",
	});
	assert.deepEqual(conversationTreeTarget(tree, "Explain Current Context", "root"), {
		sessionId: "explain", turnId: "Explain Current Context",
	});
	assert.equal(tree.nodeByRoundId.get(tree.graph.roundByTurnId.get("greeting-Identify Current Context-answer")!), "Identify Current Context");
	assert.equal(conversationTreeTarget(tree, "missing", "root"), null);
});

test("usage follows the displayed subtrees without duplicating session title costs", () => {
	const state = branchingHistory();
	const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01 };
	state.sessions[0].titleUsage = usage;
	for (const turn of state.turns) if (!turn.sourceTurnId && turn.role === "assistant") turn.usage = usage;
	const tree = projectConversationTree(state.sessions, state.turns);
	const allocated = allocateConversationTreeUsage(tree, state.sessions, state.turns);
	assert.deepEqual(allocated.total, allocateBranchUsage(state.sessions, state.turns).total);
	assert.equal(allocated.node.get("Identify Current Context")?.input, 50);
	assert.equal(allocated.node.get("Respond to Greeting")?.input, 10);
	assert.equal(allocated.node.get("Explain Current Context")?.input, 10);
	assert.equal(allocated.node.get("Intro")?.input, allocated.total.input);
});
