const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mkdtemp, rm } = require("node:fs/promises");
const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { test } = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"typing isolates history, unchanged turns skip Markdown, and drafts send intact",
		{ timeout: 120_000 },
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-chat-performance-"));
			const env = {
				...process.env,
				RHYZA_CHAT_TEST_DATA: userData,
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
					console.log(output.trim());
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
	app.setPath("userData", process.env.RHYZA_CHAT_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const host = (code) => browser.webContents.executeJavaScript(code);
	const frame = () =>
		host(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))))",
		);
	const until = async (code) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await host(code)) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Timed out: ${code}`);
	};
	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules/vite/dist/node/index.js")).href
		);
		const page = `<!doctype html><html><body><div id="root" style="height:900px"></div>
		<script type="module">
			import React from "react";
			import { createRoot } from "react-dom/client";
			import { MemoryRouter } from "react-router-dom";
			import { ChatPane } from "/src/components/ChatPane.tsx";
			import { useAppStore } from "/src/store/index.ts";
			import { useConversationFocus } from "/src/store/conversationFocus.ts";
			import { drainPerformanceTimings } from "/src/utils/performanceMarks.ts";
			import "/src/index.css";
			await useAppStore.persist.rehydrate();
			const timestamp = "2026-09-20T00:00:00Z";
			useAppStore.setState({
				sessions: [{ id: "test", parentId: null, title: "Performance", isRoot: true, status: "idle" }],
				activeSessionId: "test", entities: [], relations: [], diagrams: [],
				settings: { ...useAppStore.getState().settings, autoExtract: false },
				turns: Array.from({ length: 42 }, (_, index) => ({
					id: "turn-" + index, sessionId: "test", role: index % 2 ? "assistant" : "user",
					content: index % 2 ? "## Answer\\n\\n" + "**Important**: a detailed answer with $x^2$.\\n\\n".repeat(15) : "Question " + index,
					status: "complete", createdAt: timestamp, completedAt: timestamp
				}))
			});
			window.chatTest = { store: useAppStore, focus: useConversationFocus, drain: drainPerformanceTimings, sent: [], finishes: [] };
			createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode, null,
				React.createElement(MemoryRouter, null, React.createElement(ChatPane))));
			window.editDraft = (value, inputType = "insertText", isComposing = false) => {
				const textarea = document.querySelector(".composer-input");
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
				textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, isComposing }));
			};
		</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
			plugins: [
				{
					name: "chat-performance-test",
					configureServer(vite) {
						vite.middlewares.use("/__chat-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__chat-test", page));
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
				offscreen: true,
				backgroundThrottling: false,
			},
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__chat-test`);
		await until('document.querySelectorAll(".chat-turn").length === 42');
		await frame();
		await host('document.querySelector(".composer-input").focus(); chatTest.drain()');
		for (let index = 1; index <= 28; index++) {
			await host(
				`editDraft(${JSON.stringify("输入测试".repeat(7).slice(0, index))}, "insertCompositionText", true)`,
			);
			await frame();
		}
		const typing = await host("chatTest.drain()");
		assert.equal(typing["composer-input-ime-handler"].count, 28);
		assert.equal(typing["chat-render-commit"], undefined, "Typing must not rerender ChatPane");
		assert.equal(
			typing["chat-markdown-render-commit"],
			undefined,
			"Typing must not reparse history",
		);
		assert.equal(
			typing["state-persist-serialize-dispatch"],
			undefined,
			"Typing must not persist the workspace",
		);
		await host("chatTest.store.getState().toggleRightPane()");
		await frame();
		const uiOnly = await host("chatTest.drain()");
		assert.equal(
			uiOnly["state-persist-serialize-dispatch"],
			undefined,
			"UI-only state must not serialize",
		);
		assert.equal(
			uiOnly["chat-turn-render-commit"],
			undefined,
			"Stable turn props must skip history",
		);
		await host('chatTest.focus.getState().setFocus("test", "turn-40")');
		await frame();
		const focus = await host("chatTest.drain()");
		assert.equal(
			focus["chat-markdown-render-commit"],
			undefined,
			"Focus styling must not reparse Markdown",
		);
		await host('chatTest.store.getState().updateTurn("turn-41", { content: "Updated response" })');
		await frame();
		const stream = await host("chatTest.drain()");
		assert.equal(
			stream["chat-markdown-render-commit"].count,
			1,
			"Only the changed response should render Markdown",
		);
		assert.ok(
			stream["state-persist-serialize-dispatch"],
			"Real data changes must persist immediately",
		);
		assert.equal(
			await host(
				'document.querySelector("#turn-turn-41").textContent.includes("Updated response")',
			),
			true,
		);
		// IME Enter confirms text without sending it.
		await host(
			'document.querySelector(".composer-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))',
		);
		await frame();
		assert.equal(await host("chatTest.store.getState().turns.length"), 42);
		await host('editDraft("@Per")');
		await frame();
		await host(
			'document.querySelector(".composer-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))',
		);
		await frame();
		assert.equal(
			await host("Boolean(document.querySelector('button[aria-label=\"Remove Performance\"]'))"),
			true,
		);
		await host("document.querySelector('button[aria-label=\"Remove Performance\"]').click()");
		await host(`const files = new DataTransfer();
			files.items.add(new File([new Uint8Array([137, 80, 78, 71])], "test.png", { type: "image/png" }));
			const upload = document.querySelector('input[type="file"]');
			upload.files = files.files;
			upload.dispatchEvent(new Event("change", { bubbles: true }));`);
		await until('document.querySelectorAll(".composer-attachment").length === 1');
		await host(`window.rhyza = {
			isElectron: true,
			sourceSearch: async () => [],
			agentPrompt: (request) => { chatTest.sent.push(request); return new Promise(resolve => chatTest.finishes.push(resolve)); }
		};
		editDraft("First prompt", "insertFromPaste");`);
		await frame();
		await host('document.querySelector(".composer-send").click()');
		await until("chatTest.sent.length === 1");
		await frame();
		assert.equal(await host("chatTest.sent[0].images[0].mimeType"), "image/png");
		assert.equal(await host("chatTest.sent[0].images[0].data"), "iVBORw==");
		assert.equal(await host('document.querySelectorAll(".composer-attachment").length'), 0);
		assert.equal(await host('document.querySelector(".composer-input").value'), "");
		await host('editDraft("Second prompt")');
		await frame();
		await host('document.querySelector(".composer-send").click()');
		await frame();
		await host(
			'editDraft("Keep this unsent draft"); chatTest.finishes.shift()({ ok: true, assistantText: "First answer" })',
		);
		await until("chatTest.sent.length === 2");
		assert.equal(await host("chatTest.sent[1].images.length"), 0);
		assert.deepEqual(await host("chatTest.sent.map(request => request.prompt)"), [
			"First prompt",
			"Second prompt",
		]);
		await host('chatTest.finishes.shift()({ ok: true, assistantText: "Second answer" })');
		await until('chatTest.store.getState().sessions[0].status === "idle"');
		assert.equal(
			await host('document.querySelector(".composer-input").value'),
			"Keep this unsent draft",
		);
		console.log(
			JSON.stringify({
				typingEvents: 28,
				historyCommitsDuringTyping: 0,
				markdownCommitsDuringTyping: 0,
				inputCommitMaxMs: typing["composer-input-ime-to-commit"]?.maxMs,
				updatedResponseMarkdownCommits: stream["chat-markdown-render-commit"].count,
			}),
		);
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
