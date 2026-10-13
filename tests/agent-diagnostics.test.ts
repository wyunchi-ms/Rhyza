import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AgentDiagnosticTrace,
	type AgentDiagnosticEvent,
} from "../electron/main/agent-diagnostics.js";

test("agent stages correlate concurrent spans and preserve results and errors without payloads", async () => {
	const events: AgentDiagnosticEvent[] = [];
	const trace = new AgentDiagnosticTrace(
		(event) => events.push(event),
		"prompt",
		"session",
		"turn",
	);
	trace.mark("request-received", { transcriptTurns: 3 });
	assert.equal(
		trace.measure("settings", () => 42),
		42,
	);
	let release!: (value: number) => void;
	const result = trace.span(
		"mcp-connect",
		() =>
			new Promise<number>((resolve) => {
				release = resolve;
			}),
	);
	assert.equal(events.at(-1)?.status, "start");
	release(7);
	assert.equal(await result, 7);
	const first = trace.begin("mcp-rpc-tools/list", { serverOrdinal: 1 });
	const second = trace.begin("mcp-rpc-tools/list", { serverOrdinal: 2 });
	second(true);
	first(false);
	first(true);
	const starts = events.filter(
		(event) => event.stage === "mcp-rpc-tools/list" && event.status === "start",
	);
	const ends = events.filter(
		(event) => event.stage === "mcp-rpc-tools/list" && event.status === "end",
	);
	assert.equal(ends.length, 2);
	assert.equal(ends[0].spanId, starts[1].spanId);
	assert.equal(ends[1].spanId, starts[0].spanId);
	const error = new TypeError("secret error detail");
	assert.throws(
		() =>
			trace.measure("sync-error", () => {
				throw error;
			}),
		error,
	);
	await assert.rejects(
		trace.span("async-error", async () => {
			throw error;
		}),
		error,
	);
	await assert.rejects(
		trace.span("dispatch-error", () => {
			throw error;
		}),
		error,
	);
	const failed = events.filter((event) => event.error);
	assert.equal(failed.length, 3);
	assert.ok(failed.every((event) => event.error === "TypeError" && event.ok === false));
	assert.equal(JSON.stringify(events).includes("secret error detail"), false);
	assert.ok(events.every((event) => event.traceId === events[0].traceId));
	assert.ok(
		events.every(
			(event) => event.frontendSessionId === "session" && event.frontendTurnId === "turn",
		),
	);
	assert.ok(
		events
			.filter((event) => event.status === "end")
			.every((event) => (event.durationMs ?? -1) >= 0),
	);
	assert.ok(
		events
			.filter((event) => event.syncDispatchMs !== undefined)
			.every((event) => event.syncDispatchMs! <= event.durationMs!),
	);
	const other = new AgentDiagnosticTrace((event) => events.push(event), "title");
	other.mark("request-received");
	assert.notEqual(events.at(-1)?.traceId, events[0].traceId);
});

test("stage wall time includes waiting but synchronous dispatch excludes it", async () => {
	const events: AgentDiagnosticEvent[] = [];
	const trace = new AgentDiagnosticTrace((event) => events.push(event), "prompt");
	await trace.span("network-wait", () => new Promise<void>((resolve) => setTimeout(resolve, 40)));
	const end = events.at(-1)!;
	assert.ok(end.durationMs! - end.syncDispatchMs! >= 20);
	assert.equal(end.ok, true);
});

test("analyzer reports stage aggregates, request milestones, and unfinished spans", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-agent-diagnostics-"));
	try {
		const log = path.join(directory, "performance.jsonl");
		const events: AgentDiagnosticEvent[] = [];
		const trace = new AgentDiagnosticTrace(
			(event) => events.push(event),
			"prompt",
			"session",
			"turn",
		);
		trace.measure("resources-reload", () => undefined);
		trace.mark("first-output");
		trace.begin("mcp-rpc-tools/list", { serverOrdinal: 1 });
		await writeFile(
			log,
			events
				.map((event) => JSON.stringify({ kind: "agent-stage", processId: 123, ...event }))
				.join("\n"),
		);
		const script = fileURLToPath(new URL("../scripts/analyze-performance.mjs", import.meta.url));
		const output = execFileSync(process.execPath, [script, log], { encoding: "utf8" });
		assert.match(output, /prompt\/resources-reload\s+count=1/);
		assert.match(output, /sync-dispatch max=/);
		assert.match(output, /first-output/);
		assert.match(output, /pid=123 session=session turn=turn/);
		assert.match(output, /Stages without an end event/);
		assert.match(output, /prompt\/mcp-rpc-tools\/list/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
