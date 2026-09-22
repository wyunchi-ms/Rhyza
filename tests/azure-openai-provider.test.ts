import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	createModels,
	InMemoryCredentialStore,
	Type,
	type Context,
	type Provider,
} from "@earendil-works/pi-ai";
import {
	AzureOpenAIProvider,
	type AzureOpenAIProviderDependencies,
} from "../electron/main/azure-openai-provider.js";
import { validateAzureOpenAIConfig, type AzureOpenAIConfig } from "../src/shared/ipc.js";

const config: AzureOpenAIConfig = {
	endpoint: "https://example-resource.openai.azure.com/",
	deployment: "my-deployment",
	subscriptionId: "11111111-2222-3333-4444-555555555555",
	contextWindow: 32768,
	maxTokens: 4096,
};
const now = 1_000_000;
const secret = "unit-test-cli-token-not-a-real-credential";
const authContext = {
	env: async () => "ambient-key-must-be-ignored",
	fileExists: async () => false,
};
const context: Context = { messages: [{ role: "user", content: "Hello", timestamp: now }] };

async function fixture(t: TestContext, dependencies: AzureOpenAIProviderDependencies = {}) {
	const root = await mkdtemp(join(process.cwd(), ".azure-openai-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const provider = new AzureOpenAIProvider(root, {
		now: () => now,
		credentialFactory: () => ({
			getToken: async () => ({ token: secret, expiresOnTimestamp: now + 600_000 }),
		}),
		...dependencies,
	});
	return { root, provider };
}

async function runtime(provider: AzureOpenAIProvider): Promise<Provider> {
	const result = await provider.createProvider();
	assert.ok(result);
	return result;
}

function completedResponse(events: object[] = []): Response {
	const completed = {
		type: "response.completed",
		response: {
			id: "resp_test",
			status: "completed",
			output: [],
			usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
		},
	};
	return new Response(
		[...events, completed].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
		{
			headers: { "content-type": "text/event-stream" },
		},
	);
}

test("missing config is explicit and startup does not authenticate", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		credentialFactory: () => {
			calls += 1;
			throw new Error(secret);
		},
	});
	assert.equal(await provider.getConfig(), null);
	assert.equal(await provider.createProvider(), null);
	assert.equal((await provider.getStatus()).configured, false);
	await provider.setConfig(config);
	const native = await runtime(provider);
	const models = createModels({ authContext });
	models.setProvider(native);
	assert.equal((await models.getAvailable("azure-openai")).length, 1);
	assert.equal((await models.checkAuth("azure-openai"))?.source, "Azure OpenAI settings");
	assert.equal(calls, 0);
});

test("config persists canonically without extra secrets and survives restart", async (t) => {
	const { root, provider } = await fixture(t);
	await provider.setConfig({ ...config, apiKey: secret, accessToken: secret } as AzureOpenAIConfig);
	const saved = await provider.getConfig();
	assert.deepEqual(saved, validateAzureOpenAIConfig(config));
	assert.deepEqual(await new AzureOpenAIProvider(root).getConfig(), saved);
	assert.doesNotMatch(await readFile(join(root, "azure-openai.json"), "utf8"), new RegExp(secret));
	assert.deepEqual(await readdir(root), ["azure-openai.json"]);
});

test("config writes are serialized with immutable caller snapshots", async (t) => {
	const { root, provider } = await fixture(t);
	const mutable = { ...config, deployment: "last" };
	const first = provider.setConfig({ ...config, deployment: "first" });
	const last = provider.setConfig(mutable);
	mutable.deployment = "mutated-after-save";
	await Promise.all([first, last]);
	assert.equal((await provider.getConfig())?.deployment, "last");
	assert.deepEqual(await readdir(root), ["azure-openai.json"]);
});

test("invalid and corrupt config fail closed without echoing contents", async (t) => {
	const { root, provider } = await fixture(t);
	await provider.setConfig(config);
	await assert.rejects(
		provider.setConfig({ ...config, endpoint: `https://${secret}@attacker.example` }),
	);
	assert.equal((await provider.getConfig())?.deployment, config.deployment);
	await writeFile(join(root, "azure-openai.json"), `not JSON ${secret}`);
	await assert.rejects(provider.getConfig(), (error: Error) => !error.message.includes(secret));
	await assert.rejects(provider.createProvider());
	const status = await provider.getStatus();
	assert.equal(status.configured, false);
	assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
	await writeFile(
		join(root, "azure-openai.json"),
		JSON.stringify({ ...config, endpoint: "https://attacker.example" }),
	);
	await assert.rejects(provider.createProvider());
	await provider.setConfig(config);
	assert.ok(await provider.createProvider());
});

test("CLI auth pins subscription and scope and status does not claim deployment access", async (t) => {
	let calls = 0;
	const { provider, root } = await fixture(t, {
		credentialFactory: (options) => {
			assert.deepEqual(options, {
				subscription: config.subscriptionId,
				processTimeoutInMs: 15_000,
			});
			return {
				getToken: async (scope) => {
					assert.equal(scope, "https://cognitiveservices.azure.com/.default");
					calls += 1;
					return { token: secret, expiresOnTimestamp: now + 600_000 };
				},
			};
		},
	});
	await provider.setConfig(config);
	const status = await provider.getStatus();
	assert.equal(calls, 1);
	assert.equal(status.configured, true);
	assert.equal(status.externalAuth, true);
	assert.match(status.label ?? "", /sign-in ready; deployment access has not been verified/);
	assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
	assert.doesNotMatch(await readFile(join(root, "azure-openai.json"), "utf8"), new RegExp(secret));
	assert.deepEqual(await readdir(root), ["azure-openai.json"]);
});

test("token refresh is coalesced and expires with a two-minute safety margin", async (t) => {
	let clock = now;
	let calls = 0;
	let release: (() => void) | undefined;
	const { provider } = await fixture(t, {
		now: () => clock,
		credentialFactory: () => ({
			getToken: async () => {
				calls += 1;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return { token: `${secret}-${calls}`, expiresOnTimestamp: clock + 600_000 };
			},
		}),
	});
	await provider.setConfig(config);
	const native = await runtime(provider);
	const resolve = () => native.auth.apiKey!.resolve({ ctx: authContext });
	const requests = [resolve(), resolve(), resolve()];
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
	release!();
	assert.equal((await Promise.all(requests))[0]?.auth.apiKey, `${secret}-1`);
	clock += 479_999;
	assert.equal((await resolve())?.auth.apiKey, `${secret}-1`);
	assert.equal(calls, 1);
	clock += 1;
	const refresh = [resolve(), resolve()];
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(calls, 2);
	release!();
	assert.equal((await Promise.all(refresh))[0]?.auth.apiKey, `${secret}-2`);
});

test("failed refresh never uses the old token or ambient credentials and can recover", async (t) => {
	let clock = now;
	let fail = false;
	let calls = 0;
	const { provider } = await fixture(t, {
		now: () => clock,
		credentialFactory: () => ({
			getToken: async () => {
				calls += 1;
				if (fail) throw new Error(`SDK output ${secret}`);
				return { token: secret, expiresOnTimestamp: clock + 600_000 };
			},
		}),
	});
	await provider.setConfig(config);
	const native = await runtime(provider);
	const resolve = () =>
		native.auth.apiKey!.resolve({
			ctx: authContext,
			credential: { type: "api_key", key: "stored-key" },
		});
	assert.equal((await resolve())?.auth.apiKey, secret);
	clock += 480_000;
	fail = true;
	await assert.rejects(
		resolve(),
		(error: Error) => /Run `az login`/.test(error.message) && !error.message.includes(secret),
	);
	assert.equal((await provider.getStatus()).configured, false);
	fail = false;
	assert.equal((await resolve())?.auth.apiKey, secret);
	assert.equal(calls, 4);
});

test("synchronous credential construction errors do not poison subsequent attempts", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		credentialFactory: () => {
			calls += 1;
			if (calls === 1) throw new Error(secret);
			return { getToken: async () => ({ token: secret, expiresOnTimestamp: now + 600_000 }) };
		},
	});
	await provider.setConfig(config);
	assert.equal((await provider.getStatus()).configured, false);
	assert.equal((await provider.getStatus()).configured, true);
	assert.equal(calls, 2);
});

test("invalid or already expiring tokens are rejected", async (t) => {
	for (const token of [
		{ token: "", expiresOnTimestamp: now + 600_000 },
		{ token: secret, expiresOnTimestamp: now + 120_000 },
		{ token: secret, expiresOnTimestamp: NaN },
	]) {
		const { provider } = await fixture(t, {
			credentialFactory: () => ({ getToken: async () => token }),
		});
		await provider.setConfig(config);
		assert.equal((await provider.getStatus()).configured, false);
	}
});

test("native model metadata uses the deployment and local budgets without inferred capabilities", async (t) => {
	const { provider } = await fixture(t);
	await provider.setConfig(config);
	const native = await runtime(provider);
	assert.equal(native.id, "azure-openai");
	assert.equal(native.auth.oauth, undefined);
	assert.equal(native.auth.apiKey?.login, undefined);
	assert.deepEqual(native.getModels(), [
		{
			id: config.deployment,
			name: config.deployment,
			provider: "azure-openai",
			api: "openai-responses",
			baseUrl: "https://example-resource.openai.azure.com/openai/v1",
			reasoning: false,
			input: ["text"],
			contextWindow: config.contextWindow,
			maxTokens: config.maxTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	]);
});

test("saving settings invalidates old runtime auth and token cache", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		credentialFactory: () => ({
			getToken: async () => {
				calls += 1;
				return { token: `${secret}-${calls}`, expiresOnTimestamp: now + 600_000 };
			},
		}),
	});
	await provider.setConfig(config);
	const old = await runtime(provider);
	await old.auth.apiKey!.resolve({ ctx: authContext });
	await provider.setConfig({ ...config, deployment: "replacement" });
	await assert.rejects(old.auth.apiKey!.resolve({ ctx: authContext }), /settings changed/);
	const current = await runtime(provider);
	assert.equal(current.getModels()[0].id, "replacement");
	assert.equal(
		(await current.auth.apiKey!.resolve({ ctx: authContext }))?.auth.apiKey,
		`${secret}-2`,
	);
});

test("a token refresh completing after settings change cannot restore old credentials", async (t) => {
	let release: (() => void) | undefined;
	const { provider } = await fixture(t, {
		credentialFactory: () => ({
			getToken: async () => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return { token: secret, expiresOnTimestamp: now + 600_000 };
			},
		}),
	});
	await provider.setConfig(config);
	const old = await runtime(provider);
	const pending = old.auth.apiKey!.resolve({ ctx: authContext });
	const rejected = assert.rejects(pending, /Run `az login`/);
	await new Promise<void>((resolve) => setImmediate(resolve));
	await provider.setConfig({ ...config, deployment: "new-deployment" });
	release!();
	await rejected;
	await assert.rejects(old.auth.apiKey!.resolve({ ctx: authContext }), /settings changed/);
	assert.equal((await runtime(provider)).getModels()[0].id, "new-deployment");
});

test("text-only input rejects images before authentication or transport", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		credentialFactory: () => {
			calls += 1;
			throw new Error(secret);
		},
		fetch: async () => {
			throw new Error("Unexpected network request");
		},
	});
	await provider.setConfig(config);
	const native = await runtime(provider);
	const historicalUserImage: Context["messages"][number] = {
		role: "user",
		content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
		timestamp: now,
	};
	const historicalToolImage: Context["messages"][number] = {
		role: "toolResult",
		toolCallId: "call_image",
		toolName: "read_image",
		content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
		isError: false,
		timestamp: now,
	};
	for (const messages of [
		[historicalUserImage],
		[historicalUserImage, ...context.messages],
		[historicalToolImage, ...context.messages],
	]) {
		const result = await native.streamSimple(native.getModels()[0], { messages }).result();
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /supports text only/);
	}
	assert.equal(calls, 0);
});

test("Responses requests pin CLI auth and endpoint, reject redirects, and enforce configured output limits", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		fetch: async (input, init) => {
			calls += 1;
			assert.equal(
				input.toString(),
				"https://example-resource.openai.azure.com/openai/v1/responses",
			);
			assert.equal(init?.redirect, "error");
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("authorization"), `Bearer ${secret}`);
			assert.equal(headers.get("api-key"), null);
			const body = JSON.parse(String(init?.body));
			assert.equal(body.model, config.deployment);
			assert.equal(body.max_output_tokens, config.maxTokens);
			assert.equal(body.store, false);
			assert.equal(body.reasoning, undefined);
			assert.equal(body.temperature, undefined);
			assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
			return completedResponse();
		},
	});
	await provider.setConfig(config);
	const native = await runtime(provider);
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("azure-openai", async () => ({ type: "api_key", key: "stored-key" }));
	const models = createModels({ credentials, authContext });
	models.setProvider(native);
	const result = await models.completeSimple(native.getModels()[0], context, {
		apiKey: "explicit-key",
		headers: { Authorization: "Bearer wrong", "api-key": "wrong" },
		maxTokens: 900_000,
		reasoning: "high",
		temperature: 1,
		onPayload: (payload, inspectedModel) => {
			const dump = JSON.stringify({ payload, model: inspectedModel });
			assert.doesNotMatch(dump, new RegExp(secret));
			assert.doesNotMatch(dump, /ambient-key|explicit-key|stored-key|Authorization|Bearer/);
			assert.equal(inspectedModel.headers, undefined);
			return { model: "wrong", reasoning: { effort: "high" } };
		},
	});
	assert.equal(result.stopReason, "stop");
	assert.equal(calls, 1);
});

test("shared Responses parser preserves text, tool calls, usage and follow-up tool results", async (t) => {
	let calls = 0;
	const { provider } = await fixture(t, {
		fetch: async (_input, init) => {
			calls += 1;
			const body = JSON.parse(String(init?.body));
			if (calls === 2) {
				assert.ok(
					body.input.some((item: { type: string }) => item.type === "function_call_output"),
				);
				return completedResponse();
			}
			assert.equal(body.tools[0].name, "lookup");
			return completedResponse([
				{
					type: "response.output_item.added",
					output_index: 0,
					item: { type: "message", id: "msg_1", role: "assistant", content: [] },
				},
				{ type: "response.output_text.delta", output_index: 0, delta: "Looking up." },
				{
					type: "response.output_item.done",
					output_index: 0,
					item: {
						type: "message",
						id: "msg_1",
						role: "assistant",
						content: [{ type: "output_text", text: "Looking up.", annotations: [] }],
					},
				},
				{
					type: "response.output_item.added",
					output_index: 1,
					item: {
						type: "function_call",
						id: "fc_1",
						call_id: "call_1",
						name: "lookup",
						arguments: "",
					},
				},
				{
					type: "response.function_call_arguments.delta",
					output_index: 1,
					delta: '{"query":"hello"}',
				},
				{
					type: "response.output_item.done",
					output_index: 1,
					item: {
						type: "function_call",
						id: "fc_1",
						call_id: "call_1",
						name: "lookup",
						arguments: '{"query":"hello"}',
					},
				},
			]);
		},
	});
	await provider.setConfig(config);
	const native = await runtime(provider);
	const model = native.getModels()[0];
	const tools = [
		{
			name: "lookup",
			description: "Look up a phrase",
			parameters: Type.Object({ query: Type.String() }),
		},
	];
	const events = native.streamSimple(model, { ...context, tools });
	const types: string[] = [];
	for await (const event of events) types.push(event.type);
	const result = await events.result();
	assert.ok(types.includes("text_delta"));
	assert.ok(types.includes("toolcall_delta"));
	assert.equal(result.stopReason, "toolUse");
	assert.equal(result.content[0].type, "text");
	const tool = result.content.find((item) => item.type === "toolCall");
	assert.ok(tool && tool.type === "toolCall");
	assert.deepEqual(tool.arguments, { query: "hello" });
	assert.equal(result.usage.totalTokens, 12);
	const followup = await native
		.streamSimple(model, {
			tools,
			messages: [
				...context.messages,
				result,
				{
					role: "toolResult",
					toolCallId: tool.id,
					toolName: tool.name,
					content: [{ type: "text", text: "Found" }],
					isError: false,
					timestamp: now,
				},
			],
		})
		.result();
	assert.equal(followup.stopReason, "stop");
	assert.equal(calls, 2);
});

test("HTTP and transport errors are sanitized and redirects are never retried by the test transport", async (t) => {
	for (const status of [302, 401, 403, 404, 429, 500]) {
		const { provider } = await fixture(t, {
			fetch: async (_input, init) => {
				assert.equal(init?.redirect, "error");
				return new Response(JSON.stringify({ error: { message: secret } }), {
					status,
					headers: { location: "https://attacker.example" },
				});
			},
		});
		await provider.setConfig(config);
		const native = await runtime(provider);
		const result = await native
			.streamSimple(native.getModels()[0], context, { maxRetries: 0 })
			.result();
		assert.equal(result.stopReason, "error");
		assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
		if (status === 401 || status === 403) assert.match(result.errorMessage ?? "", /permissions/);
		if (status === 404) assert.match(result.errorMessage ?? "", /deployment was not found/);
	}
});
