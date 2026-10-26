const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { spawn } = require("node:child_process");
	const test = require("node:test");
	test(
		"unread bells follow response visibility in both navigation views and themes",
		{ timeout: 120_000 },
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-unread-ui-"));
			const env = {
				...process.env,
				RHYZA_UNREAD_TEST_DATA: userData,
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
				const timer = setTimeout(() => child.kill(), 110_000);
				try {
					const code = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(code, 0, output);
				} finally {
					clearTimeout(timer);
				}
			} finally {
				await rm(userData, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_UNREAD_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const errors = [];
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(50);
		}
		const state = await host(`JSON.stringify({
			text: document.body.innerText.slice(0, 1000),
			graphNodes: document.querySelectorAll(".session-graph-node").length,
			ready: Boolean(window.store)
		})`);
		throw new Error(`Timed out: ${label}\n${state}\n${errors.join("\n")}`);
	};
	const bellCount = (container) =>
		`document.querySelectorAll("${container} .session-unread-indicator").length`;
	const luminance = (color) => {
		const [red, green, blue] = color.match(/\d+/g).map((value) => {
			const channel = Number(value) / 255;
			return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
		});
		return red * 0.2126 + green * 0.7152 + blue * 0.0722;
	};
	const page = `<!doctype html><html data-theme="light"><body>
		<div id="root"></div><script type="module">
		import React from "react";
		import { createRoot } from "react-dom/client";
		import { MemoryRouter } from "react-router-dom";
		import { useAppStore } from "/src/store/index.ts";
		import { PathSummaryProvider } from "/src/components/PathSummarySelection.tsx";
		import { SessionTree } from "/src/components/SessionTree.tsx";
		import { SessionGraph } from "/src/components/SessionGraph.tsx";
		import { TurnMessage } from "/src/components/chat/TurnMessage.tsx";
		import "/src/index.css";
		import "/src/theme.css";
		import "/src/interface.css";
		window.store = useAppStore;
		window.foreground = false;
		window.visible = true;
		Object.defineProperty(document, "hasFocus", { value: () => window.foreground });
		Object.defineProperty(document, "visibilityState", { get: () => window.visible ? "visible" : "hidden" });
		const sessions = ["reading", "background"].map(id => ({
			id, parentId: null, title: id, isRoot: true, status: "idle"
		}));
		const turn = (id, sessionId, role, status) => ({
			id, sessionId, role, status, content: id, createdAt: "2026-10-15T00:00:00Z"
		});
		useAppStore.setState({
			sessions, activeSessionId: "reading", visibleSessionId: "reading",
			turns: [
				turn("q1", "reading", "user", "complete"),
				turn("a1", "reading", "assistant", "complete"),
				turn("q2", "background", "user", "complete"),
				turn("a2", "background", "assistant", "running")
			],
			settings: { ...useAppStore.getState().settings, language: "en", reduceMotion: true }
		});
		const noop = () => {};
		function Fixture() {
			const turns = useAppStore(state => state.turns);
			const active = useAppStore(state => state.activeSessionId);
			return React.createElement("div", { style: { display: "grid", gridTemplateColumns: "300px 600px 500px", height: "700px" } },
				React.createElement("aside", { id: "tree" }, React.createElement(SessionTree)),
				React.createElement("aside", { id: "graph", style: { minHeight: 0 } }, React.createElement(SessionGraph)),
				React.createElement("main", { id: "reader", style: { overflow: "auto", height: "400px" } },
					React.createElement("div", { id: "spacer", style: { height: "800px" } }),
					...turns.filter(turn => turn.sessionId === active).map(turn =>
						React.createElement(TurnMessage, {
							key: turn.id, turn, sessionNodeId: active, entities: [], relations: [], diagrams: [],
							onFork: noop, canFork: false, onEntityClick: noop, onDiagramClick: noop,
							onTextSelection: noop, onOpenContextMenu: noop, isFocused: false
						}))
				)
			);
		}
		createRoot(document.getElementById("root")).render(
			React.createElement(MemoryRouter, null,
				React.createElement(PathSummaryProvider, null, React.createElement(Fixture))
			)
		);
		</script></body></html>`;

	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		server = await createServer({
			root: projectRoot,
			cacheDir: path.join(process.env.RHYZA_UNREAD_TEST_DATA, "vite-cache"),
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
			plugins: [
				{
					name: "unread-test",
					configureServer(vite) {
						vite.middlewares.use("/__unread-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__unread-test", page));
							} catch (error) {
								next(error);
							}
						});
					},
				},
			],
		});
		await server.listen();
		browser = new BrowserWindow({
			show: false,
			width: 1500,
			height: 850,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				offscreen: true,
				backgroundThrottling: false,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__unread-test`);
		await until('document.querySelectorAll(".session-graph-node").length === 2', "navigation");
		assert.equal(await host(bellCount("#tree")), 0, "running has no bell");
		await host('store.getState().updateTurn("a2", { status: "complete" })');
		await until(
			`${bellCount("#tree")} === 1 && ${bellCount("#graph")} === 1`,
			"completed background bell",
		);
		assert.equal(await host('store.getState().turns.find(t => t.id === "a2").unread'), true);
		for (const theme of ["light", "dark"]) {
			await host(`document.documentElement.dataset.theme = "${theme}"`);
			const appearance = await host(`(() => {
				const bell = document.querySelector(".session-unread-indicator");
				const style = getComputedStyle(bell);
				return {
					label: bell.getAttribute("aria-label"),
					color: style.color, background: style.backgroundColor,
					size: bell.getBoundingClientRect().width,
					animation: style.animationName,
					title: bell.title
				};
			})()`);
			assert.equal(appearance.label, "New response, unread");
			assert.equal(appearance.title, appearance.label);
			assert.equal(appearance.animation, "none");
			assert.equal(appearance.size, 20);
			assert.equal(appearance.color, theme === "light" ? "rgb(128, 84, 9)" : "rgb(243, 205, 112)");
			const ink = luminance(appearance.color);
			const surface = luminance(appearance.background);
			assert(
				(Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05) >= 3,
				`${theme} bell meets non-text contrast`,
			);
		}
		await host('store.getState().updateSettings({ language: "zh-CN" })');
		await until(
			'document.querySelector(".session-unread-indicator").getAttribute("aria-label") === "新回复，尚未阅读"',
			"localized label",
		);
		await host(
			'store.getState().setActiveSession("background"); window.foreground = true; window.dispatchEvent(new Event("focus"));',
		);
		await sleep(150);
		assert.equal(
			await host('store.getState().turns.find(t => t.id === "a2").unread'),
			true,
			"selection alone does not read offscreen output",
		);
		await host('window.foreground = false; document.getElementById("reader").scrollTop = 2000;');
		await sleep(150);
		assert.equal(
			await host('store.getState().turns.find(t => t.id === "a2").unread'),
			true,
			"background window does not read visible output",
		);
		await host(
			'window.foreground = true; window.visible = false; window.dispatchEvent(new Event("focus"));',
		);
		await sleep(80);
		assert.equal(
			await host('store.getState().turns.find(t => t.id === "a2").unread'),
			true,
			"hidden document does not mark read",
		);
		await host('window.visible = true; document.dispatchEvent(new Event("visibilitychange"));');
		await until(
			`${bellCount("#tree")} === 0 && ${bellCount("#graph")} === 0`,
			"foreground reading clears both bells",
		);

		await host(
			'store.getState().updateTurn("a2", { status: "running" }); store.getState().updateTurn("a2", { status: "complete" });',
		);
		await until(
			'store.getState().turns.find(t => t.id === "a2").unread === false',
			"visible completion is already seen",
		);
		await host(
			'document.querySelector("#turn-a2 .response-collapse").click(); store.getState().updateTurn("a2", { status: "running" }); store.getState().updateTurn("a2", { status: "complete" });',
		);
		await until(`${bellCount("#tree")} === 1`, "collapsed output remains unread");
		await sleep(100);
		assert.equal(await host('store.getState().turns.find(t => t.id === "a2").unread'), true);
		await host('document.querySelector("#turn-a2 .response-collapse").click()');
		await until(`${bellCount("#tree")} === 0`, "expanding reads the response");

		await host(
			'store.getState().updateTurn("a2", { status: "running" }); store.getState().updateTurn("a2", { status: "complete_with_unsynced_knowledge", summary: "Request failed" });',
		);
		await sleep(100);
		assert.equal(
			await host(bellCount("#tree")),
			0,
			"failure is not a successful unread completion",
		);
		await host(`window.foreground = false;
			const state = store.getState();
			state.updateTurn("a2", { status: "running", summary: "Working" });
			state.updateTurn("a2", { status: "complete" });
			state.addManualTurn({
				id: "q3", sessionId: "background", role: "user", content: "Another question",
				status: "complete", createdAt: "2026-10-15T00:01:00Z"
			});
			state.addManualTurn({
				id: "a3", sessionId: "background", role: "assistant", content: "Another response",
				status: "running", createdAt: "2026-10-15T00:01:01Z"
			});`);
		await until(
			`${bellCount("#tree")} === 0 && ${bellCount("#graph")} === 1`,
			"running state takes priority in a compressed list row",
		);
		await host('store.getState().updateTurn("a3", { status: "complete" })');
		await until(
			`${bellCount("#tree")} === 1 && ${bellCount("#graph")} === 2`,
			"compressed rows retain unread answers while graph rounds stay independent",
		);
		await host('store.getState().markTurnRead("a3")');
		await until(
			`${bellCount("#tree")} === 1 && ${bellCount("#graph")} === 1`,
			"an earlier unread round retains the list bell",
		);
		await host('store.getState().markTurnRead("a2")');
		await until(
			`${bellCount("#tree")} === 0 && ${bellCount("#graph")} === 0`,
			"reading every round clears the compressed row",
		);
		assert.deepEqual(errors, []);
	}
	run().then(
		async () => {
			browser?.destroy();
			await server?.close();
			app.exit(0);
		},
		async (error) => {
			console.error(error);
			browser?.destroy();
			await server?.close();
			app.exit(1);
		},
	);
}
