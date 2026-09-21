const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { spawn } = require("node:child_process");
	const test = require("node:test");

	test(
		"all product routes retain readable, responsive light and dark interfaces",
		{
			timeout: 180_000,
		},
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-ui-test-"));
			const env = {
				...process.env,
				RHYZA_UI_TEST_DATA: userData,
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
	app.setPath("userData", process.env.RHYZA_UI_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const rendererErrors = [];
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(50);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const settle = async () => {
		await host(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await sleep(40);
	};
	const routes = [
		["/", ".chat-topbar h1"],
		["/knowledge", ".knowledge-page-header h1"],
		["/sources", ".page-title"],
		["/changes", ".page-title"],
		["/settings", ".page-title"],
	];

	async function navigate(route, heading) {
		await host(`location.hash = ${JSON.stringify(`#${route}`)}`);
		await until(`Boolean(document.querySelector(${JSON.stringify(heading)}))`, `route ${route}`);
		await settle();
	}

	async function setAppearance(theme, extra = {}) {
		await host(`window.uiStore.getState().updateSettings(${JSON.stringify({ theme, ...extra })})`);
		await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme);
		await settle();
	}

	async function setInput(selector, value) {
		await host(`(() => {
			const input = document.querySelector(${JSON.stringify(selector)});
			const prototype = input instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await settle();
	}

	async function screenshot(name) {
		if (!process.env.RHYZA_UI_SCREENSHOT_DIR) return;
		await sleep(180);
		await writeFile(
			path.join(process.env.RHYZA_UI_SCREENSHOT_DIR, `${name}.png`),
			(await browser.webContents.capturePage()).toPNG(),
		);
	}

	async function checkLayout(label) {
		const result = await host(`(() => {
			const selectors = [
				".chat-topbar", ".chat-composer", ".page-header", ".knowledge-page-header",
				".page-title", ".chat-empty", ".settings-sections"
			];
			const outside = selectors.flatMap(selector => [...document.querySelectorAll(selector)]
				.filter(element => {
					const rect = element.getBoundingClientRect();
					return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
				}).map(element => element.className));
			const hiddenHeading = [...document.querySelectorAll("main h1")]
				.some(element => element.getClientRects().length === 0
					|| element.closest("[hidden]"));
			const reopen = document.querySelector(".sidebar-reopen")?.getBoundingClientRect();
			const obstructedHeading = reopen && [...document.querySelectorAll(
				"main h1, .knowledge-page-header > div:first-child"
			)].some(element => {
				const rect = element.getBoundingClientRect();
				return rect.left < reopen.right && rect.right > reopen.left
					&& rect.top < reopen.bottom && rect.bottom > reopen.top;
			});
			const sidebar = document.querySelector(".app-sidebar");
			const sidebarRect = sidebar.getBoundingClientRect();
			const clippedSidebarControls = sidebar.inert ? [] : [...sidebar.querySelectorAll(
				".session-tree-header button, .sidebar-header-navigation a"
			)].filter(element => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && (rect.left < sidebarRect.left || rect.right > sidebarRect.right);
			}).map(element => element.getAttribute("aria-label"));
			return {
				outside,
				hiddenHeading,
				obstructedHeading: Boolean(obstructedHeading),
				clippedSidebarControls,
				overflow: document.documentElement.scrollWidth > innerWidth + 1,
				mainWidth: document.querySelector("main").getBoundingClientRect().width
			};
		})()`);
		assert.deepEqual(result.outside, [], `${label}: clipped content`);
		assert.equal(result.hiddenHeading, false, `${label}: hidden page heading`);
		assert.equal(result.obstructedHeading, false, `${label}: sidebar opener overlaps heading`);
		assert.deepEqual(result.clippedSidebarControls, [], `${label}: clipped sidebar controls`);
		assert.equal(result.overflow, false, `${label}: horizontal document overflow`);
		assert.ok(result.mainWidth > 200, `${label}: unusably narrow main content`);
	}

	async function checkContrast(label) {
		const contrasts = await host(`(() => {
			const rgb = color => color.match(/[\\d.]+/g)?.map(Number) ?? [];
			const luminance = color => rgb(color).slice(0, 3)
				.map(value => value / 255)
				.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
				.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
			return [...document.querySelectorAll(
				".page-title, .page-subtitle, .chat-topbar h1, .chat-empty p, .chat-empty-hint, " +
				".settings-page section > h2, .command-button:not(:disabled), " +
				".session-filter-label, .session-filter-hint, .session-filter-count, " +
				".text-selection-actions button[type=submit]:not(:disabled), .analyze-context-button"
			)].filter(element => element.getBoundingClientRect().width > 0).map(element => {
				let background = element;
				while (background.parentElement && (
					getComputedStyle(background).backgroundColor === "transparent" ||
					rgb(getComputedStyle(background).backgroundColor)[3] === 0
				)) background = background.parentElement;
				const foreground = luminance(getComputedStyle(element).color);
				const behind = luminance(getComputedStyle(background).backgroundColor);
				return {
					text: element.textContent.trim().slice(0, 55),
					ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05)
				};
			});
		})()`);
		for (const { text, ratio } of contrasts) {
			assert.ok(ratio >= 4.5, `${label}: "${text}" contrast ${ratio.toFixed(2)} < 4.5`);
		}
	}

	async function seedContent() {
		const timestamp = "2026-09-18T10:24:00.000Z";
		await host(
			`window.uiStore.setState(${JSON.stringify({
				sessions: [
					{
						id: "ui-session",
						parentId: null,
						title: "Understanding conversation branches",
						isRoot: true,
						status: "idle",
					},
				],
				activeSessionId: "ui-session",
				visibleSessionId: "ui-session",
				turns: [
					{
						id: "ui-question",
						sessionId: "ui-session",
						role: "user",
						status: "complete",
						content: "How do branches preserve the context of a conversation?",
						createdAt: timestamp,
					},
					{
						id: "ui-answer",
						sessionId: "ui-session",
						role: "assistant",
						status: "complete",
						content:
							"## A separate thread, shared context\n\nA branch keeps the discussion up to its starting point. New messages stay in the new thread.\n\n- Revisit the original path at any time.\n- Keep related ideas together.\n- Save durable concepts to the knowledge base.",
						createdAt: timestamp,
						completedAt: timestamp,
					},
				],
				entities: [
					{
						id: "ui-entity",
						name: "Conversation branches",
						aliases: [],
						type: "concept",
						summary: "Independent paths that retain their shared conversation context.",
						content:
							"A branch preserves prior context while allowing an idea to develop independently.",
						confidence: "confirmed",
						sourceScope: "workspace",
						sourceRefs: [],
						version: 1,
						updatedAt: timestamp,
					},
				],
				sources: [
					{
						id: "ui-source",
						name: "Workspace handbook",
						path: "C:\\demo\\workspace-handbook",
						fileCount: 23,
						status: "indexed",
						type: "docs",
						indexedAt: timestamp,
					},
				],
				changesets: [
					{
						id: "ui-change",
						title: "Document conversation branches",
						timestamp,
						sessionId: "ui-session",
						summary: "Added a concept from the conversation.",
						actor: "agent",
						status: "committed",
						operations: [
							{
								kind: "entity",
								action: "create",
								objectId: "ui-entity",
								label: "Conversation branches",
								after: { name: "Conversation branches", type: "concept" },
							},
						],
					},
				],
				selectedEntityId: "ui-entity",
			})})`,
		);
		await settle();
	}

	async function checkInteractions() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		assert.equal(
			await host('document.querySelector(".app-sidebar-brand").textContent.trim()'),
			"",
			"sidebar titlebar only renders icon controls",
		);
		assert.deepEqual(
			await host(`[...document.querySelector(".app-sidebar-brand").children]
				.map(element => element.matches('[aria-label="Close sidebar"]')
					? "toggle"
					: element.className)`),
			["toggle", "sidebar-header-actions"],
			"sidebar toggle stays at the top-left before the navigation actions",
		);
		assert.equal(
			await host(
				'document.querySelectorAll(".sidebar-header-actions .sidebar-header-navigation a").length',
			),
			4,
			"search and the four icon-only destinations share one titlebar row",
		);
		assert.equal(
			await host('document.querySelectorAll(".assistant-body .markdown-body li").length'),
			3,
			"assistant Markdown keeps its list structure",
		);
		const nodeViewSwitch = '.sidebar-view-content:not([hidden]) [aria-label="Node view"]';
		await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
		await until('Boolean(document.querySelector(".session-graph-node"))', "conversation graph");
		await sleep(400);
		await host('window.graphNodeRef = document.querySelector(".session-graph-node")');
		await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
		await settle();
		assert.equal(
			await host('document.querySelector(".session-graph-node") === window.graphNodeRef'),
			true,
			"switching to the chat list retains the mounted graph",
		);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 260',
			"chat list sidebar width",
		);
		for (let step = 0; step < 3; step++) {
			await host(`document.querySelector('[aria-label="Resize navigation sidebar"]')
				.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }))`);
			await settle();
		}
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 200',
			"sidebar resize animation",
		);
		assert.equal(
			await host('document.querySelector(".app-sidebar").getBoundingClientRect().width'),
			200,
			"sidebar can still be resized to its minimum width",
		);
		await checkLayout("minimum sidebar width with populated conversation");
		await host(`document.querySelector('[aria-label="Resize navigation sidebar"]')
			.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
		await settle();
		browser.setContentSize(1024, 960);
		await settle();
		await host("document.querySelector('[aria-label=\"Close sidebar\"]').click()");
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 0',
			"collapsed desktop sidebar",
		);
		for (const [route, heading] of routes) {
			await navigate(route, heading);
			await checkLayout(`collapsed desktop sidebar ${route}`);
		}
		await host('document.querySelector(".sidebar-reopen").click()');
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await setInput(".composer-input", "Keep this draft while opening the model menu");
		assert.equal(await host('document.querySelector(".composer-send").disabled'), false);
		await host('document.querySelector(".composer-runtime-trigger").click()');
		await until('Boolean(document.querySelector(".composer-runtime-menu"))', "provider menu");
		assert.equal(
			await host('document.querySelector(".composer-input").value'),
			"Keep this draft while opening the model menu",
		);
		await host('document.querySelector(".composer-runtime-trigger").click()');
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true }))',
		);
		await until(
			'document.activeElement?.getAttribute("aria-label") === "Search chats"',
			"search focus",
		);
		await setInput('[aria-label="Search chats"]', "branches");
		assert.ok(
			(await host('document.querySelectorAll(".global-search-results [role=option]").length')) > 0,
		);
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
		);
		await until('!document.querySelector(".global-search-dialog")', "search dismissal");

		browser.setContentSize(375, 812);
		await settle();
		assert.equal(await host('document.querySelector(".app-sidebar").inert'), true);
		await host('document.querySelector(".sidebar-reopen").click()');
		await until('!document.querySelector(".app-sidebar").inert', "compact sidebar opening");
		await host(
			'document.querySelector(".sidebar-header-navigation a[href=\\"#/sources\\"]").click()',
		);
		await until(
			'document.querySelector(".app-sidebar").inert',
			"navigation closes compact sidebar",
		);
		assert.equal(await host("location.hash"), "#/sources");
		await host('document.querySelector(".sidebar-reopen").click()');
		await until('!document.querySelector(".app-sidebar").inert', "sidebar reopening");
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
		);
		await until('document.querySelector(".app-sidebar").inert', "sidebar Escape dismissal");
		await host('document.querySelector(".skip-to-content").click()');
		assert.equal(await host("document.activeElement.id"), "main-content");
		assert.equal(
			await host("location.hash"),
			"#/sources",
			"skip link must not change HashRouter route",
		);
	}

	async function checkSidebarFilter() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await host(`(() => {
			const timestamp = "2026-09-21T00:00:00Z";
			const rootTurns = [
				{ id: "filter-root-question", sessionId: "filter-root", role: "user", content: "Shared context", status: "complete", createdAt: timestamp },
				{ id: "filter-root-answer", sessionId: "filter-root", role: "assistant", content: "Context for a branch.", status: "complete", createdAt: timestamp }
			];
			const childTurns = (sessionId, id, content, quote) => [
				...rootTurns.map(turn => ({ ...turn, id: sessionId + "-" + turn.id, sessionId, sourceTurnId: turn.id })),
				{ id, sessionId, role: "user", content, summary: content, quote, status: "complete", createdAt: timestamp },
				{ id: id + "-answer", sessionId, role: "assistant", content: "A detailed explanation for continued reading.\\n\\n".repeat(30), status: "complete", createdAt: timestamp }
			];
			window.uiStore.setState({
				sessions: [
					{ id: "filter-root", parentId: null, title: "Shared context", isRoot: true, status: "idle", progressStatus: "parked" },
					{ id: "filter-done", parentId: "filter-root", forkedFromTurnId: "filter-root-answer", title: "explain", isRoot: false, status: "idle", progressStatus: "complete" },
					{ id: "filter-todo", parentId: "filter-root", forkedFromTurnId: "filter-root-answer", title: "Explore attention", isRoot: false, status: "idle", progressStatus: "todo" },
					{ id: "filter-empty", parentId: null, title: "Unmarked chat", isRoot: true, status: "idle" }
				],
				turns: [
					...rootTurns,
					...childTurns("filter-done", "filter-done-question", "explain", { turnId: "filter-root-answer", text: "decoder-only architecture" }),
					...childTurns("filter-todo", "filter-todo-question", "Explore attention")
				],
				activeSessionId: "filter-todo",
				visibleSessionId: "filter-todo",
				sidebarOpen: true
			});
		})()`);
		await settle();
		const filterButton =
			'.sidebar-view-content:not([hidden]) button[aria-label="Filter by leaf status"]';
		const nodeViewSwitch = '.sidebar-view-content:not([hidden]) [aria-label="Node view"]';
		const visibleIds = () =>
			host(
				'[...document.querySelectorAll(".session-tree [data-session-tree-id]")].map(node => node.dataset.sessionTreeId)',
			);
		const choose = async (label) => {
			await host(`Array.from(document.querySelectorAll(".session-filter-menu [role=menuitemcheckbox]"))
				.find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
			await settle();
		};
		const open = async () => {
			await host(`document.querySelector(${JSON.stringify(filterButton)}).click()`);
			await until('Boolean(document.querySelector(".session-filter-menu"))', "leaf filter menu");
			await settle();
		};
		const close = async () => {
			await host(`document.querySelector(".session-filter-menu")
				.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
			await until('!document.querySelector(".session-filter-menu")', "leaf filter dismissal");
		};
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme, { highContrast: false, reduceMotion: true, fontScale: 1 });
			assert.equal(
				await host(
					"document.querySelector('[data-session-tree-id=\"filter-done-question\"] .session-node-title').textContent",
				),
				"Explain: decoder-only architecture",
				"existing Explain nodes show the selected subject",
			);
			await host(`(() => {
				const scroll = document.querySelector(".chat-scroll");
				scroll.classList.add("is-positioning");
				scroll.scrollTop = 240;
				scroll.classList.remove("is-positioning");
			})()`);
			await settle();
			const before = await host('document.querySelector(".chat-scroll").scrollTop');
			const total = await host(
				'document.querySelector(".session-tree-header .session-usage").textContent',
			);
			await open();
			assert.equal(
				await host("document.activeElement.textContent.trim()"),
				"All statuses",
				"filter opens with keyboard focus",
			);
			await host(
				`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`,
			);
			assert.equal(await host("document.activeElement.textContent.trim()"), "Unmarked");
			await choose("Completed");
			assert.deepEqual(await visibleIds(), ["filter-root-question", "filter-done-question"]);
			assert.equal(
				await host("window.uiStore.getState().activeSessionId"),
				"filter-todo",
				"filter must not navigate",
			);
			assert.ok(
				Math.abs((await host('document.querySelector(".chat-scroll").scrollTop')) - before) <= 1,
				"filter must not scroll the conversation",
			);
			assert.equal(
				await host('document.querySelector(".session-tree-header .session-usage").textContent'),
				total,
				"filter must not change total usage",
			);
			await host('window.uiStore.getState().setSessionProgressStatus("filter-todo", "complete")');
			await settle();
			assert.deepEqual(await visibleIds(), [
				"filter-root-question",
				"filter-done-question",
				"filter-todo-question",
			]);
			await host('window.uiStore.getState().setSessionProgressStatus("filter-todo", "todo")');
			await settle();
			await choose("To explore");
			assert.deepEqual(await visibleIds(), [
				"filter-root-question",
				"filter-done-question",
				"filter-todo-question",
			]);
			assert.equal(
				await host('document.querySelector(".session-tree .session-filter-count").textContent'),
				"2",
			);
			await checkContrast(`${theme} leaf filter`);
			await screenshot(`${theme}-leaf-filter`);
			await choose("To explore");
			await close();
			assert.equal(
				await host('document.activeElement.getAttribute("aria-label")'),
				"Filter by leaf status",
				"Escape restores focus",
			);
			await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
			await until(
				'document.querySelectorAll(".react-flow__node").length === 2',
				"filtered node view",
			);
			assert.deepEqual(
				await host(
					'[...document.querySelectorAll(".session-graph-node-main strong")].map(node => node.textContent)',
				),
				["Shared context", "Explain: decoder-only architecture"],
				"node view shares the filter and contextual titles",
			);
			await open();
			await choose("All statuses");
			await choose("On hold");
			assert.equal(
				await host('Boolean(document.querySelector(".session-graph-page .session-filter-empty"))'),
				true,
				"non-leaf status alone must not match",
			);
			await close();
			await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
			await settle();
			assert.deepEqual(await visibleIds(), []);
			await host('document.querySelector(".session-tree .session-filter-empty button").click()');
			await settle();
			assert.equal((await visibleIds()).length, 4);
			await open();
			await choose("Unmarked");
			assert.deepEqual(await visibleIds(), ["empty:filter-empty"]);
			await choose("Unmarked");
			assert.equal((await visibleIds()).length, 4, "clearing the last status restores all");
			await host(
				'document.querySelector(".chat-topbar").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))',
			);
			await until('!document.querySelector(".session-filter-menu")', "outside click dismissal");
		}
		await seedContent();
		await setAppearance("dark", { reduceMotion: false });
	}

	async function checkPageControls() {
		browser.setContentSize(1440, 960);
		await navigate("/knowledge", ".knowledge-page-header h1");
		await setInput(".knowledge-search input", "no-such-knowledge-entry");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-resource-list button").length'),
			0,
			"knowledge filtering exposes the no-results state",
		);
		await setInput(".knowledge-search input", "");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-resource-list button").length'),
			1,
		);
		await host('document.querySelector("#knowledge-diagrams-tab").click()');
		await settle();
		assert.equal(
			await host('document.querySelector("#knowledge-diagrams-tab").getAttribute("aria-selected")'),
			"true",
		);
		await host('document.querySelector("#knowledge-entities-tab").click()');
		await settle();
		await host(`Array.from(document.querySelectorAll(".knowledge-page button"))
			.find(button => button.textContent.trim() === "Edit").click()`);
		await until('Boolean(document.querySelector(".entity-center-editor"))', "knowledge editor");
		await host(`Array.from(document.querySelectorAll(".knowledge-page button"))
			.find(button => button.textContent.trim() === "Cancel").click()`);
		await until(
			'!document.querySelector(".entity-center-editor")',
			"knowledge editor cancellation",
		);
		assert.equal(await host("window.uiStore.getState().entities[0].name"), "Conversation branches");

		await navigate("/changes", ".page-title");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-change-list section").length'),
			1,
		);
		await setInput('[aria-label="Filter knowledge history"]', "no-such-change");
		await until(
			'document.querySelectorAll(".knowledge-change-list section").length === 0',
			"history filter",
		);
		assert.match(
			await host('document.querySelector(".knowledge-change-list .empty-state").textContent'),
			/No knowledge changes match/,
		);
		await setInput('[aria-label="Filter knowledge history"]', "");
		await until(
			'document.querySelectorAll(".knowledge-change-list section").length === 1',
			"history filter reset",
		);
		await host(`Array.from(document.querySelectorAll(".knowledge-change-list button"))
			.find(button => button.textContent.trim() === "View diff").click()`);
		await until(
			'Boolean(document.querySelector(".knowledge-change-diff pre"))',
			"knowledge object diff",
		);
		assert.match(
			await host('document.querySelector(".knowledge-change-diff pre").textContent'),
			/Conversation branches/,
		);
		await host("document.querySelector('[aria-label=\"Close diff\"]').click()");
		await host('document.querySelector("#changes-code-tab").click()');
		await until(
			'document.querySelector("#changes-code-tab").getAttribute("aria-selected") === "true"',
			"code tab",
		);
		await until(
			'Boolean(document.querySelector(".changes-code-empty, [role=alert]"))',
			"code diff state without desktop bridge",
		);
		await host('document.querySelector("#changes-knowledge-tab").click()');
		await settle();

		await navigate("/settings", ".page-title");
		const autoExtract = await host("window.uiStore.getState().settings.autoExtract");
		await host(`document.querySelector('input[name="app-theme"][value="light"]').click()`);
		await until('document.documentElement.dataset.theme === "light"', "theme radio");
		await host('document.querySelector("#reduce-motion").click()');
		await host('document.querySelector("#high-contrast").click()');
		await setInput("#font-scale", "1.1");
		await setInput("#concurrent-questions", "3");
		await host(`document.querySelector('button[aria-labelledby="auto-extract-label"]').click()`);
		await settle();
		const expected = {
			theme: "light",
			reduceMotion: true,
			highContrast: true,
			fontScale: 1.1,
			maxConcurrentRequests: 3,
			autoExtract: !autoExtract,
		};
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(
				await host(`window.uiStore.getState().settings[${JSON.stringify(key)}]`),
				value,
				key,
			);
		}
		assert.equal(
			await host(
				`document.querySelector('button[aria-labelledby="auto-extract-label"]').getAttribute("aria-checked")`,
			),
			String(!autoExtract),
		);
		assert.equal(await host('document.documentElement.classList.contains("reduce-motion")'), true);
		await host('document.querySelector("#font-scale").scrollIntoView({ block: "center" })');
		await screenshot("settings-controls");
		await browser.loadURL(browser.webContents.getURL());
		await until('Boolean(document.querySelector("#font-scale"))', "settings reload");
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(
				await host(`window.uiStore.getState().settings[${JSON.stringify(key)}]`),
				value,
				`${key} persists after reload`,
			);
		}
	}

	async function checkChatActionContrast() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await host(`window.uiStore.getState().updateTurn("ui-answer", {
			modelRequests: [{
				id: "ui-request", sequence: 1, timestamp: "2026-09-18T10:24:00.000Z",
				model: "UI test model", provider: "copilot", api: "test", thinking: "off",
				context: { messages: [{ role: "user", content: "Explain conversation branches." }] }
			}]
		})`);
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme, { highContrast: false, reduceMotion: false, fontScale: 1 });
			await host(`(() => {
				const paragraph = document.querySelector(".assistant-body .markdown-body p");
				const range = document.createRange();
				range.selectNodeContents(paragraph);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			})()`);
			await until('Boolean(document.querySelector(".text-selection-menu"))', "selected text menu");
			await host('document.querySelector(".text-selection-menu [role=menuitem]").click()');
			await until(
				'Boolean(document.querySelector(".text-selection-popover textarea"))',
				"selection question",
			);
			await setInput(".text-selection-popover textarea", "What context stays in the branch?");
			assert.equal(
				await host(
					'document.querySelector(".text-selection-actions button[type=submit]").disabled',
				),
				false,
			);
			await checkContrast(`${theme} selected text action`);
			await host('document.querySelector(".text-selection-actions button[type=button]").click()');
			await host("window.getSelection().removeAllRanges()");
			await host('window.uiStore.getState().openTurnInspector("ui-answer", "context")');
			await until(
				'Boolean(document.querySelector(".analyze-context-button"))',
				"context inspector action",
			);
			await checkContrast(`${theme} context analysis action`);
			await host('document.querySelector(".analyze-context-button").click()');
			await until('Boolean(document.querySelector(".rot-score"))', "context analysis results");
			await host("document.querySelector('[aria-label=\"Close panel\"]').click()");
		}
	}

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
			if (event.level === "error") rendererErrors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/`);
		await until('Boolean(document.querySelector(".chat-empty"))', "initial workspace");
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme);
			for (const [route, heading] of routes) {
				await navigate(route, heading);
				await checkLayout(`${theme} empty ${route}`);
				await checkContrast(`${theme} empty ${route}`);
				await screenshot(`${theme}-empty-${route.slice(1) || "workspace"}`);
			}
		}
		await seedContent();
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme);
			for (const width of [1440, 1024, 768, 375]) {
				browser.setContentSize(width, 960);
				await settle();
				for (const [route, heading] of routes) {
					await navigate(route, heading);
					await checkLayout(`${theme} ${width} ${route}`);
					await checkContrast(`${theme} ${width} ${route}`);
					if (width === 1440 || width === 375) {
						await screenshot(`${theme}-${width}-${route.slice(1) || "workspace"}`);
					}
				}
			}
			await setAppearance(theme, { fontScale: 1.25, highContrast: true, reduceMotion: true });
			for (const [route, heading] of routes) {
				await navigate(route, heading);
				await checkLayout(`${theme} large text ${route}`);
				await checkContrast(`${theme} large text ${route}`);
			}
			await setAppearance(theme, { fontScale: 1, highContrast: false, reduceMotion: false });
		}
		await checkInteractions();
		await checkSidebarFilter();
		await checkPageControls();
		await checkChatActionContrast();
		assert.deepEqual(rendererErrors, [], "renderer console errors");
		console.log(
			"Verified five routes, empty/populated states, both themes, four widths, large text and navigation.",
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
			if (browser && process.env.RHYZA_UI_SCREENSHOT_DIR) await screenshot("failure");
			browser?.destroy();
			await server?.close();
			app.exit(1);
		});
}
