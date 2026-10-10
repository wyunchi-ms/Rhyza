import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxProvider,
	getCurrentSystemPrompt,
	getCurrentTools,
	type FauxResponseFactory,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { CodexAppServer } from "../electron/main/codex-app-server.js";
import { PiService } from "../electron/main/pi-service.js";
import type { AgentBridgeEvent } from "../src/shared/ipc.js";
import { parseTodoChecklist } from "../electron/main/todo-service.js";

test("SDK upgrade preserves host context, cache evidence, and explicit feature gates", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-pi-sdk-upgrade-"));
	const agentDir = path.join(directory, "agent");
	await mkdir(agentDir);
	const settingsPath = path.join(agentDir, "settings.json");
	await writeFile(settingsPath, JSON.stringify({ cacheWarming: "idle" }));
	const runtime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
		modelsStorePath: path.join(agentDir, "models-store.json"),
		allowModelNetwork: false,
	});
	const faux = fauxProvider({
		provider: "github-copilot",
		api: "openai-responses",
		models: [{ id: "sdk-fixture" }],
	});
	const contexts: TranscriptContext[] = [];
	const replies = [
		"First answer",
		"Second answer",
		"Fixture title",
		'{"entities":[],"relations":[],"diagrams":[]}',
	];
	faux.setResponses(
		replies.map<FauxResponseFactory>((reply, index) => async (context, options, _state, model) => {
			contexts.push(context);
			if (index === 0) {
				await options?.onProviderStreamEvent?.(
					{
						type: "response.completed",
						response: {
							created_at: 1789372800,
							prompt_cache_options: { ttl: "30m", mode: "implicit" },
						},
					},
					model,
				);
			}
			return fauxAssistantMessage(reply);
		}),
	);
	runtime.registerNativeProvider(faux.provider);
	t.mock.method(ModelRuntime, "create", async () => runtime);
	t.mock.method(CodexAppServer.prototype, "account", async () => null);
	const settings: SettingsManager[] = [];
	const createSettings = SettingsManager.create;
	t.mock.method(SettingsManager, "create", (...args: Parameters<typeof createSettings>) => {
		const manager = createSettings(...args);
		settings.push(manager);
		return manager;
	});
	const events: AgentBridgeEvent[] = [];
	const service = new PiService(directory, undefined, (event) => events.push(event), agentDir);
	t.after(async () => {
		service.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	const model = { providerId: "github-copilot" as const, modelId: "sdk-fixture" };
	for (const [index, question] of ["First question", "Second question"].entries()) {
		const result = await service.promptAgent(
			{
				frontendSessionId: "conversation",
				frontendTurnId: `turn-${index}`,
				transcript: [],
				prompt: question,
				model,
			},
			directory,
		);
		assert.equal(result.ok, true, result.error);
		assert.equal(result.assistantText, replies[index]);
	}
	const history = await service.getModelRequestHistory("conversation");
	const first = history.turns["turn-0"][0];
	const second = history.turns["turn-1"][0];
	assert.equal(first.cache?.ttl, "30m");
	assert.equal(second.cache, undefined, "A previous request's TTL must not leak into the next.");
	assert.equal(first.context.systemPrompt, getCurrentSystemPrompt(contexts[0].messages));
	assert.deepEqual(
		(first.context.tools ?? []).map((tool) => (tool as { name: string }).name).sort(),
		["find", "grep", "ls", "read"],
	);
	assert.deepEqual(
		getCurrentTools(contexts[0].messages)
			.map((tool) => tool.name)
			.sort(),
		["find", "grep", "ls", "read"],
	);
	assert(contexts[1].messages.some((message) => message.role === "assistant"));
	const completed = events.filter((event) => event.type === "message_end" && event.usage);
	assert.equal(completed[0]?.cache?.ttl, "30m");
	assert.equal(completed[1]?.cache, undefined);
	assert.equal(
		(await service.generateSummary({ text: "Question", model }, directory)).summary,
		"Fixture title",
	);
	const extraction = await service.extractKnowledge(
		{ question: "Question", answer: "Answer", existingEntities: [], existingDiagrams: [], model },
		directory,
	);
	assert.equal(extraction.error, undefined);
	assert.equal(contexts.length, 4);
	assert.equal(
		settings.length,
		3,
		"Chat, title, and extraction each use host-controlled settings.",
	);
	assert(settings.every((manager) => manager.getCacheWarmingMode() === "off"));
	await Promise.all(settings.map((manager) => manager.reload()));
	assert(settings.every((manager) => manager.getCacheWarmingMode() === "off"));
	assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).cacheWarming, "idle");
});

test("Pi SDK roadmap persists exactly the eight requested, unfinished capabilities", async () => {
	const content = await readFile(new URL("../docs/TODO-pi-sdk.md", import.meta.url), "utf8");
	const todos = parseTodoChecklist(content);
	assert.equal(todos.length, 8);
	assert(todos.every((todo) => !todo.completed && todo.children.length === 0));
	assert.deepEqual(
		todos.map((todo) => todo.text.split("：")[0]),
		[
			"通用 MCP 接入",
			"工具按需发现",
			"自动模型路由",
			"统一图片生成",
			"更精细的上下文管理",
			"Prompt cache 保活",
			"原生 PowerShell 工具",
			"分类模型",
		],
	);
});
