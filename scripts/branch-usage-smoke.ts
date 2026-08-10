import assert from "node:assert/strict";
import type { SessionNode, TokenUsage, Turn } from "../src/types/index.js";
import { allocateBranchUsage } from "../src/utils/branchUsage.js";

const sharedUsage: TokenUsage = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.0012 };
const continuationUsage: TokenUsage = { input: 11, output: 21, cacheRead: 31, cacheWrite: 41, cost: 0.0018 };
const continuationTitleUsage: TokenUsage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.0004 };
const childTitleUsage: TokenUsage = { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: 0.0005 };

const root: SessionNode = {
	id: "root",
	parentId: null,
	title: "Root",
	isRoot: true,
	status: "idle",
	continuationTitleUsage,
};
const child: SessionNode = {
	id: "child",
	parentId: root.id,
	forkedFromTurnId: "shared-assistant",
	title: "Untouched fork",
	isRoot: false,
	status: "idle",
	titleUsage: childTitleUsage,
};

const sessions = [root, child];
const turns: Turn[] = [
	makeTurn("shared-user", root.id, "user"),
	makeTurn("shared-assistant", root.id, "assistant", sharedUsage),
	makeTurn("continuation-user", root.id, "user"),
	makeTurn("continuation-assistant", root.id, "assistant", continuationUsage),
	makeTurn("copied-user", child.id, "user"),
	{ ...makeTurn("copied-assistant", child.id, "assistant"), inheritedUsage: sharedUsage },
];

const allocation = allocateBranchUsage(sessions, turns);
const expectedContinuation = sum(continuationUsage, continuationTitleUsage);
const expectedChild = childTitleUsage;
const expectedRoot = sum(sharedUsage, expectedContinuation, expectedChild);
assert.deepEqual(allocation.node.get(root.id), expectedRoot);
assert.deepEqual(allocation.continuation.get(root.id), expectedContinuation);
assert.deepEqual(allocation.node.get(child.id), expectedChild);
assert.deepEqual(allocation.total, {
	input: expectedRoot.input,
	output: expectedRoot.output,
	cacheRead: expectedRoot.cacheRead,
	cacheWrite: expectedRoot.cacheWrite,
	cost: expectedRoot.cost,
});

console.log("Branch usage smoke passed.");

function makeTurn(id: string, sessionId: string, role: Turn["role"], usage?: TokenUsage): Turn {
	return {
		id,
		sessionId,
		role,
		content: id,
		status: "complete",
		usage,
		createdAt: "2026-08-10T00:00:00.000Z",
	};
}

function sum(...values: TokenUsage[]): TokenUsage {
	return values.reduce<TokenUsage>((total, usage) => ({
		input: total.input + usage.input,
		output: total.output + usage.output,
		cacheRead: total.cacheRead + usage.cacheRead,
		cacheWrite: total.cacheWrite + usage.cacheWrite,
		cost: total.cost + usage.cost,
	}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
}
