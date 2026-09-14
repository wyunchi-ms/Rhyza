import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { responseCacheEvidence } from "../src/shared/cacheEvidence.js";

test("pinned SDK patch is idempotent and actual Responses parsing preserves TTL alongside usage", async () => {
	const script = new URL("../scripts/patch-pi-cache-metadata.mjs", import.meta.url);
	for (let attempt = 0; attempt < 2; attempt++) {
		execFileSync(process.execPath, [fileURLToPath(script)], {
			stdio: "pipe",
		});
	}
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
		);
		assert.equal(output.usage.input, 1000);
		assert.equal(output.usage.cacheRead, 42000);
		assert.equal(output.usage.cacheWrite, 3000);
		assert.equal(responseCacheEvidence(JSON.parse(JSON.stringify(output)))?.ttl, ttl);
	}
});
