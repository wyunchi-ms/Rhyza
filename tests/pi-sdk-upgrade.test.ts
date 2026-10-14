import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxToolCall,
	fauxProvider,
	getCurrentSystemPrompt,
	getCurrentTools,
	type FauxResponseFactory,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { CodexAppServer } from "../electron/main/codex-app-server.js";
import { PiService } from "../electron/main/pi-service.js";
import { summaryCompletionMarker, summarySystemPrompt } from "../electron/main/path-summary.js";
import type { AgentBridgeEvent } from "../src/shared/ipc.js";
import { parseTodoChecklist } from "../electron/main/todo-service.js";
import { WorktreeService } from "../electron/main/worktree-service.js";

test("non-Git Pi chats read and edit live TODO files, while read-only and failed Git sessions exclude write tools", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-pi-directory-write-"));
	const agentDir = path.join(directory, "agent");
	const workspace = path.join(directory, "notes");
	await Promise.all([mkdir(agentDir), mkdir(workspace)]);
	const runtime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
		modelsStorePath: path.join(agentDir, "models-store.json"),
		allowModelNetwork: false,
	});
	const faux = fauxProvider({
		provider: "github-copilot",
		api: "openai-responses",
		models: [{ id: "directory-fixture" }],
	});
	runtime.registerNativeProvider(faux.provider);
	t.mock.method(ModelRuntime, "create", async () => runtime);
	t.mock.method(CodexAppServer.prototype, "account", async () => null);
	const service = new PiService(directory, undefined, undefined, agentDir);
	try {
		await writeFile(path.join(workspace, "TODO.md"), "- [x] First task\n- [ ] Second task\n");
		faux.setResponses([
			(context) => {
				const tools = getCurrentTools(context.messages).map((tool) => tool.name);
				for (const name of ["read", "edit", "write", "bash"]) assert(tools.includes(name));
				return fauxAssistantMessage(fauxToolCall("read", { path: "TODO.md" }), {
					stopReason: "toolUse",
				});
			},
			(context) => {
				const readResult = [...context.messages]
					.reverse()
					.find((message) => message.role === "toolResult");
				assert(readResult);
				assert.match(JSON.stringify(readResult.content), /\[x\] First task/);
				assert.match(JSON.stringify(readResult.content), /\[ \] Second task/);
				return fauxAssistantMessage(
					fauxToolCall("edit", {
						path: "TODO.md",
						oldText: "- [ ] Second task",
						newText: "- [x] Second task",
					}),
					{ stopReason: "toolUse" },
				);
			},
			fauxAssistantMessage("Saved both completed tasks"),
		]);
		const request = {
			frontendSessionId: "directory-chat",
			frontendTurnId: "directory-turn",
			transcript: [],
			prompt: "Read the current TODO and mark the second task complete.",
			model: { providerId: "github-copilot" as const, modelId: "directory-fixture" },
			writable: true,
		};
		const result = await service.promptAgent(request, workspace);
		assert.equal(result.ok, true, result.error);
		assert.equal(result.workspacePath, workspace);
		assert.equal(result.isolated, false);
		assert.equal(
			await readFile(path.join(workspace, "TODO.md"), "utf8"),
			"- [x] First task\n- [x] Second task\n",
		);
		assert.equal(
			(await service.getWorkspaceTodos(request.frontendSessionId, workspace)).completed,
			2,
		);

		const readOnlyReply: FauxResponseFactory = (context) => {
			assert.deepEqual(
				getCurrentTools(context.messages)
					.map((tool) => tool.name)
					.sort(),
				["find", "grep", "ls", "read"],
			);
			assert.match(getCurrentSystemPrompt(context.messages), /read-only session/);
			return fauxAssistantMessage("Read-only");
		};
		faux.setResponses([readOnlyReply]);
		assert.equal(
			(
				await service.promptAgent(
					{ ...request, frontendTurnId: "readonly-turn", writable: false },
					workspace,
				)
			).ok,
			true,
		);
		t.mock.method(WorktreeService.prototype, "resolveSessionWorkspace", async () => ({
			path: workspace,
			isolated: false,
			writable: false,
		}));
		faux.setResponses([readOnlyReply]);
		assert.equal(
			(
				await service.promptAgent(
					{ ...request, frontendSessionId: "failed-git-chat", frontendTurnId: "failed-git-turn" },
					workspace,
				)
			).ok,
			true,
		);
		let dumpSaved = false;
		for (let attempt = 0; attempt < 100; attempt++) {
			const history = await service.getModelRequestHistory("failed-git-chat");
			if (history.turns["failed-git-turn"]?.[0]?.usage) {
				dumpSaved = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert(dumpSaved, "The final request dump must finish before deleting the fixture directory.");
	} finally {
		await service.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

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
		`# Fixture path summary\nOnly the selected conversation.\n${summaryCompletionMarker}`,
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
	const pathSummary = await service.generatePathSummary(
		{
			requestId: "sdk-path-summary",
			model,
			rounds: [
				{
					id: "selected-round",
					messages: [{ id: "selected-user", role: "user", content: "Selected question" }],
				},
			],
			paths: [{ id: "selected-round", title: "Selected path", roundIds: ["selected-round"] }],
		},
		directory,
		() => {},
	);
	assert.equal(pathSummary.error, undefined);
	assert.equal(pathSummary.content, "# Fixture path summary\nOnly the selected conversation.");
	assert.equal(
		getCurrentSystemPrompt(contexts[4].messages),
		`${summarySystemPrompt}\n\n<cwd>\n${directory.split(path.sep).join("/")}\n</cwd>`,
	);
	assert.deepEqual(getCurrentTools(contexts[4].messages), []);
	assert(!contexts[4].messages.some((message) => message.role === "assistant"));
	assert.equal(contexts.length, 5);
	assert.equal(
		settings.length,
		4,
		"Chat, title, extraction, and path summary each use host-controlled settings.",
	);
	assert(settings.every((manager) => manager.getCacheWarmingMode() === "off"));
	await Promise.all(settings.map((manager) => manager.reload()));
	assert(settings.every((manager) => manager.getCacheWarmingMode() === "off"));
	assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).cacheWarming, "idle");
});

test("Pi SDK roadmap preserves eight capabilities with only MCP and discovery delivered", async () => {
	const content = await readFile(new URL("../docs/TODO-pi-sdk.md", import.meta.url), "utf8");
	const todos = parseTodoChecklist(content);
	assert.equal(todos.length, 8);
	assert(todos.every((todo) => todo.children.length === 0));
	assert.deepEqual(
		todos.map((todo) => todo.completed),
		[true, true, false, false, false, false, false, false],
	);
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
