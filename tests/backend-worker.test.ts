import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { BackendService } from "../electron/main/backend-service.js";
import { AppStateStore } from "../electron/main/app-state-store.js";
import type { BackendEvent } from "../electron/main/backend-contract.js";
import { WorkerRpc } from "../electron/main/worker-rpc.js";

test(
	"real Pi resource loading blocks only the worker while parent timers and RPC events stay responsive",
	{ timeout: 60_000 },
	async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "rhyza-backend-worker-"));
		const agentDir = path.join(directory, "agent");
		const workspace = path.join(directory, "workspace");
		await mkdir(path.join(agentDir, "extensions"), { recursive: true });
		await mkdir(workspace);
		await writeFile(
			path.join(agentDir, "extensions", "blocking.js"),
			`
export default function(pi) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
	pi.on("session_start", () => {});
}
`,
		);
		const events: BackendEvent[] = [];
		let measuring = false;
		let ticks = 0;
		let lastTick = performance.now();
		let maxDelay = 0;
		const timer = setInterval(() => {
			const now = performance.now();
			if (measuring) {
				ticks++;
				maxDelay = Math.max(maxDelay, now - lastTick);
			}
			lastTick = now;
		}, 10);
		const backend = new BackendService(
			{ dataRoot: directory, home: directory, agentDir },
			{
				openUrl: async () => {
					throw new Error("Unexpected external URL");
				},
			},
			(event) => {
				events.push(event);
				if (
					event.type === "diagnostic" &&
					event.kind === "agent-stage" &&
					event.value.stage === "resources-reload"
				) {
					measuring = event.value.status === "start";
				}
			},
			new URL("./fixtures/backend-worker-fixture.mjs", import.meta.url),
		);
		try {
			await backend.ready;
			await backend.settings.setWorkspacePath(workspace);
			const reply = await backend.agent.promptAgent(
				{
					frontendSessionId: "root",
					frontendTurnId: "answer",
					prompt: "Offline fixture",
					transcript: [],
					model: { providerId: "github-copilot", modelId: "worker-fixture" },
				},
				workspace,
			);
			assert.equal(reply.ok, true, reply.error);
			assert.equal(reply.assistantText, "Worker answer");
			const stages = events.flatMap((event) =>
				event.type === "diagnostic" && event.kind === "agent-stage" ? [event.value] : [],
			);
			assert.ok(
				stages.some(
					(event) =>
						event.stage === "resources-reload" &&
						event.status === "end" &&
						event.durationMs! >= 750,
				),
			);
			assert.ok(ticks >= 20, `Parent heartbeat ran only ${ticks} times during resource loading`);
			assert.ok(maxDelay < 200, `Parent timer stalled for ${maxDelay.toFixed(1)}ms`);
			assert.ok(
				events.some((event) => event.type === "agent" && event.value.type === "prompt_start"),
			);
			assert.ok(events.some((event) => event.type === "diagnostic" && event.threadId > 0));
			const serialized = JSON.stringify({
				workspacePath: workspace,
				state: { sessions: [{ id: "root" }], turns: [], diagrams: [] },
			});
			await backend.state.save(workspace, serialized);
			assert.deepEqual(await backend.state.load(workspace), JSON.parse(serialized));
			await assert.rejects(
				backend.state.save(workspace, '{"workspacePath":"other"}'),
				/does not match/,
			);
			assert.deepEqual(await backend.state.load(workspace), JSON.parse(serialized));
			const dump = await backend.forkDebugDump({
				kind: "fork",
				timestamp: "2026-10-13T00:00:00Z",
				selectedTurnId: "answer",
				snapshot: { fixture: true },
			});
			assert.deepEqual(JSON.parse(await readFile(dump.path, "utf8")), { fixture: true });
			const envelope = {
				version: 2,
				workspacePath: workspace,
				state: {
					sessions: [{ id: "root" }],
					turns: [],
					diagrams: [],
					fixtureNotes: "x".repeat(3 * 1024 * 1024),
				},
			};
			const saving = backend.state.save(workspace, envelope);
			await new Promise<void>((resolve) => setImmediate(resolve));
			await backend.dispose();
			await saving;
			assert.deepEqual(
				JSON.parse(new AppStateStore(directory).load(workspace)!),
				envelope,
				"shutdown must finish accepted structured state saves",
			);
			console.log(
				JSON.stringify({
					workerBlockedMs: 750,
					parentHeartbeatTicks: ticks,
					parentMaxGapMs: Math.round(maxDelay),
				}),
			);
		} finally {
			clearInterval(timer);
			try {
				await backend.dispose();
			} finally {
				await rm(directory, { recursive: true, force: true, maxRetries: 5 });
			}
		}
	},
);

test(
	"worker startup failure and crashes reject callers instead of returning success-shaped defaults",
	{ timeout: 15_000 },
	async () => {
		const fixture = new URL("./fixtures/backend-rpc-fixture.mjs", import.meta.url);
		const failed = new BackendService(
			{ dataRoot: "startup-error", home: tmpdir() },
			{ openUrl: async () => {} },
			() => {},
			fixture,
		);
		await assert.rejects(failed.ready, /Fixture startup failed/);
		await assert.rejects(failed.settings.getWorkspacePath(), /Fixture startup failed/);
		await assert.rejects(failed.dispose(), /Fixture startup failed/);
		const crashed = new BackendService(
			{ dataRoot: tmpdir(), home: tmpdir() },
			{ openUrl: async () => {} },
			() => {},
			fixture,
		);
		await crashed.ready;
		const pending = assert.rejects(crashed.state.load(null), /exited \(code 7\)/);
		await assert.rejects(crashed.settings.getWorkspacePath(), /exited \(code 7\)/);
		await pending;
		await assert.rejects(crashed.state.load(null), /exited \(code 7\)/);
		await assert.rejects(crashed.dispose(), /exited \(code 7\)/);
	},
);

test("bidirectional worker RPC preserves correlation, explicit errors, and asynchronous browser actions", async () => {
	const { port1, port2 } = new MessageChannel();
	type ParentApi = { openUrl(url: string): Promise<void> };
	type ChildApi = {
		answer(value: number): Promise<number>;
		authorize(): Promise<void>;
		invalid(): Promise<void>;
	};
	const opened: string[] = [];
	const parent = new WorkerRpc<ChildApi, ParentApi>(port1, {
		openUrl: async (url) => {
			opened.push(url);
		},
	});
	const child: WorkerRpc<ParentApi, Omit<ChildApi, "invalid">> = new WorkerRpc(port2, {
		answer: async (value) => {
			await new Promise((resolve) => setTimeout(resolve, 20 - value));
			return value * 2;
		},
		authorize: (): Promise<void> => child.call("openUrl", "https://example.invalid/auth"),
	});
	try {
		assert.deepEqual(
			await Promise.all([parent.call("answer", 1), parent.call("answer", 10)]),
			[2, 20],
		);
		await parent.call("authorize");
		assert.deepEqual(opened, ["https://example.invalid/auth"]);
		await assert.rejects(parent.call("invalid"), /Unknown background service operation/);
	} finally {
		parent.close();
		child.close();
		port1.close();
		port2.close();
	}
});
