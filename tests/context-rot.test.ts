import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModelRequestSnapshot } from "../src/shared/ipc";
import { analyzeContextComposition, analyzeContextRot, residentInputTokens } from "../src/utils/contextRot";

function snapshot(messages: unknown[]): AgentModelRequestSnapshot {
	return {
		id: "request-1",
		sequence: 1,
		timestamp: "2026-09-07T00:00:00.000Z",
		model: "test-model",
		provider: "test-provider",
		api: "test-api",
		thinking: "medium",
		context: { systemPrompt: "Follow the user request accurately.", messages },
	};
}

test("context rot flags unrelated old content below the current request", () => {
	const result = analyzeContextRot(snapshot([
		{ role: "user", content: "Explain medieval bread recipes and fermentation." },
		{ role: "assistant", content: [{ type: "text", text: "Rye bread uses a sourdough starter." }] },
		{ role: "user", content: "Fix the TypeScript session event token chart." },
	]));
	assert.equal(result.messages.at(-1)?.relevance, 100);
	assert.ok(result.messages[0].relevance < result.messages[2].relevance);
	assert.ok(result.rot > 0 && result.rot < 100);
});

test("context rot recognizes shared Chinese bigrams", () => {
	const result = analyzeContextRot(snapshot([
		{ role: "user", content: "分析每轮对话的上下文关联度和 token 消耗" },
		{ role: "assistant", content: [{ type: "text", text: "可以按对话轮次计算上下文关联度。" }] },
		{ role: "user", content: "请显示当前对话的上下文关联度" },
	]));
	assert.ok(result.messages[1].relevance >= 40);
});

test("context composition separates tool I/O from conversation and stable prefix", () => {
	const request = snapshot([
		{ role: "user", content: "Inspect the build" },
		{ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "package.json" } }] },
		{ role: "toolResult", content: [{ type: "text", text: "A very long package manifest result" }] },
	]);
	request.context.tools = [{ name: "read", description: "Read a file" }];
	const composition = analyzeContextComposition(request);
	assert.ok(composition.system > 0);
	assert.ok(composition.conversation > 0);
	assert.ok(composition.toolIo > composition.conversation);
	assert.equal(composition.total, composition.system + composition.conversation + composition.toolIo);
});

test("old unrelated tool results contribute more rot than the current request", () => {
	const result = analyzeContextRot(snapshot([
		{ role: "user", content: "Old database migration task" },
		{ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "large.log" } }] },
		{ role: "toolResult", content: [{ type: "text", text: "unrelated historical log output ".repeat(50) }] },
		{ role: "user", content: "Second task" },
		{ role: "assistant", content: "Done" },
		{ role: "user", content: "Third task" },
		{ role: "assistant", content: "Done" },
		{ role: "user", content: "Render the current context usage chart" },
	]));
	const toolResult = result.messages.find((message) => message.role === "toolResult");
	assert.equal(toolResult?.stale, true);
	assert.ok(result.deadWeightTokens > 0);
	assert.equal(result.messages.at(-1)?.rotContribution, 0);
});

test("resident input excludes response output tokens", () => {
	assert.equal(residentInputTokens({ input: 10, output: 99, cacheRead: 20, cacheWrite: 5, cost: 1 }), 35);
});
