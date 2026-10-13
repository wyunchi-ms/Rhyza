const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

if (!process.versions.electron) {
	const { test } = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"Electron Main and window interaction remain responsive during blocked Pi resource loading",
		{ timeout: 90_000 },
		async () => {
			const directory = await mkdtemp(path.join(os.tmpdir(), "rhyza-worker-window-"));
			const env = { ...process.env, RHYZA_WORKER_TEST_DATA: directory };
			delete env.ELECTRON_RUN_AS_NODE;
			try {
				const child = spawn(require("electron"), [__filename], { env, windowsHide: true });
				let output = "";
				child.stdout.on("data", (chunk) => {
					output += chunk;
				});
				child.stderr.on("data", (chunk) => {
					output += chunk;
				});
				const timeout = setTimeout(() => child.kill(), 80_000);
				try {
					const code = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(code, 0, output);
					console.log(output.trim());
				} finally {
					clearTimeout(timeout);
				}
			} finally {
				await rm(directory, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	const directory = process.env.RHYZA_WORKER_TEST_DATA;
	app.setPath("userData", path.join(directory, "electron"));
	app.on("window-all-closed", () => {});
	app
		.whenReady()
		.then(async () => {
			const { BackendService } = await import("../dist-electron/electron/main/backend-service.js");
			const agentDir = path.join(directory, "agent");
			const workspace = path.join(directory, "workspace");
			await mkdir(path.join(agentDir, "extensions"), { recursive: true });
			await mkdir(workspace);
			await writeFile(
				path.join(agentDir, "extensions", "blocking.js"),
				`
export default function() {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}
`,
			);
			const browser = new BrowserWindow({
				show: false,
				webPreferences: {
					contextIsolation: true,
					nodeIntegration: false,
					backgroundThrottling: false,
				},
			});
			await browser.loadURL(
				"data:text/html," +
					encodeURIComponent(`
<button id="create">New node</button><output id="count">0</output>
<script>
window.nodes = 0;
window.ticks = 0;
setInterval(() => window.ticks++, 10);
document.getElementById("create").onclick = () => {
	document.getElementById("count").textContent = String(++window.nodes);
};
</script>`),
			);
			let measuring = false;
			let blockedMs = 0;
			let lastTick = performance.now();
			let maxMainGap = 0;
			let mainTicks = 0;
			let maxWindowRoundtrip = 0;
			const probes = [];
			const results = [];
			const timer = setInterval(() => {
				const now = performance.now();
				if (measuring) {
					mainTicks++;
					maxMainGap = Math.max(maxMainGap, now - lastTick);
					const started = performance.now();
					probes.push(
						browser.webContents
							.executeJavaScript(
								`
					document.getElementById("create").click();
					({ nodes: window.nodes, ticks: window.ticks, text: document.getElementById("count").textContent })
				`,
							)
							.then((result) => {
								results.push(result);
								maxWindowRoundtrip = Math.max(maxWindowRoundtrip, performance.now() - started);
							}),
					);
				}
				lastTick = now;
			}, 25);
			const backend = new BackendService(
				{ dataRoot: path.join(directory, "state"), home: directory, agentDir },
				{
					openUrl: async () => {
						throw new Error("Unexpected authorization URL");
					},
				},
				(event) => {
					if (
						event.type === "diagnostic" &&
						event.kind === "agent-stage" &&
						event.value.stage === "resources-reload"
					) {
						measuring = event.value.status === "start";
						if (event.value.status === "end") blockedMs = event.value.durationMs;
					}
				},
				pathToFileURL(path.join(__dirname, "fixtures", "backend-worker-fixture.mjs")),
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
				await Promise.all(probes);
				assert.ok(
					blockedMs >= 1500,
					`Resource loading did not execute the blocking fixture: ${blockedMs}`,
				);
				assert.ok(mainTicks >= 20, `Main heartbeat ran only ${mainTicks} times`);
				assert.ok(maxMainGap < 250, `Electron Main stalled for ${maxMainGap}ms`);
				assert.ok(
					results.length >= 20,
					"Window interactions did not complete during resource loading",
				);
				assert.ok(
					maxWindowRoundtrip < 250,
					`Window interaction stalled for ${maxWindowRoundtrip}ms`,
				);
				assert.ok(results.every((result) => result.text === String(result.nodes)));
				assert.ok(results.at(-1).ticks > results[0].ticks, "Renderer timers stopped");
				console.log(
					"WORKER_WINDOW_RESPONSIVENESS",
					JSON.stringify({
						workerBlockedMs: Math.round(blockedMs),
						mainTicks,
						mainMaxGapMs: Math.round(maxMainGap),
						windowInteractions: results.length,
						windowMaxRoundtripMs: Math.round(maxWindowRoundtrip),
					}),
				);
			} finally {
				clearInterval(timer);
				try {
					await backend.dispose();
				} finally {
					browser.destroy();
				}
			}
		})
		.then(
			() => app.exit(0),
			(error) => {
				console.error(error);
				app.exit(1);
			},
		);
}
