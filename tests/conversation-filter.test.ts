import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { filterConversationRounds } from "../src/utils/conversationFilter.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";
import { projectConversationTree } from "../src/utils/conversationTree.js";
import { forkSessionAtTurn } from "../src/utils/sessionFork.js";

function fixture() {
	const root: SessionNode = {
		id: "root",
		parentId: null,
		title: "Root",
		isRoot: true,
		status: "idle",
		progressStatus: "parked",
	};
	const turns = Array.from({ length: 8 }, (_, index): Turn => ({
		id: `turn-${index}`,
		sessionId: root.id,
		role: index % 2 ? "assistant" : "user",
		content: `Message ${index}`,
		status: "complete",
		createdAt: "2026-09-21T00:00:00Z",
	}));
	let sequence = 0;
	const fork = forkSessionAtTurn(
		{ sessions: [root], turns },
		"turn-3",
		(prefix) => `${prefix}-copy-${++sequence}`,
	)!;
	for (const session of fork.sessions) {
		if (session.id === fork.originalSessionId) session.progressStatus = "todo";
		if (session.id === fork.forkSessionId) {
			session.progressStatus = "complete";
			session.status = "running";
		}
	}
	fork.turns.push({
		...turns[0],
		id: "branch-question",
		sessionId: fork.forkSessionId,
		content: "Branch question",
	});
	fork.sessions.push(
		{ ...root, id: "unmarked", progressStatus: undefined },
		{ ...root, id: "working", progressStatus: "in_progress" },
	);
	return fork;
}

test("leaf status filtering uses OR semantics and preserves every matching ancestor", () => {
	const state = fixture();
	const before = JSON.stringify(state);
	const graph = projectConversationGraph(state.sessions, state.turns);
	const ids = (statuses: Parameters<typeof filterConversationRounds>[2]) =>
		filterConversationRounds(graph.rounds, state.sessions, statuses).map((round) => round.id);
	assert.deepEqual(ids(["complete"]), ["turn-0", "turn-2", "branch-question"]);
	assert.deepEqual(ids(["todo", "complete"]), [
		"turn-0",
		"turn-2",
		"turn-4",
		"turn-6",
		"branch-question",
	]);
	assert.deepEqual(ids(["unmarked"]), ["empty:unmarked"]);
	assert.deepEqual(ids(["in_progress"]), ["empty:working"]);
	assert.deepEqual(ids(["parked"]), [], "a parked non-leaf must not count as a matching leaf");
	assert.strictEqual(filterConversationRounds(graph.rounds, state.sessions, []), graph.rounds);
	assert.equal(JSON.stringify(state), before, "filtering must not mutate sessions or history");
});

test("tree and graph filtering retain the same paths without recompacting tree nodes", () => {
	const state = fixture();
	const tree = projectConversationTree(state.sessions, state.turns);
	const filtered = filterConversationRounds(tree.graph.rounds, state.sessions, ["complete"]);
	const visibleNodes = new Set(filtered.map((round) => tree.nodeByRoundId.get(round.id)));
	assert.deepEqual([...visibleNodes], ["turn-0", "branch-question"]);
	assert.deepEqual(
		tree.byId.get("turn-0")?.rounds.map((round) => round.id),
		["turn-0", "turn-2"],
	);
	assert.equal(tree.byId.get("branch-question")?.parentId, "turn-0");
});

test("a leaf status change immediately updates filtering, including unmarked and no matches", () => {
	const state = fixture();
	const graph = projectConversationGraph(state.sessions, state.turns);
	const branch = state.sessions.find((session) => session.id === state.forkSessionId)!;
	branch.progressStatus = "parked";
	assert.deepEqual(filterConversationRounds(graph.rounds, state.sessions, ["complete"]), []);
	assert.deepEqual(
		filterConversationRounds(graph.rounds, state.sessions, ["parked"]).map((round) => round.id),
		["turn-0", "turn-2", "branch-question"],
	);
	branch.progressStatus = undefined;
	assert.ok(
		filterConversationRounds(graph.rounds, state.sessions, ["unmarked"]).some(
			(round) => round.id === "branch-question",
		),
	);
	assert.deepEqual(filterConversationRounds([], [], ["complete"]), []);
});
