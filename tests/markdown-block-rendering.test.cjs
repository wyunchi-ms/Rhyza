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
		"Markdown fences render safely and expose source copying on hover and focus",
		{ timeout: 120_000 },
		async () => {
			const directory = await mkdtemp(path.join(os.tmpdir(), "rhyza-markdown-block-"));
			const env = {
				...process.env,
				RHYZA_MARKDOWN_BLOCK_TEST: directory,
				ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
			};
			delete env.ELECTRON_RUN_AS_NODE;
			try {
				const child = spawn(require("electron"), [__filename], { cwd: projectRoot, env });
				let output = "";
				child.stdout.on("data", (chunk) => {
					output += chunk;
				});
				child.stderr.on("data", (chunk) => {
					output += chunk;
				});
				const timeout = setTimeout(() => child.kill(), 110_000);
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
				await rm(directory, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_MARKDOWN_BLOCK_TEST);
	app.on("window-all-closed", () => {});
	let browser;
	let server;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const source = [
		"## Checklist",
		"",
		"- [ ] First task",
		"- [x] Done **item**",
		"",
		"| Task | Owner |",
		"| --- | --- |",
		"| Review | Team |",
		"",
		"Keep two spaces  ",
		"and `inline code`.",
		"",
		"```markdown",
		"## Literal nested example",
		"```",
		"",
		"<script>window.unsafeMarkdownExecuted = true</script>",
		"[Unsafe](javascript:alert(1))",
	].join("\n");
	const code = "const answer = 42;";
	const content = `# Answer\n\n\`\`\`\`markdown\n${source}\n\`\`\`\`\n\n\`\`\`js\n${code}\n\`\`\`\n\n\`\`\`MD\n### Alias heading\n\`\`\`\n\nNormal \`inline\` code.`;
	const preview = ".is-markdown-preview > .markdown-fence-preview";
	const copy = ".is-markdown-preview > .markdown-source-copy";

	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		const page = `<!doctype html><html><body style="margin: 0; padding: 32px"><div id="root"></div>
			<script type="module">
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { TurnMessage } from "/src/components/chat/TurnMessage.tsx";
				import { useAppStore } from "/src/store/index.ts";
				import "/src/index.css";
				useAppStore.getState().updateSettings({ language: "en" });
				window.uiStore = useAppStore;
				window.copyCalls = [];
				window.rejectCopy = false;
				Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
					writeText: async (value) => {
						if (window.rejectCopy) throw new Error("Synthetic clipboard failure");
						window.copyCalls.push(value);
					}
				}});
				const root = createRoot(document.getElementById("root"));
				let content = ${JSON.stringify(content).replace(/</g, "\\u003c")};
				window.renderMarkdown = (nextContent, status = "complete") => {
					content = nextContent ?? content;
					root.render(React.createElement(React.StrictMode, null, React.createElement(TurnMessage, {
						turn: {
							id: "markdown-turn", sessionId: "chat", role: "assistant", status, content,
							createdAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z"
						},
						sessionNodeId: "chat", entities: [], relations: [], diagrams: [],
						onFork: () => {}, canFork: false, onEntityClick: () => {},
						onDiagramClick: () => {}, onTextSelection: () => {}, onOpenContextMenu: () => {}, isFocused: false
					})));
				};
				window.renderMarkdown();
			</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
			plugins: [
				{
					name: "markdown-block-regression",
					configureServer(vite) {
						vite.middlewares.use("/__markdown-block-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__markdown-block-test", page));
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
			width: 1000,
			height: 900,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
				offscreen: true,
			},
		});
		await browser.loadURL(
			`http://127.0.0.1:${server.httpServer.address().port}/__markdown-block-test`,
		);
		await until(
			`document.querySelectorAll(${JSON.stringify(preview)}).length === 2`,
			"both Markdown language aliases",
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(preview)}).querySelector("h2").textContent`,
			),
			"Checklist",
		);
		assert.deepEqual(
			await host(
				`Array.from(document.querySelector(${JSON.stringify(preview)}).querySelectorAll('input[type="checkbox"]'), input => ({ checked: input.checked, disabled: input.disabled }))`,
			),
			[
				{ checked: false, disabled: true },
				{ checked: true, disabled: true },
			],
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(preview)}).querySelectorAll("table").length`,
			),
			1,
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(preview)}).querySelector("pre code").textContent.trim()`,
			),
			"## Literal nested example",
		);
		assert.equal(
			await host(
				'document.querySelector(".markdown-source-block:not(.is-markdown-preview) > pre > .language-js").textContent.trim()',
			),
			code,
		);
		assert.equal(
			await host('document.querySelectorAll("[data-markdown-heading-id]").length'),
			1,
			"snippet headings stay out of the answer outline",
		);
		assert.equal(await host("Boolean(window.unsafeMarkdownExecuted)"), false);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(preview)}).querySelectorAll("script, [href^='javascript:']").length`,
			),
			0,
		);
		await host(
			`window.previewNode = document.querySelector(${JSON.stringify(preview)}); window.copyButton = document.querySelector(${JSON.stringify(copy)})`,
		);

		browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
		await until(
			'getComputedStyle(window.copyButton).opacity === "0"',
			"copy hidden away from block",
		);
		const bounds = await host(
			"(() => { const rect = window.previewNode.getBoundingClientRect(); return { x: Math.ceil(rect.left + 8), y: Math.ceil(rect.top + 8) }; })()",
		);
		browser.webContents.sendInputEvent({ type: "mouseMove", ...bounds });
		await until('getComputedStyle(window.copyButton).opacity === "1"', "copy revealed on hover");
		await host("window.copyButton.click()");
		await until(
			'window.copyCalls.length === 1 && window.copyButton.textContent === "Copied"',
			"copied feedback",
		);
		assert.equal(
			await host("window.copyCalls[0]"),
			source,
			"copy preserves the exact block source, not rendered text",
		);
		await host("window.renderMarkdown()");
		await sleep(50);
		assert.equal(
			await host(`window.previewNode === document.querySelector(${JSON.stringify(preview)})`),
			true,
			"parent updates retain preview identity",
		);
		await until('window.copyButton.textContent === "Copy source"', "copied feedback resets");

		browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
		await host("window.copyButton.focus()");
		await until(
			'getComputedStyle(window.copyButton).opacity === "1"',
			"copy revealed on keyboard focus",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
		browser.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
		await until("window.copyCalls.length === 2", "keyboard copying");
		await host("window.rejectCopy = true; window.copyButton.click()");
		await until(
			'document.querySelector(".markdown-source-copy-error")?.textContent === "Copy failed. Try again."',
			"clipboard failure surfaced",
		);
		await host("window.rejectCopy = false; window.copyButton.click()");
		await until(
			'window.copyCalls.length === 3 && !document.querySelector(".markdown-source-copy-error")',
			"copy retry succeeds",
		);

		await host(
			'window.uiStore.getState().updateSettings({ language: "zh-CN" }); document.documentElement.dataset.theme = "dark"',
		);
		await until('window.copyButton.getAttribute("aria-label") === "复制源码"', "localized label");
		assert.equal(
			await host("getComputedStyle(window.previewNode).backgroundColor"),
			"rgb(32, 33, 36)",
		);
		browser.setSize(360, 900);
		await sleep(100);
		assert.equal(
			await host(
				"(() => { const rect = window.copyButton.getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth; })()",
			),
			true,
			"copy remains reachable at narrow widths",
		);
		const updated = source.replace("Checklist", "Updated checklist");
		await host(
			`window.renderMarkdown(${JSON.stringify(content.replace(source, updated))}, "running")`,
		);
		await until(
			`document.querySelector(${JSON.stringify(preview)}).querySelector("h2").textContent === "Updated checklist"`,
			"streaming Markdown refresh",
		);
		assert.equal(
			await host("window.copyButton.textContent"),
			"复制源码",
			"source changes do not retain stale copied state",
		);
		await host("window.copyButton.click()");
		await until("window.copyCalls.length === 4", "copy updated source");
		assert.equal(await host("window.copyCalls[3]"), updated);
	}

	run()
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		})
		.finally(async () => {
			if (browser && !browser.isDestroyed()) browser.destroy();
			if (server) await server.close();
			app.exit(process.exitCode || 0);
		});
}
