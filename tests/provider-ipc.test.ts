import assert from "node:assert/strict";
import test from "node:test";
import {
	validateAgentPromptRequest,
	validateAuxiliaryRequestCancelRequest,
	validateKnowledgeExtractionRequest,
	validateModelCatalogRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
	validateSummaryRequest,
	type ProviderId,
} from "../src/shared/ipc";

const providers: ProviderId[] = ["github-copilot", "codex", "claude-code"];

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
