const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { test } = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"focused Markdown outlines navigate folded sections without disturbing rendering",
		{ timeout: 120_000 },
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-answer-outline-"));
			const env = {
				...process.env,
				RHYZA_OUTLINE_TEST_DATA: userData,
				ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
			};
			delete env.ELECTRON_RUN_AS_NODE;
			try {
				const child = spawn(require("electron"), [__filename], {
					cwd: projectRoot,
					env,
					windowsHide: true,
				});
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
				await rm(userData, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_OUTLINE_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const rendererErrors = [];
	const host = (code) => browser.webContents.executeJavaScript(code);
	const frame = () =>
		host("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await host(code)) return;
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		throw new Error(`Timed out: ${label}`);
	};
	const screenshot = async (name) => {
		if (!process.env.RHYZA_OUTLINE_SCREENSHOT_DIR) return;
		await writeFile(
			path.join(process.env.RHYZA_OUTLINE_SCREENSHOT_DIR, `${name}.png`),
			(await browser.webContents.capturePage()).toPNG(),
		);
	};
	async function focusAnswer(id) {
		await host(`(() => {
			const answer = document.getElementById("turn-" + ${JSON.stringify(id)});
			const container = document.querySelector(".chat-scroll");
			container.scrollTop += answer.getBoundingClientRect().top - container.getBoundingClientRect().top;
			outlineTest.focus.getState().setFocus("reading", ${JSON.stringify(id)});
		})()`);
		await frame();
	}
	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		const prose =
			"Read this part of the answer while keeping its structure and context.\n\n".repeat(12);
		const markdown = [
			"# Overview",
			prose,
			"## Details with *emphasis*",
			prose,
			"### Nested explanation",
			"needle-in-folded-section\n\n" + prose,
			"## Repeated",
			prose,
			"## Repeated",
			prose,
			"## [Reference](https://example.com)",
			prose,
			"Setext heading\n--------------",
			prose,
			"```md\n# Not a heading\n```",
		].join("\n\n");
		const page = `<!doctype html><html data-theme="light"><body><div id="root" style="height:100dvh"></div>
			<script type="module">
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { MemoryRouter } from "react-router-dom";
				import { ChatPane } from "/src/components/ChatPane.tsx";
				import { useAppStore } from "/src/store/index.ts";
				import { useConversationFocus } from "/src/store/conversationFocus.ts";
				import "/src/index.css";
				await useAppStore.persist.rehydrate();
				const timestamp = "2026-09-21T00:00:00Z";
				const turn = (id, role, content) => ({
					id, sessionId: "reading", role, content, status: "complete", createdAt: timestamp, completedAt: timestamp
				});
				useAppStore.setState({
					sessions: [{ id: "reading", parentId: null, title: "Reading", isRoot: true, status: "idle" }],
					activeSessionId: "reading", visibleSessionId: "reading",
					settings: { ...useAppStore.getState().settings, autoExtract: false, reduceMotion: true },
					entities: [], relations: [], diagrams: [],
					turns: [
						turn("question-one", "user", "# User heading"),
						turn("answer-one", "assistant", ${JSON.stringify(markdown)}),
						turn("question-two", "user", "Another question"),
						turn("answer-two", "assistant", ${JSON.stringify(prose)}),
						turn("question-three", "user", "A final topic"),
						turn("answer-three", "assistant", ${JSON.stringify("## Other topic\n\n" + prose)})
					]
				});
				window.outlineTest = { store: useAppStore, focus: useConversationFocus };
				window.outlineHeading = (text) => [...document.querySelectorAll("#turn-answer-one [data-markdown-heading-id]")]
					.find(heading => heading.dataset.markdownHeadingText === text);
				window.outlineButton = (text) => [...document.querySelectorAll(".answer-outline-list button")]
					.find(button => button.textContent === text);
				createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode, null,
					React.createElement(MemoryRouter, null, React.createElement(ChatPane))));
			</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
			plugins: [
				{
					name: "answer-outline-test",
					configureServer(vite) {
						vite.middlewares.use("/__outline-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__outline-test", page));
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
			width: 1900,
			height: 980,
			useContentSize: true,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				offscreen: true,
				backgroundThrottling: false,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") rendererErrors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__outline-test`);
		await until('document.querySelectorAll(".chat-turn").length === 6', "chat");
		await focusAnswer("answer-one");
		await until(
			'document.querySelector(".answer-outline")?.dataset.outlineTurnId === "answer-one"',
			"focused answer outline",
		);
		assert.deepEqual(
			await host(
				'[...document.querySelectorAll(".answer-outline-list button")].map(button => button.textContent)',
			),
			[
				"Overview",
				"Details with emphasis",
				"Nested explanation",
				"Repeated",
				"Repeated",
				"Reference",
				"Setext heading",
			],
		);
		const geometry = await host(`(() => {
			const outline = document.querySelector(".answer-outline").getBoundingClientRect();
			const answer = document.querySelector("#turn-answer-one").getBoundingClientRect();
			const composer = document.querySelector(".composer-shell").getBoundingClientRect();
			return { outlineLeft: outline.left, outlineRight: outline.right, answerLeft: answer.left, width: answer.width, outlineBottom: outline.bottom, composerTop: composer.top };
		})()`);
		assert.ok(geometry.outlineLeft >= 0);
		assert.ok(geometry.outlineRight < geometry.answerLeft);
		assert.ok(geometry.outlineBottom <= geometry.composerTop);
		assert.equal(geometry.width, 960, "the outline must not squeeze the transcript");
		assert.equal(
			await host(
				'document.querySelectorAll("#turn-question-one [data-markdown-heading-id]").length',
			),
			0,
		);
		assert.equal(
			await host(
				'new Set([...document.querySelectorAll("#turn-answer-one [data-markdown-heading-id]")].map(heading => heading.id)).size',
			),
			7,
		);
		for (const theme of ["light", "dark"]) {
			await host(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
			await frame();
			const contrast = await host(`(() => {
				const values = color => color.match(/[\\d.]+/g)?.map(Number) ?? [];
				const luminance = color => values(color).slice(0, 3).map(value => value / 255)
					.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
					.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
				return [...document.querySelectorAll(".answer-outline-title, .answer-outline-list button")].map(element => {
					let background = element;
					while (background.parentElement && (getComputedStyle(background).backgroundColor === "transparent"
						|| values(getComputedStyle(background).backgroundColor)[3] === 0)) background = background.parentElement;
					const foreground = luminance(getComputedStyle(element).color);
					const behind = luminance(getComputedStyle(background).backgroundColor);
					return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
				});
			})()`);
			assert.ok(
				contrast.every((ratio) => ratio >= 4.5),
				`${theme}: outline text contrast`,
			);
			await screenshot(`${theme}-answer-outline`);
		}
		await host(`window.originalNestedHeading = outlineHeading("Nested explanation");
			outlineHeading("Details with emphasis").querySelector("button[aria-expanded]").click()`);
		await frame();
		assert.equal(
			await host('Boolean(outlineHeading("Nested explanation").closest("[hidden]"))'),
			true,
		);
		assert.equal(
			await host('document.querySelectorAll(".answer-outline-list button").length'),
			7,
			"folded headings remain in the directory",
		);
		await host('outlineButton("Nested explanation").click()');
		await until(
			'outlineHeading("Nested explanation").getClientRects().length > 0',
			"nested section revealed",
		);
		await frame();
		assert.equal(
			await host('outlineHeading("Nested explanation") === originalNestedHeading'),
			true,
		);
		assert.equal(
			await host(
				'outlineHeading("Details with emphasis").querySelector("button[aria-expanded]").getAttribute("aria-expanded")',
			),
			"true",
		);
		assert.equal(
			await host('outlineButton("Nested explanation").getAttribute("aria-current")'),
			"location",
		);
		assert.ok(
			await host(`(() => {
			const heading = outlineHeading("Nested explanation").getBoundingClientRect();
			const container = document.querySelector(".chat-scroll").getBoundingClientRect();
			return heading.top >= container.top && heading.bottom <= container.bottom;
		})()`),
			"outline navigation lands on the heading",
		);

		await host(
			'outlineHeading("Details with emphasis").querySelector("button[aria-expanded]").click()',
		);
		await frame();
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))',
		);
		await until('Boolean(document.querySelector(".conversation-find input"))', "conversation find");
		await host(`(() => {
			const input = document.querySelector(".conversation-find input");
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "needle-in-folded-section");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await until(
			'outlineHeading("Nested explanation").getClientRects().length > 0',
			"search reveals folded content",
		);
		assert.equal(
			await host('document.querySelector(".conversation-find-count").textContent'),
			"1/1",
		);
		await host(
			'document.querySelector(".conversation-find input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
		);
		await frame();

		await host(`outlineHeading("Details with emphasis").querySelector("button[aria-expanded]").click();
			const turn = outlineTest.store.getState().turns.find(turn => turn.id === "answer-one");
			outlineTest.store.getState().updateTurn(turn.id, { content: turn.content + "\\n\\n## Streaming addition\\n\\nMore text.", status: "running" });`);
		await frame();
		await until('Boolean(outlineButton("Streaming addition"))', "streamed heading updates outline");
		assert.equal(
			await host('Boolean(outlineHeading("Nested explanation").closest("[hidden]"))'),
			true,
			"streaming must retain folded sections",
		);
		assert.equal(
			await host('outlineHeading("Nested explanation") === originalNestedHeading'),
			true,
		);
		await host('outlineTest.store.getState().updateTurn("answer-one", { status: "complete" })');
		await focusAnswer("answer-three");
		await until(
			'document.querySelector(".answer-outline")?.dataset.outlineTurnId === "answer-three"',
			"outline follows answer focus",
		);
		assert.equal(
			await host('document.querySelector(".answer-outline-list").textContent'),
			"Other topic",
		);
		await focusAnswer("answer-two");
		await until('!document.querySelector(".answer-outline")', "plain responses have no outline");
		await focusAnswer("answer-one");
		for (const width of [1200, 768, 375]) {
			browser.setContentSize(width, 980);
			await frame();
			await until('!document.querySelector(".answer-outline")', `outline hides at ${width}px`);
			assert.equal(await host("document.documentElement.scrollWidth > innerWidth"), false);
			assert.ok(
				await host(
					'document.querySelectorAll("#turn-answer-one button[aria-expanded]").length > 0',
				),
				"heading folding remains available",
			);
		}
		browser.setContentSize(1900, 980);
		await frame();
		await focusAnswer("answer-one");
		await until(
			'Boolean(document.querySelector(".answer-outline"))',
			"outline returns in the gutter",
		);
		await screenshot("folded-answer-outline");
		assert.deepEqual(rendererErrors, [], "no renderer errors");
	}
	run().then(
		async () => {
			browser?.destroy();
			await server?.close();
			app.exit(0);
		},
		async (error) => {
			console.error(error);
			if (browser) await screenshot("answer-outline-failure");
			browser?.destroy();
			await server?.close();
			app.exit(1);
		},
	);
}
