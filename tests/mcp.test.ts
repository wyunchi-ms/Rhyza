import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "node:http";
import {
	createAgentSession,
	createToolSearchExtension,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxToolCall,
	fauxProvider,
	getCurrentTools,
} from "@earendil-works/pi-ai";
import { PiService } from "../electron/main/pi-service.js";
import { CodexAppServer } from "../electron/main/codex-app-server.js";
import { WorktreeService } from "../electron/main/worktree-service.js";
import { isRecord } from "../src/shared/value.js";
import { McpConfigStore } from "../electron/main/mcp-config-store.js";
import { McpService } from "../electron/main/mcp-service.js";
import {
	validateMcpAction,
	validateMcpConfig,
	validateMcpResource,
	validateMcpSave,
} from "../src/shared/mcp.js";

const fixture = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
const configuration = {
	command: process.execPath,
	args: [fixture],
	exposure: "deferred" as const,
	timeout: 5,
};

async function setup(t: test.TestContext) {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-mcp-test-"));
	const agentDir = path.join(directory, "agent");
	const workspace = path.join(directory, "workspace");
	await Promise.all([mkdir(agentDir), mkdir(workspace)]);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const service = new McpService(agentDir, path.join(directory, "data"));
	t.after(async () => {
		await service.dispose();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(directory, { recursive: true, force: true, maxRetries: 5 });
	});
	return { directory, agentDir, workspace, service, store: service.config };
}

async function until(predicate: () => boolean | Promise<boolean>) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("MCP fixture did not reach the required state.");
}

test("MCP contracts reject unsafe transports, command-valued secrets and wildcard approvals", () => {
	for (const config of [
		{ url: "http://external.example/mcp" },
		{ type: "sse", url: "https://example.com/mcp" },
		{ url: "https://user:password@example.com/mcp" },
		{ command: "node", url: "https://example.com/mcp" },
		{ command: "node", env: { TOKEN: "!read-secret" } },
		{ command: "node", exposure: "codemode" },
		{ url: "https://example.com/mcp", auth: { provider: "github-copilot" } },
		{ url: "https://example.com/mcp", oauth: { callbackUrl: "https://external.example/callback" } },
	])
		assert.throws(() => validateMcpConfig(config));
	assert.equal(
		validateMcpConfig({ type: "streamable-http", url: "http://127.0.0.1:1234/mcp" }).type,
		"http",
	);
	assert.throws(() =>
		validateMcpSave({
			name: "demo",
			scope: "user",
			config: configuration,
			policy: { tools: { "*": "read" } },
		}),
	);
	assert.throws(() => validateMcpAction({ name: "../demo", scope: "user", action: "reconnect" }));
	assert.throws(() => validateMcpResource({ name: "demo", scope: "user", action: "read" }));
});

test("MCP configuration preserves content, requires project trust and invalidates approvals on identity changes", async (t) => {
	const { agentDir, directory, workspace, store } = await setup(t);
	await writeFile(
		path.join(agentDir, "mcp.json"),
		JSON.stringify({
			custom: { retained: true },
			mcpServers: { broken: { type: "sse", url: "https://example.com" } },
		}),
	);
	await store.save(workspace, {
		name: "demo",
		scope: "user",
		config: configuration,
		policy: { tools: { echo: "read" } },
	});
	assert.equal(
		JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8")).custom.retained,
		true,
	);
	assert.equal(store.snapshot(workspace).errors.length, 1);
	assert.equal(store.get(workspace, { name: "demo", scope: "user" }).policy.tools.echo, "read");
	await mkdir(path.join(workspace, ".pi"));
	await writeFile(
		path.join(workspace, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { demo: { ...configuration, description: "project" } } }),
	);
	assert.equal(store.snapshot(workspace).servers[0].scope, "user");
	await assert.rejects(
		store.save(workspace, {
			name: "demo",
			scope: "project",
			config: configuration,
			policy: { tools: {} },
		}),
		/Trust/,
	);
	await store.trust(workspace, true);
	assert.equal(store.snapshot(workspace).servers[0].scope, "project");
	assert.equal(store.snapshot(workspace).servers[0].policy.tools.echo, undefined);
	await store.save(workspace, {
		name: "demo",
		scope: "project",
		config: configuration,
		policy: { tools: { echo: "read" } },
	});
	const persisted = new McpConfigStore(agentDir, path.join(directory, "data"));
	assert.equal(persisted.snapshot(workspace).trusted, true);
	assert.equal(persisted.snapshot(workspace).servers[0].policy.tools.echo, "read");
	await store.save(workspace, {
		name: "demo",
		scope: "project",
		config: { ...configuration, args: [fixture, "changed"] },
		policy: { tools: { echo: "read" } },
	});
	assert.equal(
		persisted.snapshot(workspace).servers[0].policy.tools.echo,
		undefined,
		"Saving a different server identity requires fresh tool approval.",
	);
	await store.save(workspace, {
		name: "demo",
		scope: "project",
		config: { ...configuration, args: [fixture, "changed"] },
		policy: { tools: { echo: "read" } },
	});
	assert.equal(persisted.snapshot(workspace).servers[0].policy.tools.echo, "read");
	await writeFile(
		path.join(workspace, ".pi", "mcp.json"),
		JSON.stringify({
			mcpServers: { demo: { ...configuration, args: [fixture, "externally-changed"] } },
		}),
	);
	assert.equal(persisted.snapshot(workspace).servers[0].policy.tools.echo, undefined);
	await store.trust(workspace, false);
	assert.equal(store.snapshot(workspace).servers[0].scope, "user");
	assert.equal(store.snapshot(workspace).servers[0].policy.tools.echo, undefined);
	await store.save(workspace, {
		name: "__proto__",
		scope: "user",
		config: configuration,
		policy: { tools: {} },
	});
	assert(
		Object.hasOwn(
			JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8")).mcpServers,
			"__proto__",
		),
	);
	assert.equal(
		store.get(workspace, { name: "__proto__", scope: "user" }).policy.tools.constructor,
		undefined,
	);
	const oversized = Object.fromEntries(
		Array.from({ length: 100 }, (_, index) => [`VALUE_${index}`, "\u6c49".repeat(4000)]),
	);
	await assert.rejects(
		store.save(workspace, {
			name: "oversized",
			scope: "user",
			config: { command: process.execPath, env: oversized },
			policy: { tools: {} },
		}),
		/1 MB/,
	);
	assert(
		!store.snapshot(workspace).servers.some((server) => server.name === "oversized"),
		"Oversized UTF-8 configuration is rejected before replacing the stored file.",
	);
});

test("concurrent MCP runtime cleanup shares its completion promise during service shutdown", async (t) => {
	const { workspace, service } = await setup(t);
	const runtime = service.createRuntime(workspace, () => false);
	const closing = runtime.close();
	const shutdown = service.dispose();
	assert.strictEqual(runtime.close(), closing, "shutdown must await an already-closing runtime");
	await Promise.all([closing, shutdown]);
});

test("SDK MCP connects stdio, discovers tools, enforces live permissions and reads paginated resources", async (t) => {
	const { workspace, agentDir, service } = await setup(t);
	await service.save(workspace, {
		name: "demo",
		scope: "user",
		config: configuration,
		policy: {
			tools: {
				echo: "read",
				write: "write",
				failure: "read",
				"echo-text": "read",
				echo_text: "read",
			},
		},
	});
	let writable = false;
	const runtime = service.createRuntime(workspace, () => writable);
	const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
	const loader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		extensionFactories: [createToolSearchExtension(), runtime.extension],
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: workspace,
		agentDir,
		settingsManager,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(workspace),
		noTools: "builtin",
	});
	runtime.session = session;
	t.after(() => session.dispose());
	await session.bindExtensions({});
	await until(() => runtime.states.get("demo")?.state === "connected");
	assert(session.getActiveToolNames().includes("tool_search"));
	assert(!session.getActiveToolNames().includes("mcp__demo__echo"));
	const context = session.extensionRunner.createToolContext("fixture", undefined);
	const execute = async (name: string, params: unknown) => {
		const definition = session.getToolDefinition(name);
		assert(definition, `Missing definition ${name}`);
		try {
			const result = await definition.execute("fixture", params, undefined, undefined, context);
			return {
				isError: "isError" in result && result.isError === true,
				result,
			};
		} catch (error) {
			return {
				isError: true,
				result: {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				},
			};
		}
	};
	const searched = await execute("tool_search", { query: "echo", limit: 5 });
	assert.equal(searched.isError, false, JSON.stringify(searched.result));
	assert(session.getActiveToolNames().includes("mcp__demo__echo"));
	assert.equal(
		(await execute("list_mcp_resources", {})).isError,
		true,
		"Resource access must identify a host-approved server.",
	);
	const echo = await execute("mcp__demo__echo", { text: "fixture echo" });
	assert.equal(echo.isError, false, JSON.stringify(echo.result));
	assert(JSON.stringify(echo.result).includes("fixture echo"));
	await execute("tool_search", { query: "write failure colliding", limit: 10 });
	const denied = await execute("mcp__demo__write", {});
	assert.equal(denied.isError, true);
	assert(JSON.stringify(denied.result).includes("writable"));
	writable = true;
	const written = await execute("mcp__demo__write", {});
	assert.equal(written.isError, false, JSON.stringify(written.result));
	assert.equal(await readFile(path.join(workspace, "mcp-write.txt"), "utf8"), "fixture write");
	const failed = await execute("mcp__demo__failure", {});
	assert.equal(failed.isError, true);
	assert(JSON.stringify(failed.result).includes("fixture tool failure"));
	const collisionTools = session
		.getAllTools()
		.filter((tool) => tool.name.startsWith("mcp__demo__echo_text"));
	assert.equal(collisionTools.length, 2);
	for (const tool of collisionTools) {
		await execute("tool_search", { query: tool.name, limit: 2 });
		assert.equal((await execute(tool.name, {})).isError, false);
	}
	await execute("mcp__demo__echo", { text: "change-tools" });
	await until(() => session.getAllTools().some((tool) => tool.name === "mcp__demo__new_tool"));
	await execute("tool_search", { query: "newly discovered", limit: 2 });
	assert.equal(
		(await execute("mcp__demo__new_tool", {})).isError,
		true,
		"Server read-only hints must not approve new tools.",
	);
	await execute("tool_search", { query: "constructor", limit: 1 });
	const prototypeTool = await execute("mcp__demo__constructor", {});
	assert.equal(prototypeTool.isError, true);
	assert(JSON.stringify(prototypeTool.result).includes("Permission blocked"));
	assert(
		(await service.resources(workspace, { name: "demo", scope: "user", action: "list" })).includes(
			"second-page",
		),
	);
	assert(
		(
			await service.resources(workspace, {
				name: "demo",
				scope: "user",
				action: "list",
				cursor: "second-page",
			})
		).includes("fixture://second"),
	);
	assert(
		(
			await service.resources(workspace, { name: "demo", scope: "user", action: "templates" })
		).includes("fixture://{page}"),
	);
	assert(
		(
			await service.resources(workspace, {
				name: "demo",
				scope: "user",
				action: "read",
				uri: "fixture://guide",
			})
		).includes("fixture resource text"),
	);
	await assert.rejects(
		service.resources(workspace, {
			name: "demo",
			scope: "user",
			action: "read",
			uri: "fixture://large",
		}),
		/128 KB/,
	);
	await writeFile(
		path.join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				demo: {
					...configuration,
					env: { MCP_FIXTURE_MARKER: "external-edit", MCP_FIXTURE_INCLUDE_PROTOTYPE: "1" },
				},
			},
		}),
	);
	assert.equal(
		(await execute("list_mcp_resources", { server: "demo" })).isError,
		true,
		"A stale transport cannot read resources from a changed endpoint.",
	);
	const revision = service.revision(workspace);
	await service.action(workspace, { name: "demo", scope: "user", action: "reconnect" });
	assert(
		service.revision(workspace) > revision,
		"External file edits recreate runtime connections.",
	);
	assert.equal(runtime.invalidated, true);
	assert.equal(
		(await service.overview(workspace)).servers[0].tools.find((tool) => tool.name === "constructor")
			?.permission,
		"blocked",
		"An externally changed, unapproved server cannot inherit Object.prototype permissions.",
	);
	assert.equal(
		service.config.get(workspace, { name: "demo", scope: "user" }).policy.tools.echo,
		undefined,
	);
	assert.equal(
		service.config.get(workspace, { name: "demo", scope: "user" }).policy.tools.constructor,
		undefined,
		"Invalidated approvals must not inherit prototype properties.",
	);
	await service.save(workspace, {
		name: "demo",
		scope: "user",
		config: { ...configuration, enabled: false },
		policy: { tools: { echo: "read" } },
	});
	assert.equal(runtime.invalidated, true);
	assert.equal((await execute("mcp__demo__echo", { text: "blocked after disable" })).isError, true);
	await assert.rejects(
		service.resources(workspace, { name: "demo", scope: "user", action: "list" }),
		/unavailable/,
	);
});

test("MCP management masks secrets, preserves masked values and surfaces failed connections", async (t) => {
	const { workspace, service } = await setup(t);
	await service.save(workspace, {
		name: "broken",
		scope: "user",
		config: {
			command: "rhyza-missing-executable",
			env: { FIXTURE_TOKEN: "fixture-private-token" },
			timeout: 1,
			exposure: "deferred",
		},
		policy: { tools: {} },
	});
	const draft = await service.edit(workspace, { name: "broken", scope: "user" });
	assert(!JSON.stringify(draft).includes("fixture-private-token"));
	draft.config.description = "Updated";
	await service.save(workspace, draft);
	const persisted = service.config.get(workspace, { name: "broken", scope: "user" });
	assert(
		"command" in persisted.config &&
			persisted.config.env?.FIXTURE_TOKEN === "fixture-private-token",
	);
	if ("command" in draft.config) draft.config.command = process.execPath;
	await assert.rejects(service.save(workspace, draft), /Replace or remove stored secrets/);
	await service.overview(workspace);
	await until(async () => (await service.overview(workspace)).servers[0].state === "failed");
	const result = await service.overview(workspace);
	assert(result.servers[0].error);
	assert(!JSON.stringify(result).includes("fixture-private-token"));
	await service.remove(workspace, { name: "broken", scope: "user" });
	assert.equal((await service.overview(workspace)).servers.length, 0);
});

test("HTTP MCP connects with headers, reconnects and reports OAuth-required state", async (t) => {
	const { workspace, service } = await setup(t);
	const server = createServer(async (request, response) => {
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		if (request.headers.authorization !== "Bearer fixture-token") {
			response
				.writeHead(401, { "WWW-Authenticate": "Bearer", "Content-Type": "text/plain" })
				.end("Authentication required");
			return;
		}
		let text = "";
		for await (const chunk of request) text += chunk;
		const message = JSON.parse(text);
		if (message.id === undefined) {
			response.writeHead(202).end();
			return;
		}
		const result =
			message.method === "initialize"
				? {
						protocolVersion: "2025-11-25",
						serverInfo: { name: "fixture-http", version: "1" },
						capabilities: { tools: {} },
					}
				: message.method === "tools/list"
					? {
							tools: [
								{
									name: "echo",
									description: "HTTP echo",
									inputSchema: { type: "object", properties: {} },
								},
							],
						}
					: { content: [{ type: "text", text: "HTTP fixture" }] };
		response
			.writeHead(200, { "Content-Type": "application/json" })
			.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	);
	const address = server.address();
	assert(address && typeof address === "object");
	const url = `http://127.0.0.1:${address.port}/mcp`;
	await service.save(workspace, {
		name: "http",
		scope: "user",
		config: {
			url,
			headers: { Authorization: "Bearer fixture-token" },
			exposure: "direct",
			timeout: 2,
		},
		policy: { tools: { echo: "read" } },
	});
	await service.overview(workspace);
	await until(async () => (await service.overview(workspace)).servers[0].state === "connected");
	assert.equal((await service.overview(workspace)).servers[0].tools[0].name, "echo");
	assert.equal(
		(await service.overview(workspace)).servers[0].authenticated,
		false,
		"A static Authorization header is not an OAuth login.",
	);
	await service.action(workspace, { name: "http", scope: "user", action: "reconnect" });
	await service.save(workspace, {
		name: "auth",
		scope: "user",
		config: { url, exposure: "deferred", timeout: 2 },
		policy: { tools: {} },
	});
	await service.overview(workspace);
	await until(async () =>
		(await service.overview(workspace)).servers.some(
			(entry) => entry.name === "auth" && entry.state === "needs-auth",
		),
	);
	await assert.rejects(
		service.action(workspace, { name: "http", scope: "user", action: "login" }),
		/OAuth/,
	);
});

test("Pi chat discovers MCP without a tools allowlist and restores the selected branch's loaded tools", async (t) => {
	const { directory, agentDir, workspace, service } = await setup(t);
	const chatConfiguration = {
		...configuration,
		env: { MCP_FIXTURE_DELAY_RESOURCES: "1" },
	};
	const modelRuntime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
		modelsStorePath: path.join(agentDir, "models-store.json"),
		allowModelNetwork: false,
	});
	const faux = fauxProvider({
		provider: "github-copilot",
		api: "openai-responses",
		models: [{ id: "mcp-fixture" }],
	});
	modelRuntime.registerNativeProvider(faux.provider);
	t.mock.method(ModelRuntime, "create", async () => modelRuntime);
	t.mock.method(CodexAppServer.prototype, "account", async () => null);
	await service.save(workspace, {
		name: "demo",
		scope: "user",
		config: chatConfiguration,
		policy: { tools: { echo: "read" } },
	});
	const contexts: string[][] = [];
	faux.setResponses([
		(context) => {
			contexts.push(getCurrentTools(context.messages).map((tool) => tool.name));
			return fauxAssistantMessage(fauxToolCall("tool_search", { query: "echo", limit: 5 }), {
				stopReason: "toolUse",
			});
		},
		(context) => {
			contexts.push(getCurrentTools(context.messages).map((tool) => tool.name));
			return fauxAssistantMessage(fauxToolCall("mcp__demo__echo", { text: "real chat tool" }), {
				stopReason: "toolUse",
			});
		},
		fauxAssistantMessage("First MCP answer"),
		(context) => {
			contexts.push(getCurrentTools(context.messages).map((tool) => tool.name));
			return fauxAssistantMessage("Continued MCP answer");
		},
		(context) => {
			contexts.push(getCurrentTools(context.messages).map((tool) => tool.name));
			return fauxAssistantMessage(fauxToolCall("tool_search", { query: "echo", limit: 5 }), {
				stopReason: "toolUse",
			});
		},
		fauxAssistantMessage(fauxToolCall("mcp__demo__echo", { text: "blocked after revoke" }), {
			stopReason: "toolUse",
		}),
		(context) => {
			assert(
				context.messages.some(
					(message) =>
						message.role === "toolResult" &&
						message.isError &&
						JSON.stringify(message.content).includes("Permission blocked"),
				),
			);
			return fauxAssistantMessage("Permission denied explicitly");
		},
	]);
	const events: import("../src/shared/ipc.js").AgentBridgeEvent[] = [];
	const diagnostics: import("../electron/main/agent-diagnostics.js").AgentDiagnosticEvent[] = [];
	const pi = new PiService(
		directory,
		undefined,
		(event) => events.push(event),
		agentDir,
		undefined,
		service,
		(event) => diagnostics.push(event),
	);
	t.after(() => pi.dispose());
	const model = { providerId: "github-copilot" as const, modelId: "mcp-fixture" };
	const first = await pi.promptAgent(
		{
			frontendSessionId: "root",
			frontendTurnId: "root-answer",
			prompt: "Use MCP",
			transcript: [],
			model,
		},
		workspace,
	);
	assert.equal(first.ok, true, first.error);
	for (const stage of [
		"mcp-refresh",
		"resources-reload",
		"session-history",
		"agent-session-create",
		"extensions-bind",
		"mcp-transport-start",
		"mcp-rpc-initialize",
		"mcp-rpc-tools/list",
	]) {
		assert(
			diagnostics.some((event) => event.stage === stage && event.status === "end" && event.ok),
			`Missing successful diagnostic stage: ${stage}`,
		);
	}
	assert(diagnostics.some((event) => event.stage === "model-request"));
	assert(
		diagnostics.every(
			(event) => event.frontendSessionId === "root" && event.frontendTurnId === "root-answer",
		),
	);
	assert.equal(JSON.stringify(diagnostics).includes("Use MCP"), false);
	assert(
		!contexts[0].includes("mcp__demo__echo"),
		"Deferred tools are absent from the initial model request.",
	);
	assert(contexts[0].includes("tool_search"));
	assert(contexts[1].includes("mcp__demo__echo"));
	assert(
		events.some(
			(event) =>
				event.type === "tool_execution_end" &&
				isRecord(event.payload) &&
				event.payload.toolName === "mcp__demo__echo",
		),
	);
	pi.reloadInstalledPlugins();
	const child = await pi.promptAgent(
		{
			frontendSessionId: "child",
			frontendTurnId: "child-answer",
			parentFrontendSessionId: "root",
			forkedFromTurnId: "root-answer",
			prompt: "Continue",
			transcript: [
				{ id: "root-user", role: "user", content: "Use MCP" },
				{ id: "root-answer", role: "assistant", content: "First MCP answer" },
			],
			model,
		},
		workspace,
	);
	assert.equal(child.ok, true, child.error);
	const sessions = await SessionManager.listAll(path.join(agentDir, "rhyza-sessions"));
	const childSession = sessions.find((session) => session.id === "kb-child");
	assert(childSession);
	const childLoadout = SessionManager.open(childSession.path)
		.getEntries()
		.find((entry) => entry.type === "custom" && entry.customType === "rhyza.mcp-loadout");
	assert(
		childLoadout?.type === "custom" &&
			isRecord(childLoadout.data) &&
			Array.isArray(childLoadout.data.tools) &&
			childLoadout.data.tools.includes("mcp__demo__echo"),
		"The fork persists the tool snapshot from its selected parent turn.",
	);
	assert(
		contexts[2].includes("mcp__demo__echo"),
		"The fork restores tools loaded at its selected parent turn before the first request.",
	);
	await service.save(workspace, {
		name: "demo",
		scope: "user",
		config: chatConfiguration,
		policy: { tools: {} },
	});
	const revoked = await pi.promptAgent(
		{
			frontendSessionId: "child",
			frontendTurnId: "revoked-answer",
			prompt: "Try again",
			transcript: [],
			model,
		},
		workspace,
	);
	assert.equal(revoked.ok, true, revoked.error);
	assert.equal(revoked.assistantText, "Permission denied explicitly");
	pi.reloadInstalledPlugins();
	faux.setResponses([
		(context) => {
			assert(
				getCurrentTools(context.messages).some((tool) => tool.name === "mcp__demo__echo"),
				"Restarting the same conversation restores its discovered tool.",
			);
			return fauxAssistantMessage("Resumed conversation");
		},
	]);
	const resumed = await pi.promptAgent(
		{
			frontendSessionId: "child",
			frontendTurnId: "resumed-answer",
			prompt: "Resume",
			transcript: [],
			model,
		},
		workspace,
	);
	assert.equal(resumed.ok, true, resumed.error);
	const worktree = path.join(directory, "isolated-worktree");
	await mkdir(worktree);
	await service.trust(workspace, true);
	await service.save(workspace, {
		name: "demo",
		scope: "project",
		config: { ...configuration, exposure: "direct" },
		policy: { tools: { write: "write" } },
	});
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("mcp__demo__write", {}), { stopReason: "toolUse" }),
		fauxAssistantMessage("Written directly in non-Git workspace"),
	]);
	const direct = await pi.promptAgent(
		{
			frontendSessionId: "non-git",
			frontendTurnId: "non-git-answer",
			prompt: "Write",
			transcript: [],
			model,
			writable: true,
		},
		workspace,
	);
	assert.equal(direct.ok, true, direct.error);
	assert.equal(direct.workspacePath, workspace);
	assert.equal(direct.isolated, false);
	assert.equal(await readFile(path.join(workspace, "mcp-write.txt"), "utf8"), "fixture write");
	await rm(path.join(workspace, "mcp-write.txt"));
	t.mock.method(WorktreeService.prototype, "resolveSessionWorkspace", async () => ({
		path: worktree,
		isolated: true,
		writable: true,
	}));
	faux.setResponses([
		(context) => {
			assert(
				getCurrentTools(context.messages).some((tool) => tool.name === "mcp__demo__write"),
				"A writable worktree resolves MCP configuration from the original trusted workspace.",
			);
			return fauxAssistantMessage(fauxToolCall("mcp__demo__write", {}), { stopReason: "toolUse" });
		},
		fauxAssistantMessage("Written in isolated worktree"),
	]);
	const written = await pi.promptAgent(
		{
			frontendSessionId: "isolated",
			frontendTurnId: "isolated-answer",
			prompt: "Write",
			transcript: [],
			model,
			writable: true,
		},
		workspace,
	);
	assert.equal(written.ok, true, written.error);
	assert.equal(await readFile(path.join(worktree, "mcp-write.txt"), "utf8"), "fixture write");
	await assert.rejects(readFile(path.join(workspace, "mcp-write.txt")), { code: "ENOENT" });
	const longName = `long_${"server".repeat(12)}`;
	await service.save(workspace, {
		name: longName,
		scope: "user",
		config: { ...configuration, exposure: "direct" },
		policy: { tools: { echo: "read" } },
	});
	faux.setResponses([
		(context) => {
			const tool = getCurrentTools(context.messages).find(
				(tool) => tool.name.startsWith("mcp__long_") && tool.description.includes("Echo a fixture"),
			);
			assert(tool, "Long server names remain usable after SDK name hashing.");
			assert.equal(tool.name.length, 64);
			return fauxAssistantMessage(fauxToolCall(tool.name, { text: "long server identity" }), {
				stopReason: "toolUse",
			});
		},
		(context) => {
			assert(
				context.messages.some(
					(message) =>
						message.role === "toolResult" &&
						!message.isError &&
						JSON.stringify(message.content).includes("long server identity"),
				),
				"Hashed identifiers retain the original server/tool permission identity.",
			);
			return fauxAssistantMessage("Long server approved");
		},
	]);
	const longServer = await pi.promptAgent(
		{
			frontendSessionId: "long-name",
			frontendTurnId: "long-answer",
			prompt: "Echo",
			transcript: [],
			model,
		},
		workspace,
	);
	assert.equal(longServer.ok, true, longServer.error);
});
