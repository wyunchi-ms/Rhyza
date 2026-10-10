import assert from "node:assert/strict";
import test from "node:test";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { providerStreamCacheEvidence, responseCacheEvidence } from "../src/shared/cacheEvidence.js";
import type { AgentCacheEvidence } from "../src/shared/ipc.js";

test("official provider stream hook captures cache TTL alongside actual Responses usage", async () => {
	const { processResponsesStream } =
		await import("@earendil-works/pi-ai/api/openai-responses-shared");
	const model: Model<"openai-responses"> = {
		id: "gpt-5.6",
		name: "Test",
		api: "openai-responses",
		provider: "github-copilot",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
		contextWindow: 100000,
		maxTokens: 1000,
	};
	for (const ttl of ["30m", undefined]) {
		let cache: AgentCacheEvidence | undefined;
		let providerEvents = 0;
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			timestamp: Date.now(),
			stopReason: "stop",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		const response = {
			id: "resp_test",
			status: "completed",
			output: [],
			created_at: 1789372800,
			prompt_cache_options: ttl ? { ttl, mode: "implicit" } : undefined,
			usage: {
				input_tokens: 46000,
				input_tokens_details: { cached_tokens: 42000, cache_write_tokens: 3000 },
				output_tokens: 100,
				total_tokens: 46100,
			},
		};
		const events = (async function* () {
			yield { type: "response.completed", response };
		})();
		await processResponsesStream(
			events as Parameters<typeof processResponsesStream>[0],
			output,
			createAssistantMessageEventStream(),
			model,
			{
				onProviderStreamEvent: (event, streamModel) => {
					providerEvents++;
					cache = providerStreamCacheEvidence(event, streamModel.api);
				},
			},
		);
		assert.equal(output.usage.input, 1000);
		assert.equal(output.usage.cacheRead, 42000);
		assert.equal(output.usage.cacheWrite, 3000);
		assert.equal(providerEvents, 1);
		assert.equal(cache?.ttl, ttl);
		assert.equal(cache?.startedAt, ttl ? "2026-09-14T08:00:00.000Z" : undefined);
		assert.equal(responseCacheEvidence(output), undefined);
	}
});

test("cache evidence requires a terminal Responses event and a valid provider-reported TTL", () => {
	const response = { prompt_cache_options: { ttl: "30m", mode: "implicit" } };
	assert.equal(
		providerStreamCacheEvidence({ type: "response.created", response }, "openai-responses"),
		undefined,
	);
	assert.equal(
		providerStreamCacheEvidence({ type: "response.completed", response }, "codex-app-server"),
		undefined,
	);
	assert.equal(
		providerStreamCacheEvidence(
			{ type: "response.completed", response: { prompt_cache_options: { ttl: "invalid" } } },
			"openai-responses",
		),
		undefined,
	);
	assert.equal(
		providerStreamCacheEvidence({ type: "response.incomplete", response }, "openai-responses")
			?.ttlMs,
		1_800_000,
	);
});
