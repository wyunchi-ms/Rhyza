const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const test = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"HTML previews preserve interactive state and settle content-driven resizing",
		{ timeout: 120_000 },
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-preview-rendering-"));
			const env = {
				...process.env,
				RHYZA_PREVIEW_TEST_DATA: userData,
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
				const timeout = setTimeout(() => child.kill(), 110_000);
				try {
					const exitCode = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(exitCode, 0, output);
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
	app.setPath("userData", process.env.RHYZA_PREVIEW_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, description) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(50);
		}
		throw new Error(`Timed out: ${description}`);
	};
	const html = `<style>body { margin: 0; } main { height: 1800px; }</style>
		<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono">
		<main><input id="state" value="initial"></main>
		<script>parent.postMessage({ type: "preview-test-loaded" }, "*");</script>`;
	const content = [
		"```html-preview",
		JSON.stringify({ version: 1, path: "preview.html", title: "Interactive preview" }),
		"```",
		"",
		"[Entity](#knowledge/entity/example) [Diagram](#knowledge/diagram/example)",
	].join("\n");

	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		const page = `<!doctype html><html><body><div id="root" style="width: 900px"></div>
			<script type="module">
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { TurnMessage } from "/src/components/chat/TurnMessage.tsx";
				import "/src/index.css";
				const root = createRoot(document.getElementById("root"));
				let html = ${JSON.stringify(html).replace(/</g, "\\u003c")};
				let revision = 0;
				let status = "complete";
				window.loads = 0;
				window.addEventListener("message", (event) => {
					if (event.data?.type === "preview-test-loaded") window.loads++;
				});
				window.refreshPreview = (updates = {}) => {
					if ("html" in updates) html = updates.html;
					if ("status" in updates) status = updates.status;
					const currentRevision = ++revision;
					root.render(React.createElement(React.StrictMode, null,
						React.createElement(TurnMessage, {
							turn: {
								id: "preview-turn",
								sessionId: "session",
								role: "assistant",
								status,
								content: ${JSON.stringify(content)},
								htmlPreviews: html === null ? [] : [{ version: 1, path: "preview.html", html }],
								createdAt: "2026-01-01T00:00:00Z",
								completedAt: "2026-01-01T00:00:01Z"
							},
							sessionNodeId: "session",
							entities: [],
							relations: [],
							diagrams: [],
							onFork: () => {},
							canFork: false,
							onEntityClick: (id) => { window.lastClick = { kind: "entity", id, revision: currentRevision }; },
							onDiagramClick: (id) => { window.lastClick = { kind: "diagram", id, revision: currentRevision }; },
							onTextSelection: () => {},
							onOpenContextMenu: () => {},
							isFocused: revision % 2 === 0
						})
					));
					return revision;
				};
				window.refreshPreview();
			</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0 },
			plugins: [
				{
					name: "preview-rendering-regression",
					configureServer(vite) {
						vite.middlewares.use("/__preview-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__preview-test", page));
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
			width: 1100,
			height: 900,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
				offscreen: true,
			},
		});
		let fontWarnings = 0;
		browser.webContents.on("console-message", (event) => {
			if (
				event.message.includes("fonts.googleapis.com") &&
				event.message.includes("Content Security Policy")
			) {
				fontWarnings++;
			}
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__preview-test`);
		await until("window.loads === 1", "initial iframe load");
		await until(
			'document.querySelector("iframe")?.style.height === "1800px"',
			"initial fitted height",
		);
		await host('window.originalFrame = document.querySelector("iframe")');
		await browser.webContents.mainFrame.frames[0].executeJavaScript(
			'document.querySelector("#state").value = "preserved"',
		);
		assert.equal(fontWarnings, 1, "External font styles must remain blocked by CSP.");

		for (let iteration = 0; iteration < 6; iteration++) {
			const revision = await host(
				`window.refreshPreview({ status: "${iteration % 2 ? "complete" : "running"}" })`,
			);
			await until(
				`document.querySelector("article").getAttribute("aria-current") === ${JSON.stringify(revision % 2 === 0 ? "true" : null)}`,
				"updated parent props committed",
			);
			assert.equal(
				await host('window.originalFrame === document.querySelector("iframe")'),
				true,
				"Changing knowledge references, callbacks, attachment arrays or turn status must not remount the preview.",
			);
			await sleep(100);
			assert.equal(await host("window.loads"), 1, "The iframe document must not reload.");
			assert.equal(fontWarnings, 1, "Parent updates must not repeat blocked font requests.");
			assert.equal(
				await browser.webContents.mainFrame.frames[0].executeJavaScript(
					'document.querySelector("#state").value',
				),
				"preserved",
			);
			for (const kind of ["entity", "diagram"]) {
				await host(`document.querySelector('a[href="#knowledge/${kind}/example"]').click()`);
				assert.deepEqual(await host("window.lastClick"), { kind, id: "example", revision });
			}
		}

		const replacement = html
			.replace("1800px", "72px")
			.replace('value="initial"', 'value="replacement"');
		await host(`window.refreshPreview({ html: ${JSON.stringify(replacement)} })`);
		await until("window.loads === 2", "changed HTML loads once");
		await until('document.querySelector("iframe")?.style.height === "72px"', "changed HTML height");
		await host('window.refreshPreview({ html: null, status: "running" })');
		await until(
			'document.querySelector(".html-preview-state")?.textContent.includes("Preparing preview")',
			"pending attachment",
		);
		await host('window.refreshPreview({ status: "complete" })');
		await until(
			'document.querySelector(".html-preview-state")?.textContent.includes("was not attached")',
			"finalized missing attachment",
		);
		await host(`window.refreshPreview({ html: ${JSON.stringify(replacement)} })`);
		await until("window.loads === 3", "late attachment loads");

		const toolbarHtml = `<style>
			body {
				margin: 0;
				--toolbar-space: 41px;
			}
			.diagram {
				position: relative;
				padding-bottom: var(--toolbar-space);
			}
			main {
				height: 1000px;
			}
			.toolbar {
				position: absolute;
				bottom: 0;
				height: 41px;
			}
			.cards {
				height: 240px;
			}
			@media (max-width: 800px) {
				main {
					height: 1400px;
				}
			}
		</style>
		<div class="diagram"><main>Diagram</main><nav class="toolbar">Path / Map / Lens</nav></div>
		<div class="cards">Summary cards</div>
		<script>
			let pending = false;
			const layoutToolbar = () => {
				if (pending) return;
				pending = true;
				document.body.style.setProperty("--toolbar-space", "0px");
				let remaining = 5;
				const settle = () => {
					if (--remaining > 0) {
						requestAnimationFrame(settle);
						return;
					}
					document.body.style.setProperty("--toolbar-space", "41px");
					pending = false;
				};
				requestAnimationFrame(settle);
			};
			window.addEventListener("resize", layoutToolbar);
			layoutToolbar();
		</script>`;
		await host(`window.refreshPreview({ html: ${JSON.stringify(toolbarHtml)} })`);
		await until(
			'document.querySelector("iframe")?.srcdoc.includes("layoutToolbar")',
			"toolbar sizing fixture",
		);
		for (const width of [900, 780, 900]) {
			await host(`document.querySelector("#root").style.width = "${width}px"`);
			await sleep(750);
			const frame = browser.webContents.mainFrame.frames[0];
			const samples = await frame.executeJavaScript(`new Promise((resolve) => {
				const samples = [];
				const sample = () => {
					samples.push({
						height: innerHeight,
						toolbarTop: document.querySelector(".toolbar").getBoundingClientRect().top,
						cardsTop: document.querySelector(".cards").getBoundingClientRect().top,
						space: getComputedStyle(document.body).getPropertyValue("--toolbar-space"),
						overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
					});
					if (samples.length === 60) resolve(samples);
					else requestAnimationFrame(sample);
				};
				sample();
			})`);
			assert.equal(
				new Set(samples.map((sample) => JSON.stringify(sample))).size,
				1,
				`Toolbar and cards must stop moving at ${width}px: ${JSON.stringify(samples.slice(0, 12))}`,
			);
			assert.equal(samples[0].space, "41px");
			assert.equal(samples[0].height, width < 800 ? 1681 : 1281);
			assert.equal(samples[0].overflow, 0);
		}
		const frame = browser.webContents.mainFrame.frames[0];
		for (const [contentHeight, frameHeight] of [
			[480, 761],
			[1800, 2081],
		]) {
			await frame.executeJavaScript(
				`document.querySelector("main").style.height = "${contentHeight}px"`,
			);
			await until(
				`document.querySelector("iframe").style.height === "${frameHeight}px"`,
				`real content change fits ${frameHeight}px`,
			);
		}
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
