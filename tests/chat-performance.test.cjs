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
		"typing isolates history, drafts send intact, and selection questions preserve reading",
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
	async function checkSelectionReading(action, mode) {
		const label = `${action}: ${mode}`;
		await host(`(() => {
			const store = chatTest.store;
			const turns = Array.from({ length: 8 }, (_, index) => ({
				id: "reading-turn-" + index, sessionId: "reading", role: index % 2 ? "assistant" : "user",
				content: index % 2
					? "## Answer " + index + "\\n\\n" + Array.from({ length: 20 }, (_, paragraph) =>
						"Passage " + index + ", paragraph " + paragraph + ". Keep reading this explanation without leaving the original thread."
					).join("\\n\\n")
					: "Reading question " + index,
				status: "complete", createdAt: "2026-09-20T00:00:00Z"
			}));
			store.setState({
				sessions: [{ id: "reading", parentId: null, title: "Reading", isRoot: true, status: "idle" }],
				turns, activeSessionId: "reading", visibleSessionId: "reading"
			});
			let selectedId = ${mode === "middle" || mode === "inherited" ? '"reading-turn-3"' : '"reading-turn-7"'};
			if (${JSON.stringify(mode)} === "branched") {
				store.getState().forkSession("reading-turn-7", { activate: false });
			}
			if (${JSON.stringify(mode)} === "inherited") {
				const fork = store.getState().forkSession("reading-turn-3", { activate: false });
				store.getState().setActiveSession(fork.originalSessionId);
				selectedId = store.getState().turns.find(turn =>
					turn.sessionId === fork.originalSessionId && turn.sourceTurnId === "reading-turn-1"
				).id;
			}
			chatTest.selectedId = selectedId;
			chatTest.selectedSourceId = store.getState().turns.find(turn => turn.id === selectedId).sourceTurnId ?? selectedId;
			chatTest.readingSessionId = store.getState().activeSessionId;
			chatTest.readingContents = store.getState().turns
				.filter(turn => turn.sessionId === chatTest.readingSessionId).map(turn => turn.content);
			chatTest.readingParagraph = () => {
				const turn = store.getState().turns.find(turn =>
					turn.sessionId === store.getState().activeSessionId
					&& (turn.sourceTurnId ?? turn.id) === chatTest.selectedSourceId
				);
				return document.getElementById("turn-" + turn.id).querySelectorAll(".markdown-body p")[8];
			};
			editDraft("");
		})()`);
		await frame();
		await host(`document.querySelectorAll('button[aria-label="Expand response"]')
			.forEach(button => button.click())`);
		await frame();
		if (mode === "middle") {
			await host('document.querySelector("#turn-reading-turn-1 .response-collapse").click()');
			await frame();
		}
		await host(`(() => {
			const container = document.querySelector(".chat-scroll");
			container.classList.add("is-positioning");
			container.scrollTop += chatTest.readingParagraph().getBoundingClientRect().top
				- container.getBoundingClientRect().top - 100;
			container.classList.remove("is-positioning");
		})()`);
		await frame();
		const before = await host(`(() => {
			const paragraph = chatTest.readingParagraph();
			chatTest.readingParagraphElement = paragraph;
			const range = document.createRange();
			range.selectNodeContents(paragraph);
			window.getSelection().removeAllRanges();
			window.getSelection().addRange(range);
			paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			return {
				scrollTop: document.querySelector(".chat-scroll").scrollTop,
				passageTop: paragraph.getBoundingClientRect().top,
				quote: paragraph.textContent,
				requestCount: chatTest.sent.length
			};
		})()`);
		await until('Boolean(document.querySelector(".text-selection-menu"))');
		if (action === "ask") {
			await host('document.querySelector(".text-selection-menu button").click()');
			await until('Boolean(document.querySelector(".text-selection-popover textarea"))');
			await host(`(() => {
				const textarea = document.querySelector(".text-selection-popover textarea");
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
					.set.call(textarea, "What does this passage mean?");
				textarea.dispatchEvent(new Event("input", { bubbles: true }));
			})()`);
			await frame();
			await host('document.querySelector(".text-selection-popover").requestSubmit()');
		} else {
			await host('document.querySelectorAll(".text-selection-menu button")[1].click()');
		}
		await until(`chatTest.sent.length === ${before.requestCount + 1}`);
		await frame();
		assert.equal(
			await host('document.querySelector(".chat-pane").textContent.includes("dump")'),
			false,
			`${label}: diagnostics must not appear above the composer`,
		);
		const assertReading = async (phase) => {
			const after = await host(`(() => {
				const state = chatTest.store.getState();
				const request = chatTest.sent.at(-1);
				const displayed = state.turns.filter(turn => turn.sessionId === state.activeSessionId);
				const focused = state.turns.find(turn => turn.id === chatTest.focus.getState().turnId);
				const question = state.turns.find(turn =>
					turn.sessionId === request.frontendSessionId && turn.quote?.turnId === chatTest.selectedId
				);
				return {
					scrollTop: document.querySelector(".chat-scroll").scrollTop,
					passageTop: chatTest.readingParagraph().getBoundingClientRect().top,
					retainedElement: chatTest.readingParagraph() === chatTest.readingParagraphElement,
					activeSessionId: state.activeSessionId,
					visibleSessionId: state.visibleSessionId,
					readingSessionId: chatTest.readingSessionId,
					requestSessionId: request.frontendSessionId,
					contents: displayed.slice(0, 8).map(turn => turn.content),
					readingContents: chatTest.readingContents,
					focusedSourceId: focused?.sourceTurnId ?? focused?.id,
					selectedSourceId: chatTest.selectedSourceId,
					quote: question?.quote?.text,
					question: question?.content,
					questionTitle: question?.summary
				};
			})()`);
			assert.ok(
				Math.abs(after.scrollTop - before.scrollTop) <= 1,
				`${label} ${phase}: scroll moved from ${before.scrollTop} to ${after.scrollTop}`,
			);
			assert.ok(
				Math.abs(after.passageTop - before.passageTop) <= 1,
				`${label} ${phase}: selected passage moved`,
			);
			assert.equal(after.retainedElement, true, `${label}: reading content must not remount`);
			assert.deepEqual(after.contents, after.readingContents, `${label}: original path retained`);
			assert.equal(
				after.focusedSourceId,
				after.selectedSourceId,
				`${label}: reading focus retained`,
			);
			assert.equal(after.visibleSessionId, after.activeSessionId);
			assert.equal(after.quote, before.quote);
			assert.equal(after.question, action === "ask" ? "What does this passage mean?" : "explain");
			if (action === "explain") {
				assert.ok(
					after.questionTitle.startsWith("Explain: Passage "),
					`${label}: subject in title`,
				);
			}
			if (mode === "leaf") {
				assert.equal(after.activeSessionId, after.requestSessionId);
			} else {
				assert.notEqual(
					after.activeSessionId,
					after.requestSessionId,
					`${label}: no branch switch`,
				);
			}
			if (mode !== "middle") assert.equal(after.activeSessionId, after.readingSessionId);
		};
		await assertReading("queued");
		await host(`chatTest.store.getState().updateTurn(chatTest.sent.at(-1).frontendTurnId, {
			content: "Streaming response.\\n\\n".repeat(40), status: "running"
		})`);
		await frame();
		await assertReading("streaming");
		await host(
			'chatTest.finishes.shift()({ ok: true, assistantText: "The passage is explained." })',
		);
		await until(
			'chatTest.store.getState().sessions.find(session => session.id === chatTest.sent.at(-1).frontendSessionId).status === "idle"',
		);
		await frame();
		await assertReading("complete");
		await host(`(() => {
			const request = chatTest.sent.at(-1);
			sessionStorage.setItem("rhyza-focus-turn", request.frontendTurnId);
			chatTest.store.getState().setActiveSession(request.frontendSessionId);
			window.dispatchEvent(new CustomEvent("rhyza:focus-turn", { detail: { turnId: request.frontendTurnId } }));
		})()`);
		await until(`(() => {
			const container = document.querySelector(".chat-scroll").getBoundingClientRect();
			const answer = document.getElementById("turn-" + chatTest.sent.at(-1).frontendTurnId)?.getBoundingClientRect();
			return answer && answer.top < container.bottom && answer.bottom > container.top;
		})()`);
		await frame();
	}
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
			forkDebugDump: async () => ({ path: "test-fork-dump" }),
			agentPrompt: (request) => { chatTest.sent.push(request); return new Promise(resolve => chatTest.finishes.push(resolve)); }
		};
		editDraft("First prompt", "insertFromPaste");`);
		await frame();
		await host('document.querySelector(".composer-send").click()');
		await until("chatTest.sent.length === 1");
		await frame();
		assert.equal(
			await host(`(() => {
				const container = document.querySelector(".chat-scroll");
				return Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) <= 1;
			})()`),
			true,
			"Ordinary sends still scroll to the new message",
		);
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
		for (const action of ["ask", "explain"]) {
			for (const mode of ["middle", "leaf", "branched", "inherited"]) {
				await checkSelectionReading(action, mode);
			}
		}
		await host(`(() => {
			const state = chatTest.store.getState();
			const turn = state.turns.find(turn => turn.sessionId === state.activeSessionId);
			const fork = state.forkSession(turn.id);
			if (chatTest.store.getState().activeSessionId !== fork.forkSessionId) {
				throw new Error("Explicit forks must still activate the new branch");
			}
		})()`);
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
