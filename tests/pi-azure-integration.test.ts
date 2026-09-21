import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiService, type PiPromptRequest } from "../electron/main/pi-service.js";
import { AgentService } from "../electron/main/agent-service.js";
import { AzureOpenAIProvider } from "../electron/main/azure-openai-provider.js";
import { CodexAppServer } from "../electron/main/codex-app-server.js";
import {
	validateAzureOpenAIConfig,
	type SummaryRequest,
	type KnowledgeExtractionRequest,
} from "../src/shared/ipc.js";

const config = validateAzureOpenAIConfig({
	endpoint: "https://example.openai.azure.com",
	deployment: "chat-deployment",
	subscriptionId: "00000000-1111-2222-3333-444444444444",
});

async function fixture(t: test.TestContext) {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-azure-integration-"));
	const service = new AgentService(directory, undefined, undefined, path.join(directory, "agent"));
	t.mock.method(CodexAppServer.prototype, "account", async () => null);
	t.after(async () => {
		service.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return { directory, service };
}

test("Azure registration and saved deployment changes survive runtime recreation", async (t) => {
	const { directory, service } = await fixture(t);
	const registered: string[] = [];
	const original = ModelRuntime.prototype.registerNativeProvider;
	t.mock.method(
		ModelRuntime.prototype,
		"registerNativeProvider",
		function (this: ModelRuntime, provider: Parameters<typeof original>[0]) {
			registered.push(provider.getModels()[0].id);
			return original.call(this, provider);
		},
	);
	t.mock.method(AzureOpenAIProvider.prototype, "getStatus", async () => ({
		providerId: "azure-openai" as const,
		configured: true,
	}));
	assert.deepEqual(await service.setAzureOpenAIConfig(config), config);
	assert.equal(
		(await service.getModelCatalog({ providerId: "azure-openai" })).models[0].id,
		config.deployment,
	);
	await service.setAzureOpenAIConfig({ ...config, deployment: "replacement" });
	assert.equal(
		(await service.getModelCatalog({ providerId: "azure-openai" })).models[0].id,
		"replacement",
	);
	assert.ok(registered.includes("replacement"));
	const restarted = new AgentService(
		directory,
		undefined,
		undefined,
		path.join(directory, "agent"),
	);
	try {
		assert.equal((await restarted.getAzureOpenAIConfig())?.deployment, "replacement");
		assert.equal(
			(await restarted.getModelCatalog({ providerId: "azure-openai" })).models[0].id,
			"replacement",
		);
	} finally {
		restarted.dispose();
	}
});

test("Azure config cannot change while a title is being prepared and releases its guard on failure", async (t) => {
	const { directory, service } = await fixture(t);
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	t.mock.method(ModelRuntime, "create", async () => {
		entered();
		await pending;
		throw new Error("Test preparation failure");
	});
	const summary = service.generateSummary(
		{ text: "A title", model: { providerId: "azure-openai", modelId: "" } },
		directory,
	);
	await started;
	await assert.rejects(service.setAzureOpenAIConfig(config), /Wait for the current response/);
	release();
	assert.match((await summary).error ?? "", /Test preparation failure/);
	// The next save reaches runtime initialization instead of staying locked.
	await assert.rejects(service.setAzureOpenAIConfig(config), /Test preparation failure/);
});

test("Azure rejects image attachments explicitly without starting a runtime", async (t) => {
	const { directory, service } = await fixture(t);
	const create = t.mock.method(ModelRuntime, "create", async () => {
		throw new Error("Runtime must not start");
	});
	const result = await service.promptAgent(
		{
			frontendSessionId: "image",
			transcript: [],
			prompt: "Describe",
			images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
			model: { providerId: "azure-openai", modelId: "" },
		},
		directory,
	);
	assert.equal(result.ok, false);
	assert.match(result.error ?? "", /text-only/);
	const historical = await service.promptAgent(
		{
			frontendSessionId: "history-image",
			transcript: [
				{
					id: "earlier-image",
					role: "user",
					content: "An earlier image",
					images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
				},
			],
			prompt: "Continue",
			model: { providerId: "azure-openai", modelId: "" },
		},
		directory,
	);
	assert.equal(historical.ok, false);
	assert.match(historical.error ?? "", /text-only/);
	assert.equal(create.mock.callCount(), 0);
});

test("Azure chat, title and extraction use Pi and provider switching preserves generation after restart", async (t) => {
	const { directory, service } = await fixture(t);
	const requests: PiPromptRequest[] = [];
	t.mock.method(PiService.prototype, "promptAgent", async (request: PiPromptRequest) => {
		requests.push(request);
		return { ok: true, assistantText: "Fixture answer" };
	});
	const title = t.mock.method(
		PiService.prototype,
		"generateSummary",
		async (request: SummaryRequest) => {
			assert.equal(request.model?.providerId, "azure-openai");
			return { summary: "Fixture title" };
		},
	);
	const extraction = t.mock.method(
		PiService.prototype,
		"extractKnowledge",
		async (request: KnowledgeExtractionRequest) => {
			assert.equal(request.model?.providerId, "azure-openai");
			return { entities: [], relations: [], diagrams: [] };
		},
	);
	const request = {
		frontendSessionId: "switch",
		transcript: [],
		prompt: "Question",
		model: { providerId: "azure-openai" as const, modelId: "chat-deployment" },
	};
	await service.promptAgent(
		{ ...request, model: { providerId: "github-copilot", modelId: "" } },
		directory,
	);
	await service.promptAgent(request, directory);
	assert.notEqual(requests[0].sessionGeneration, requests[1].sessionGeneration);
	const restarted = new AgentService(
		directory,
		undefined,
		undefined,
		path.join(directory, "agent"),
	);
	try {
		await restarted.promptAgent(request, directory);
		assert.equal(requests[1].sessionGeneration, requests[2].sessionGeneration);
		await restarted.generateSummary({ text: "Question", model: request.model }, directory);
		await restarted.extractKnowledge(
			{
				question: "Question",
				answer: "Answer",
				existingEntities: [],
				existingDiagrams: [],
				model: request.model,
			},
			directory,
		);
		assert.equal(title.mock.callCount(), 1);
		assert.equal(extraction.mock.callCount(), 1);
	} finally {
		restarted.dispose();
	}
});
