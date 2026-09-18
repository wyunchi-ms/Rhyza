import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { streamCliJson } from "../electron/main/cli-process";

function command(script: string) {
	return {
		file: process.execPath,
		args: ["-e", script],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	};
}

async function collect(script: string, signal = new AbortController().signal) {
	const items: unknown[] = [];
	for await (const item of streamCliJson(command(script), [], "input\n", tmpdir(), signal)) {
		items.push(item);
	}
	return items;
}

test("CLI JSON streaming reads stdin and waits for successful process exit", async () => {
	const result = await collect(`process.stdin.resume(); process.stdin.on("end", () => {
		console.log(JSON.stringify({ type: "result", value: "ok" }));
	});`);
	assert.deepEqual(result, [{ type: "result", value: "ok" }]);
});

test("a success-shaped result followed by nonzero CLI exit still fails", async () => {
	await assert.rejects(
		collect(`
		console.log(JSON.stringify({ type: "result", subtype: "success" }));
		console.error("authentication expired");
		process.exitCode = 2;
	`),
		/exited with code 2: authentication expired/,
	);
});

test("malformed CLI output fails explicitly", async () => {
	await assert.rejects(collect(`console.log("not json");`), /invalid stream JSON/);
});

test("aborting CLI execution stops the owned process", async () => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error("test cancellation")), 300);
	try {
		await assert.rejects(
			collect(`setInterval(() => {}, 1000);`, controller.signal),
			/test cancellation/,
		);
	} finally {
		clearTimeout(timer);
	}
});
