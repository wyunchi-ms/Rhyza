import assert from "node:assert/strict";
import test from "node:test";
import {
	validateAgentPromptRequest,
	validateAzureOpenAIConfig,
	validateAuxiliaryRequestCancelRequest,
	validateKnowledgeExtractionRequest,
	validateModelCatalogRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
	validateSummaryRequest,
	type ProviderId,
} from "../src/shared/ipc";

const providers: ProviderId[] = ["github-copilot", "codex", "claude-code", "azure-openai"];

const azureConfig = {
	endpoint: "https://example.openai.azure.com/",
	deployment: "chat-deployment",
	subscriptionId: "00000000-1111-2222-3333-444444444444",
};

test("Azure configuration normalizes resource URLs and supplies local token budgets", () => {
	const config = validateAzureOpenAIConfig(azureConfig);
	assert.equal(config.endpoint, "https://example.openai.azure.com/openai/v1");
	assert.equal(config.contextWindow, 32768);
	assert.equal(config.maxTokens, 4096);
	assert.deepEqual(validateAzureOpenAIConfig({ ...config, ignored: "not persisted" }), config);
	assert.equal(
		validateAzureOpenAIConfig({
			...config,
			endpoint: "https://example.cognitiveservices.azure.com/openai/v1/",
		}).endpoint,
		"https://example.cognitiveservices.azure.com/openai/v1",
	);
});

test("Azure configuration rejects untrusted destinations before acquiring credentials", () => {
	for (const endpoint of [
		"http://example.openai.azure.com",
		"https://localhost",
		"https://example.com",
		"https://example.openai.azure.com.attacker.example",
		"https://openai.azure.com",
		"https://a.b.openai.azure.com",
		"https://user:secret@example.openai.azure.com",
		"https://example.openai.azure.com:8080",
		"https://example.openai.azure.com/?key=secret",
		"https://example.openai.azure.com/#fragment",
		"https://example.openai.azure.com/other",
		"https://exam\nple.openai.azure.com",
		"https://example.openai.azure.com\\openai\\v1",
	]) {
		assert.throws(() => validateAzureOpenAIConfig({ ...azureConfig, endpoint }), endpoint);
	}
});

test("Azure configuration rejects malformed deployments, identity and budgets", () => {
	for (const patch of [
		{ deployment: "" },
		{ deployment: "chat/other" },
		{ deployment: "chat\n" },
		{ subscriptionId: "--tenant" },
		{ contextWindow: 0 },
		{ contextWindow: 2_000_001 },
		{ maxTokens: 15 },
		{ maxTokens: 200_001 },
		{ maxTokens: 32769 },
		{ maxTokens: NaN },
		{ contextWindow: 1.5 },
		{ maxTokens: "4096" },
	]) {
		assert.throws(() => validateAzureOpenAIConfig({ ...azureConfig, ...patch }));
	}
});

for (const providerId of providers) {
	test(`${providerId} is accepted by all provider IPC endpoints`, () => {
		for (const validate of [
			validateProviderStatusRequest,
			validateProviderLoginRequest,
			validateProviderLogoutRequest,
		]) {
			assert.deepEqual(validate({ providerId }), { providerId });
		}
		assert.deepEqual(validateModelCatalogRequest({ providerId }), {
			providerId,
			refresh: false,
		});
	});

	test(`${providerId} defaults and custom models survive all inference requests`, () => {
		for (const modelId of ["", "custom-model"]) {
			const model = { providerId, modelId };
			assert.deepEqual(
				validateAgentPromptRequest({
					frontendSessionId: "session-1",
					transcript: [],
					prompt: "hello",
					model,
				}).model,
				model,
			);
			assert.deepEqual(validateSummaryRequest({ text: "hello", model }).model, model);
			assert.equal(
				validateSummaryRequest({ text: "hello", model, requestId: "summary-1" }).requestId,
				"summary-1",
			);
			assert.deepEqual(
				validateKnowledgeExtractionRequest({
					question: "hello",
					answer: "world",
					existingEntities: [],
					existingDiagrams: [],
					model,
				}).model,
				model,
			);
			assert.equal(
				validateKnowledgeExtractionRequest({
					question: "hello",
					answer: "world",
					existingEntities: [],
					existingDiagrams: [],
					requestId: "knowledge-1",
				}).requestId,
				"knowledge-1",
			);
		}
	});
}

test("auxiliary cancellation requires a request id", () => {
	assert.deepEqual(validateAuxiliaryRequestCancelRequest({ requestId: "cancel-1" }), {
		requestId: "cancel-1",
	});
	assert.throws(() => validateAuxiliaryRequestCancelRequest({}));
});

test("unknown providers and malformed model IDs fail instead of falling back to Copilot", () => {
	assert.throws(() => validateProviderStatusRequest({ providerId: "unknown" }));
	assert.throws(() => validateModelCatalogRequest({ providerId: "unknown" }));
	for (const model of [
		{ providerId: "unknown", modelId: "" },
		{ providerId: "codex", modelId: null },
		{ providerId: "claude-code", modelId: "model\n--option" },
		{ providerId: "codex", modelId: "x".repeat(201) },
	]) {
		assert.throws(() => validateSummaryRequest({ text: "hello", model }));
		assert.throws(() =>
			validateAgentPromptRequest({
				frontendSessionId: "session-1",
				transcript: [],
				prompt: "hello",
				model,
			}),
		);
	}
});

test("legacy requests may omit model selection", () => {
	assert.equal(validateSummaryRequest({ text: "hello" }).model, undefined);
	assert.equal(
		validateAgentPromptRequest({
			frontendSessionId: "session-1",
			transcript: [],
			prompt: "hello",
		}).model,
		undefined,
	);
});
