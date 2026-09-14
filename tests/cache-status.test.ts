import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModelRequestSnapshot } from "../src/shared/ipc.js";
import { responseCacheEvidence } from "../src/shared/cacheEvidence.js";
import { cacheStatus, lastCacheRequest } from "../src/utils/cacheStatus.js";
import type { Turn } from "../src/types/index.js";
import { createCacheClock } from "../src/utils/cacheClock.js";

const start = Date.parse("2026-09-14T08:00:00Z");
const evidence = responseCacheEvidence({
	role: "assistant",
	api: "openai-responses",
	rhyzaPromptCache: { ttl: "30m", mode: "implicit", createdAt: start / 1000 },
})!;
const request: AgentModelRequestSnapshot = {
	id: "r",
	sequence: 1,
	timestamp: new Date(start - 1000).toISOString(),
	model: "gpt-5.6",
	provider: "github-copilot",
	api: "openai-responses",
	thinking: "medium",
	context: { messages: [] },
	cache: evidence,
	usage: { input: 100, output: 200, cacheRead: 42000, cacheWrite: 3000, cost: 0.1 },
};

test("actual response TTL survives JSON persistence and expires from request creation, not completion", () => {
	const restored = JSON.parse(JSON.stringify(request));
	assert.equal(cacheStatus(restored, start + 29 * 60_000)?.label, "Cache · ~1m remaining");
	assert.equal(cacheStatus(restored, start + 30 * 60_000)?.state, "expired");
	assert.equal(cacheStatus(restored, start)?.expiresAt, start + 30 * 60_000);
});

test("unknown TTLs, old snapshots, requested-only TTLs, misses and different models are hidden", () => {
	const requestedOnly: AgentModelRequestSnapshot = {
		...request,
		cache: undefined,
		wirePayload: { prompt_cache_options: { ttl: "30m" } },
	};
	assert.equal(cacheStatus(undefined, start), undefined);
	assert.equal(cacheStatus(requestedOnly, start), undefined);
	assert.equal(cacheStatus({ ...request, usage: undefined }, start), undefined);
	assert.equal(
		cacheStatus({ ...request, usage: { ...request.usage!, cacheRead: 0, cacheWrite: 0 } }, start),
		undefined,
	);
	assert.equal(cacheStatus(request, start, "another-model"), undefined);
	assert.equal(cacheStatus({ ...request, cache: { ...evidence, ttlMs: NaN } }, start), undefined);
	assert.equal(
		cacheStatus({ ...request, cache: { ...evidence, startedAt: "invalid" } }, start),
		undefined,
	);
	assert.equal(cacheStatus(request, start - 1), undefined);
	assert.equal(
		responseCacheEvidence({
			role: "assistant",
			api: "openai-responses",
			rhyzaPromptCache: { ttl: "unknown" },
		}),
		undefined,
	);
	assert.equal(
		responseCacheEvidence({
			role: "assistant",
			api: "openai-responses",
			rhyzaPromptCache: { mode: "implicit" },
		}),
		undefined,
	);
	assert.equal(
		responseCacheEvidence({
			role: "user",
			api: "openai-responses",
			rhyzaPromptCache: { ttl: "30m" },
		}),
		undefined,
	);
});

test("response creation time is optional and later reuse refreshes the window", () => {
	const shortCache = responseCacheEvidence({
		role: "assistant",
		api: "openai-responses",
		rhyzaPromptCache: { ttl: "5m" },
	});
	assert.equal(shortCache?.ttlMs, 300_000);
	assert.equal(
		cacheStatus(
			{ ...request, timestamp: new Date(start).toISOString(), cache: shortCache },
			start + 300_000,
		)?.state,
		"expired",
	);
	const noTimestamp = responseCacheEvidence({
		role: "assistant",
		api: "openai-responses",
		rhyzaPromptCache: { ttl: "30m" },
	});
	assert.equal(
		cacheStatus({ ...request, cache: noTimestamp }, start)?.expiresAt,
		start - 1000 + 30 * 60_000,
	);
	const refreshed = {
		...request,
		cache: { ...evidence, startedAt: new Date(start + 20 * 60_000).toISOString() },
	};
	assert.equal(cacheStatus(refreshed, start + 30 * 60_000)?.state, "estimated");
});

test("compact per-turn cache records survive restart and never override a newer request with no TTL", () => {
	const turn: Turn = {
		id: "a",
		sessionId: "s",
		role: "assistant",
		status: "complete",
		content: "answer",
		createdAt: new Date(start).toISOString(),
		cacheRequest: {
			model: request.model,
			timestamp: request.timestamp,
			usage: request.usage,
			cache: request.cache,
		},
	};
	const restored: Turn = JSON.parse(JSON.stringify(turn));
	assert.equal(cacheStatus(lastCacheRequest([restored]), start)?.state, "estimated");
	assert.equal(
		cacheStatus(
			lastCacheRequest([{ ...restored, modelRequests: [{ ...request, cache: undefined }] }]),
			start,
		),
		undefined,
	);
	assert.equal(
		lastCacheRequest([restored, { ...restored, id: "b", cacheRequest: undefined }]),
		undefined,
	);
});

test("all subscribers share a timer, pause while hidden, and catch up on wake and before send", () => {
	let now = start;
	let visible = true;
	let timers = 0;
	let wake: (() => void) | undefined;
	let tick: (() => void) | undefined;
	const clock = createCacheClock({
		now: () => now,
		visible: () => visible,
		start: (callback) => {
			timers++;
			tick = callback;
			return () => {
				timers--;
				tick = undefined;
			};
		},
		onWake: (callback) => {
			wake = callback;
			return () => {
				wake = undefined;
			};
		},
	});
	let notifications = 0;
	const unsubscribe = clock.subscribe(() => {
		notifications++;
	});
	const unsubscribe2 = clock.subscribe(() => {});
	assert.equal(timers, 1);
	now += 15_000;
	tick!();
	assert.equal(clock.getSnapshot(), now);
	visible = false;
	wake!();
	assert.equal(timers, 0);
	now += 31 * 60_000;
	visible = true;
	wake!();
	assert.equal(timers, 1);
	assert.equal(cacheStatus(request, clock.getSnapshot())?.state, "expired");
	now += 2000;
	clock.refresh();
	assert.equal(clock.getSnapshot(), now);
	assert.ok(notifications >= 4);
	unsubscribe();
	assert.equal(timers, 1);
	unsubscribe2();
	assert.equal(timers, 0);
	assert.equal(wake, undefined);
});
