import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "../src/types/index.js";
import { formatCacheHitRate, resolveTurnUsage, usageMetrics } from "../src/utils/usageMetrics.js";
import { roundMetrics } from "../src/utils/roundMetrics.js";
import { residentInputTokens } from "../src/utils/contextRot.js";

const usage = { input: 435, output: 450, cacheRead: 21666, cacheWrite: 5954, cost: 0.0106032 };
const turn: Turn = { id: "answer", sessionId: "root", role: "assistant", status: "complete", content: "Answer", createdAt: "2026-09-13T00:00:00Z", usage };
const graphMetrics = (answer: Turn) => roundMetrics({ id: "question", parentId: null, sessionId: "root", title: "Question", answers: [answer] });

test("screenshot regression: chat and graph show 77.2% using the same recorded input", () => {
	const chat = usageMetrics(resolveTurnUsage(turn).usage);
	const graph = graphMetrics(turn);
	assert.equal(formatCacheHitRate(chat.cacheHitRate), "77.2%");
	assert.equal(graph.cacheHitRate, chat.cacheHitRate);
	assert.equal(chat.totalTokens, 28505);
	assert.equal(chat.inputTokens, residentInputTokens(usage));
});

test("missing, zero, all cached and cache-write-only usage have consistent semantics", () => {
	assert.equal(formatCacheHitRate(usageMetrics().cacheHitRate), "—");
	assert.equal(usageMetrics({ ...usage, input: 0, cacheRead: 0, cacheWrite: 0 }).cacheHitRate, undefined);
	assert.equal(usageMetrics({ ...usage, input: 0, cacheRead: 100, cacheWrite: 0 }).cacheHitRate, 100);
	assert.equal(usageMetrics({ ...usage, input: 0, cacheRead: 0, cacheWrite: 100 }).cacheHitRate, 0);
});

test("live fallback and authoritative turn totals are shared across graph and chat", () => {
	const request = { id: "request", sequence: 1, timestamp: turn.createdAt, model: "model", provider: "provider", api: "api", thinking: "off", context: { messages: [] }, usage };
	const live = { ...turn, usage: undefined, modelRequests: [request, { ...request, id: "pending", usage: undefined }] };
	assert.equal(resolveTurnUsage(live).partial, true);
	assert.equal(graphMetrics(live).cacheHitRate, usageMetrics(resolveTurnUsage(live).usage).cacheHitRate);
	const completed = { ...live, usage: { ...usage, input: 1000 } };
	assert.deepEqual(resolveTurnUsage(completed).usage, completed.usage);
	assert.equal(resolveTurnUsage(completed).partial, false);
	assert.equal(graphMetrics(completed).cacheHitRate, usageMetrics(resolveTurnUsage(completed).usage).cacheHitRate);
});

test("inherited history displays the original hit rate without allocating its cost again", () => {
	const copy = { ...turn, usage: undefined, sourceTurnId: turn.id, inheritedUsage: usage };
	assert.equal(resolveTurnUsage(copy).inherited, true);
	assert.equal(usageMetrics(resolveTurnUsage(copy).usage).cacheHitRate, graphMetrics(turn).cacheHitRate);
	assert.equal(resolveTurnUsage(copy, false).usage, undefined);
});
