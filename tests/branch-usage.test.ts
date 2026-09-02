import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, TokenUsage, Turn } from "../src/types/index.js";
import { addUsage, allocateBranchUsage, emptyUsage } from "../src/utils/branchUsage.js";

const usage = (input: number, output: number, cost: number): TokenUsage => ({ input, output, cacheRead: 0, cacheWrite: 0, cost });
const session = (id: string, parentId: string | null): SessionNode => ({ id, parentId, title: id, isRoot: parentId === null, status: "idle" });
const turn = (id: string, sessionId: string, tokenUsage: TokenUsage): Turn => ({ id, sessionId, role: "assistant", content: "", status: "complete", usage: tokenUsage, createdAt: "2026-01-01" });

test("shared usage accumulation preserves every token category", () => {
	assert.deepEqual(addUsage(emptyUsage(), { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 }), {
		input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5,
	});
});

test("branch totals include descendants once while the workspace total stays deduplicated", () => {
	const allocation = allocateBranchUsage(
		[session("root", null), session("child", "root")],
		[turn("root-turn", "root", usage(10, 1, 0.1)), turn("child-turn", "child", usage(20, 2, 0.2))],
	);
	assert.deepEqual(allocation.node.get("child"), usage(20, 2, 0.2));
	assert.deepEqual(allocation.node.get("root"), usage(30, 3, 0.30000000000000004));
	assert.deepEqual(allocation.total, usage(30, 3, 0.30000000000000004));
});
