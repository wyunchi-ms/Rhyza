const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");
if (!process.versions.electron) {
	const test = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"path summaries work across list/graph selection, failures, cancellation and reload",
		{ timeout: 180_000 },
		async () => {
			const userData = await mkdtemp(path.join(tmpdir(), "rhyza-summary-ui-"));
			const env = {
				...process.env,
				RHYZA_SUMMARY_UI_DATA: userData,
				ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
			};
			delete env.ELECTRON_RUN_AS_NODE;
			try {
				const child = spawn(require("electron"), [__filename], { cwd: projectRoot, env });
				let output = "";
				child.stdout.on("data", (data) => {
					output += data;
				});
				child.stderr.on("data", (data) => {
					output += data;
				});
				const timeout = setTimeout(() => child.kill(), 170_000);
				try {
					const code = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(code, 0, output);
				} finally {
					clearTimeout(timeout);
				}
			} finally {
				await rm(userData, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_SUMMARY_UI_DATA);
	app.on("window-all-closed", () => {});
	let browser;
	let server;
	const errors = [];
	const host = (code) => browser.webContents.executeJavaScript(code);
	const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const click = async (selector) => {
		await host(`document.querySelector(${JSON.stringify(selector)}).click()`);
		await host(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	};
	const activeView = ".sidebar-view-content:not([hidden])";
	const listRow = (id) =>
		`${activeView} [data-session-tree-id="${id}"] > .relative .session-tree-select`;
	const graphNode = (id) =>
		`${activeView} .react-flow__node[data-id="${id}"] .session-graph-node-main`;
	const switchView = () => click(`${activeView} [aria-label="Node view"]`);
	const turn = (id, role, sessionId, sourceTurnId) => ({
		id,
		role,
		sessionId,
		sourceTurnId,
		content: `${id} user-visible text`,
		status: "complete",
		createdAt: "2026-10-10T00:00:00Z",
		reasoning: "PRIVATE REASONING",
		tools: [
			{
				id: "tool",
				name: "subagent",
				output: "PRIVATE OUTPUT",
				startedAt: "2026-10-10T00:00:00Z",
				status: "complete",
			},
		],
	});
	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null },
		});
		await server.listen();
		browser = new BrowserWindow({
			show: false,
			width: 1440,
			height: 960,
			useContentSize: true,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
				offscreen: true,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
		await browser.loadURL(url);
		await until(
			'Boolean(document.querySelector(".path-summary-select-button"))',
			"summary selection entry",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		const sessions = [
			{ id: "root", parentId: null, title: "Shared background", isRoot: true, status: "idle" },
			{
				id: "left",
				parentId: "root",
				forkedFromTurnId: "a1",
				title: "Left branch",
				isRoot: false,
				status: "idle",
			},
			{
				id: "right",
				parentId: "root",
				forkedFromTurnId: "a1",
				title: "Right branch",
				isRoot: false,
				status: "idle",
			},
		];
		const turns = [
			turn("u1", "user", "root"),
			turn("a1", "assistant", "root"),
			turn("left-u1", "user", "left", "u1"),
			turn("left-a1", "assistant", "left", "a1"),
			turn("u2", "user", "left"),
			turn("a2", "assistant", "left"),
			turn("u3", "user", "left"),
			turn("a3", "assistant", "left"),
			turn("right-u1", "user", "right", "u1"),
			turn("right-a1", "assistant", "right", "a1"),
			turn("r2", "user", "right"),
			turn("ra2", "assistant", "right"),
		];
		await host(
			`window.uiStore.setState(${JSON.stringify({ sessions, turns, activeSessionId: "left", visibleSessionId: "left", entities: [], diagrams: [] })})`,
		);
		await host('window.uiStore.getState().updateSettings({ language: "en", reduceMotion: true })');
		await until(
			`Boolean(document.querySelector(${JSON.stringify(listRow("u2"))}))`,
			"compressed left list row",
		);
		await host(`window.summaryRequests = []; window.summaryListeners = new Set(); window.summaryMode = "complete";
			window.rhyza = {
				isElectron: true,
				onAgentEvent: () => () => {},
				appStateLoad: () => localStorage.getItem("rhyza-workspace-v2"),
				onPathSummaryEvent: listener => { window.summaryListeners.add(listener); return () => window.summaryListeners.delete(listener); },
				generatePathSummary: request => {
					window.summaryRequests.push(request);
					window.summaryListeners.forEach(listener => listener({ requestId: request.requestId, phase: "summarizing", completed: 0, total: 2, level: 0 }));
					const usage = { input: 40, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.01 };
					if (window.summaryMode === "pending") return new Promise(resolve => { window.summaryResolve = resolve; });
					return Promise.resolve(window.summaryMode === "error" ? { error: "Test provider failure", usage }
						: { content: "# Consolidated findings\\n\\nShared background, distinct branch conclusions, and open questions.", usage });
				},
				cancelAuxiliaryRequest: () => { window.summaryResolve?.({ canceled: true, error: "Canceled", usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.005 } }); return Promise.resolve({ canceled: true }); }
			}; void 0;`);
		await click(".path-summary-select-button");
		assert.equal(await host('document.querySelector(".path-summary-generate").disabled'), true);
		await click(listRow("u2"));
		await click(listRow("r2"));
		assert.equal(
			await host('document.querySelectorAll(".session-node-button.is-summary-selected").length'),
			2,
		);
		assert.equal(
			await host("window.uiStore.getState().activeSessionId"),
			"left",
			"selection never navigates",
		);
		await switchView();
		await until(
			`Boolean(document.querySelector(${JSON.stringify(graphNode("u3"))}))`,
			"graph selection",
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(graphNode("u3"))}).getAttribute("aria-pressed")`,
			),
			"true",
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(graphNode("r2"))}).getAttribute("aria-pressed")`,
			),
			"true",
		);
		await click(graphNode("u2"));
		await switchView();
		await until(
			`document.querySelector(${JSON.stringify(listRow("u2"))})?.getAttribute("aria-checked") === "mixed"`,
			"partial compressed-row selection",
		);
		await click(listRow("u2"));
		assert.match(
			await host('document.querySelector(".path-summary-controls").textContent'),
			/1 selected/,
		);
		await click(listRow("u2"));
		await click(".path-summary-generate");
		await until('Boolean(document.querySelector(".path-summary-result"))', "successful summary");
		const captured = await host("window.summaryRequests[0]");
		assert.deepEqual(captured.paths.map((item) => item.id).sort(), ["r2", "u3"]);
		assert.equal(
			captured.rounds.flatMap((round) => round.messages).filter((message) => message.id === "a1")
				.length,
			1,
		);
		assert.doesNotMatch(JSON.stringify(captured), /PRIVATE|reasoning|tools|subagent/);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), "left");
		const summaryId = await host(
			"window.uiStore.getState().sessions.find(session => !['root','left','right'].includes(session.id)).id",
		);
		assert.equal(
			await host(
				`window.uiStore.getState().sessions.find(session => session.id === ${JSON.stringify(summaryId)}).parentId`,
			),
			null,
		);
		await switchView();
		await until(
			'document.querySelectorAll(".summary-source-edge").length === 2',
			"two dashed source edges",
		);
		assert.equal(
			await host(
				'getComputedStyle(document.querySelector(".summary-source-edge path")).strokeDasharray',
			),
			"6px, 5px",
		);
		for (const orientation of ["vertical", "horizontal"]) {
			const checked = await host(
				`document.querySelector('[aria-label="Vertical layout"]').getAttribute("aria-checked")`,
			);
			if ((checked === "true") !== (orientation === "vertical"))
				await click('[aria-label="Vertical layout"]');
			await until(
				'document.querySelectorAll(".summary-source-edge").length === 2',
				`${orientation} summary edges`,
			);
		}
		await switchView();
		await click(".path-summary-result button");
		await until('Boolean(document.querySelector(".path-summary-sources"))', "summary continuation");
		assert.equal(
			await host(
				`window.uiStore.getState().turns.filter(turn => turn.sessionId === ${JSON.stringify(summaryId)}).length`,
			),
			2,
		);
		await click(".path-summary-sources summary");
		assert.equal(await host('document.querySelectorAll(".path-summary-sources li").length'), 2);
		await click(".path-summary-sources li button");
		assert.notEqual(
			await host("window.uiStore.getState().activeSessionId"),
			summaryId,
			"sources navigate to the original path",
		);
		await click(".path-summary-select-button");
		await click(listRow("u2"));
		await host('window.summaryMode = "error"');
		await click(".path-summary-generate");
		await until(
			'document.querySelector(".path-summary-error")?.textContent.includes("Test provider failure")',
			"recoverable provider error",
		);
		assert.equal(
			await host("window.uiStore.getState().sessions.length"),
			4,
			"failure creates no empty summary",
		);
		assert.match(
			await host('document.querySelector(".path-summary-controls").textContent'),
			/1 selected/,
		);
		await host('window.summaryMode = "pending"');
		await click(".path-summary-generate");
		await until('Boolean(document.querySelector(".path-summary-progress"))', "pending summary");
		assert.equal(await host('document.querySelector(".path-summary-generate").disabled'), true);
		await click(".path-summary-cancel");
		await until(
			'document.querySelector(".path-summary-error")?.textContent.includes("Summary canceled")',
			"summary cancellation",
		);
		assert.equal(await host("window.summaryListeners.size"), 0, "progress listener cleanup");
		assert.equal(await host("window.uiStore.getState().sessions.length"), 4);
		await click(".path-summary-cancel");
		await host('window.summaryMode = "complete"');
		await host(
			`document.querySelector(${JSON.stringify(listRow("u2"))}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 180 }))`,
		);
		await until(
			'Boolean(document.querySelector(".session-status-menu"))',
			"single-node summary menu",
		);
		await host(
			`Array.from(document.querySelectorAll('.session-status-menu [role="menuitem"]')).find(button => button.textContent.includes("Summarize path")).click()`,
		);
		await until(
			'Boolean(document.querySelector(".path-summary-result"))',
			"single-node summary result",
		);
		assert.deepEqual(
			(await host("window.summaryRequests[window.summaryRequests.length - 1]")).paths.map(
				(item) => item.id,
			),
			["u3"],
			"list context menu uses the compressed node's last round",
		);
		await host(
			"window.uiStore.getState().deleteSession(window.uiStore.getState().sessions[window.uiStore.getState().sessions.length - 1].id)",
		);
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			for (const width of [1440, 1024, 768, 375]) {
				browser.setContentSize(width, 960);
				await sleep(60);
				if (width <= 900 && (await host('Boolean(document.querySelector(".sidebar-reopen"))')))
					await click(".sidebar-reopen");
				await click(".path-summary-select-button");
				const layout = await host(`(() => {
					const toolbar = document.querySelector(".path-summary-toolbar").getBoundingClientRect();
					return [...document.querySelectorAll(".path-summary-controls button")].map(button => {
						const rect = button.getBoundingClientRect();
						return rect.left >= toolbar.left && rect.right <= toolbar.right + 1 && button.scrollWidth <= button.clientWidth;
					});
				})()`);
				assert.ok(
					layout.every(Boolean),
					`${theme}/${width}: summary controls fit without clipping`,
				);
				await click(".path-summary-cancel");
			}
		}
		browser.setContentSize(1440, 960);
		await host(
			`delete window.rhyza; window.uiStore.getState().setActiveSession(${JSON.stringify(summaryId)})`,
		);
		await browser.loadURL(url);
		await until(
			'Boolean(document.querySelector(".path-summary-sources"))',
			"persistent summary after reload",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		assert.equal(await host("window.uiStore.getState().sessions.length"), 4);
		assert.equal(
			await host(
				"window.uiStore.getState().turns.find(turn => turn.pathSummary).pathSummary.sources.length",
			),
			2,
		);
		await host('window.uiStore.getState().deleteSession("root")');
		await click(".path-summary-sources summary");
		assert.equal(
			await host('document.querySelectorAll(".path-summary-sources button:disabled").length'),
			2,
		);
		assert.equal(
			await host("window.uiStore.getState().sessions.length"),
			1,
			"summary survives source deletion",
		);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), summaryId);
		assert.deepEqual(errors, [], "renderer errors");
		console.log(
			"Verified shared list/graph selection, canonical input, dashed provenance, continuation, failure/cancel recovery, two themes/four widths, reload and source deletion.",
		);
	}
	run()
		.then(async () => {
			browser?.destroy();
			await server?.close();
			app.exit(0);
		})
		.catch(async (error) => {
			console.error(error);
			browser?.destroy();
			await server?.close();
			app.exit(1);
		});
}
