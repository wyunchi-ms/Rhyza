import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentService } from "../electron/main/agent-service";
import { PiService, type PiPromptRequest } from "../electron/main/pi-service";
import type { NativeAgentRequest, NativeAgentResult } from "../electron/main/native-agent";
import { WorktreeService } from "../electron/main/worktree-service";
import type { AgentPromptRequest, ProviderId } from "../src/shared/ipc";

class FakeAgentService extends AgentService {
	requests: NativeAgentRequest[] = [];
	reply = "Native answer";

	protected override async runNative(request: NativeAgentRequest): Promise<NativeAgentResult> {
		this.requests.push(request);
		return { assistantText: this.reply };
	}
}

function prompt(providerId: ProviderId, frontendSessionId = "session"): AgentPromptRequest {
	return {
		frontendSessionId,
		frontendTurnId: "assistant-turn",
		transcript: [],
		prompt: "Question",
		model: { providerId, modelId: "" },
	};
}

test("native providers route chat, titles and knowledge through their own default model", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-provider-test-"));
	try {
		const service = new FakeAgentService(
			directory,
			undefined,
			undefined,
			path.join(directory, "pi"),
		);
		for (const providerId of ["codex", "claude-code"] as const) {
			const request = prompt(providerId, providerId);
			const result = await service.promptAgent(request, directory);
			assert.equal(result.ok, true);
			assert.equal(result.assistantText, "Native answer");
			assert.equal(service.requests.at(-1)?.providerId, providerId);
			assert.equal(service.requests.at(-1)?.modelId, "");
			const summary = await service.generateSummary(
				{ text: "Title", model: request.model },
				directory,
			);
			assert.equal(summary.summary, "Native answer");
			assert.equal(service.requests.at(-1)?.tools, false);
			assert.equal(service.requests.at(-1)?.writable, false);
			service.reply = '{"entities":[],"relations":[],"diagrams":[]}';
			const extraction = await service.extractKnowledge(
				{
					question: "Question",
					answer: "Answer",
					existingEntities: [],
					existingDiagrams: [],
					model: request.model,
				},
				directory,
			);
			assert.deepEqual(extraction.entities, []);
			assert.equal(extraction.error, undefined);
			assert.equal(service.requests.at(-1)?.providerId, providerId);
			service.reply = "Native answer";
		}
		const history = await service.getModelRequestHistory("codex");
		assert.equal(history.turns["assistant-turn"][0].provider, "codex");
		assert.equal(history.turns["assistant-turn"][0].api, "codex-sdk-agent-input");
		assert.equal(history.turns["assistant-turn"][0].wirePayload, undefined);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("native writable tools are disabled unless Git isolation succeeded", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-provider-permissions-"));
	t.mock.method(WorktreeService.prototype, "resolveSessionWorkspace", async () => ({
		path: directory,
		isolated: false,
	}));
	try {
		const service = new FakeAgentService(
			directory,
			undefined,
			undefined,
			path.join(directory, "pi"),
		);
		assert.equal(
			(await service.promptAgent({ ...prompt("codex"), writable: true }, directory)).ok,
			true,
		);
		assert.equal(service.requests[0].writable, false);
		const firstPart = service.requests[0].parts[0];
		assert.equal(firstPart.type, "text");
		if (firstPart.type === "text") assert.match(firstPart.text, /read-only session/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("returning to Copilot rebuilds its context from visible history, including after restart", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-provider-switch-"));
	const piRequests: PiPromptRequest[] = [];
	t.mock.method(PiService.prototype, "promptAgent", async (request: PiPromptRequest) => {
		piRequests.push(request);
		return { ok: true, assistantText: "Pi answer" };
	});
	try {
		const service = new FakeAgentService(
			directory,
			undefined,
			undefined,
			path.join(directory, "pi"),
		);
		await service.promptAgent(prompt("github-copilot"), directory);
		assert.equal(piRequests[0].sessionGeneration, undefined);
		await service.promptAgent(prompt("codex"), directory);
		const transcript = [
			{ id: "codex-answer", role: "assistant" as const, content: "Native answer" },
		];
		await service.promptAgent({ ...prompt("github-copilot"), transcript }, directory);
		assert.ok(piRequests[1].sessionGeneration);
		assert.deepEqual(piRequests[1].transcript, transcript);
		const restarted = new FakeAgentService(
			directory,
			undefined,
			undefined,
			path.join(directory, "pi"),
		);
		await restarted.promptAgent({ ...prompt("github-copilot"), transcript }, directory);
		assert.equal(piRequests[2].sessionGeneration, piRequests[1].sessionGeneration);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("native extraction failures retain deterministic diagrams and surface the error", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-provider-extraction-"));
	try {
		const service = new FakeAgentService(
			directory,
			undefined,
			undefined,
			path.join(directory, "pi"),
		);
		service.reply = "not JSON";
		const result = await service.extractKnowledge(
			{
				question: "Explain",
				answer: "```mermaid\nflowchart TD\nA[Start] --> B[Finish]\n```",
				existingEntities: [],
				existingDiagrams: [],
				model: { providerId: "claude-code", modelId: "" },
			},
			directory,
		);
		assert.match(result.error ?? "", /did not return JSON/);
		assert.equal(result.diagrams.length, 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
