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
	const ctrlClick = async (selector) => {
		await host(`document.querySelector(${JSON.stringify(selector)})
			.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);
		await host(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	};
	const pointerClick = async (selector) => {
		const point = await host(`(() => {
			const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
		})()`);
		browser.webContents.sendInputEvent({ type: "mouseMove", ...point });
		await sleep(30);
		browser.webContents.sendInputEvent({
			type: "mouseDown",
			button: "left",
			clickCount: 1,
			...point,
		});
		await sleep(30);
		browser.webContents.sendInputEvent({
			type: "mouseUp",
			button: "left",
			clickCount: 1,
			...point,
		});
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
		await until('Boolean(document.querySelector(".session-tree-header"))', "chat list");
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
				modelCatalog: () => Promise.resolve({ models: [] }),
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
		assert.equal(await host('Boolean(document.querySelector(".path-summary-toolbar"))'), false);
		assert.equal(await host('Boolean(document.querySelector(".path-summary-mode-button"))'), false);
		await ctrlClick(listRow("u2"));
		assert.equal(await host('document.querySelector(".path-summary-generate").disabled'), false);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), "left");
		assert.equal(
			await host(
				'document.querySelector(".path-summary-prompt").getBoundingClientRect().bottom < document.querySelector(".path-summary-controls").getBoundingClientRect().top',
			),
			true,
			"summary instructions appear above the selection actions",
		);
		assert.equal(
			await host('Boolean(document.querySelector(".path-summary-selection-details"))'),
			false,
			"selected nodes are highlighted in place without a duplicate list",
		);
		await sleep(200);
		assert.equal(
			await host(`(() => {
				const selected = document.querySelector(".session-node-button.is-current.is-summary-selected");
				if (!selected) return false;
				const swatch = document.createElement("span");
				swatch.style.background = "var(--ui-action)";
				document.body.append(swatch);
				const matches = getComputedStyle(selected).backgroundColor === getComputedStyle(swatch).backgroundColor;
				swatch.remove();
				return matches;
			})()`),
			true,
			"the current node remains visibly selected",
		);
		await click(listRow("r2"));
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(listRow("u2"))}).getAttribute("aria-pressed")`,
			),
			"true",
		);
		assert.equal(
			await host(
				'document.querySelectorAll(".summary-selection-checkbox, .summary-selection-count").length',
			),
			0,
			"list selection uses highlighting only",
		);
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
		const activeGraphNodeId = await host(
			`document.querySelector(${JSON.stringify(`${activeView} .session-graph-node.is-active`)})?.closest(".react-flow__node")?.dataset.id`,
		);
		assert.ok(activeGraphNodeId, "graph has a current node");
		const activeGraphNodeWasSelected =
			(await host(
				`document.querySelector(${JSON.stringify(graphNode(activeGraphNodeId))}).getAttribute("aria-pressed")`,
			)) === "true";
		if (!activeGraphNodeWasSelected) await click(graphNode(activeGraphNodeId));
		assert.equal(
			await host(
				`getComputedStyle(document.querySelector(${JSON.stringify(`${activeView} .session-graph-node.is-active.is-summary-selected`)})).outlineWidth`,
			),
			"3px",
			"graph selection remains visible on the active node",
		);
		if (!activeGraphNodeWasSelected) await click(graphNode(activeGraphNodeId));
		await sleep(420);
		await pointerClick(graphNode("u1"));
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(graphNode("u1"))}).getAttribute("aria-pressed")`,
			),
			"true",
			"physical click selects a graph node",
		);
		await pointerClick(graphNode("u1"));
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(graphNode("u1"))}).getAttribute("aria-pressed")`,
			),
			"false",
		);
		await click(graphNode("u2"));
		await switchView();
		await until(
			`document.querySelector(${JSON.stringify(listRow("u2"))})?.getAttribute("aria-pressed") === "mixed"`,
			"partial compressed-row selection",
		);
		await click(listRow("u2"));
		assert.match(
			await host('document.querySelector(".path-summary-controls").textContent'),
			/1 selected/,
		);
		await click(listRow("u2"));
		assert.equal(
			await host(`(() => {
				const input = document.querySelector(".path-summary-prompt textarea");
				const swatch = document.createElement("span");
				swatch.style.color = "var(--ui-brand-accent)";
				document.body.append(swatch);
				const highlighted = getComputedStyle(input).borderTopColor === getComputedStyle(swatch).color;
				swatch.remove();
				return highlighted;
			})()`),
			true,
			"summary prompt uses the accent border before generation",
		);
		await host(`(() => {
			const input = document.querySelector(".path-summary-prompt textarea");
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
			setter.call(input, "Focus on differences between branches");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await click(".path-summary-generate");
		await until(
			'!document.querySelector(".path-summary-toolbar") && window.uiStore.getState().sessions.length === 4',
			"successful summary",
		);
		await switchView();
		await until(
			`Boolean(document.querySelector(${JSON.stringify(graphNode("u2"))}))`,
			"graph entry after summary",
		);
		await ctrlClick(graphNode("u2"));
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(graphNode("u2"))}).getAttribute("aria-pressed")`,
			),
			"true",
			"Ctrl-click enters graph multiselect directly",
		);
		await click(".path-summary-cancel");
		await switchView();
		const captured = await host("window.summaryRequests[0]");
		assert.deepEqual(captured.paths.map((item) => item.id).sort(), ["r2", "u3"]);
		assert.equal(captured.prompt, "Focus on differences between branches");
		assert.equal(
			captured.rounds.flatMap((round) => round.messages).filter((message) => message.id === "a1")
				.length,
			1,
		);
		assert.doesNotMatch(JSON.stringify(captured), /PRIVATE|reasoning|tools|subagent/);
		const summaryId = await host(
			"window.uiStore.getState().sessions.find(session => !['root','left','right'].includes(session.id)).id",
		);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), summaryId);
		assert.equal(
			await host(
				`window.uiStore.getState().turns.find(turn => turn.sessionId === ${JSON.stringify(summaryId)} && turn.role === "user").content`,
			),
			"Focus on differences between branches",
		);
		assert.equal(
			await host(
				`window.uiStore.getState().sessions.find(session => session.id === ${JSON.stringify(summaryId)}).parentId`,
			),
			null,
		);
		await switchView();
		await until(
			'document.querySelectorAll(".summary-provenance-edge").length === 3',
			"two source links and one summary link",
		);
		assert.equal(await host('document.querySelectorAll(".summary-graph-junction").length'), 1);
		assert.equal(
			await host('document.querySelector(".summary-graph-junction").textContent.trim()'),
			"",
			"provenance connector has no visible source-path badge",
		);
		const summaryRoundId = await host(
			`window.uiStore.getState().turns.find(turn => turn.sessionId === ${JSON.stringify(summaryId)} && turn.role === "user").id`,
		);
		const highlightedSources = await host(`(() => {
			const sources = [...document.querySelectorAll(${JSON.stringify(`${activeView} .session-graph-node.is-summary-source`)})];
			return sources.map(node => ({
				id: node.closest(".react-flow__node").dataset.id,
				outline: getComputedStyle(node).outlineStyle,
				color: getComputedStyle(node).outlineColor,
				width: getComputedStyle(node).outlineWidth,
			}));
		})()`);
		assert.deepEqual(
			highlightedSources.map(({ id }) => id).sort(),
			["r2", "u3"],
			"only the selected summary's source nodes are highlighted",
		);
		assert.ok(
			highlightedSources.every(
				({ outline, color, width }) =>
					outline === "dashed" && color === "rgb(139, 92, 246)" && width === "3px",
			),
			"source-node highlights use visible purple dashed outlines",
		);
		await click(graphNode("r2"));
		await until(
			`!document.querySelector(${JSON.stringify(`${activeView} .session-graph-node.is-summary-source`)})`,
			"source highlights clear when leaving the summary",
		);
		assert.equal(
			await host('document.querySelectorAll(".summary-provenance-edge.is-active").length'),
			0,
			"provenance links do not remain highlighted after leaving the summary",
		);
		const ordinaryActiveAppearance = await host(`(() => {
			const path = document.querySelector(".react-flow__edge.is-active:not(.summary-provenance-edge) .react-flow__edge-path");
			const style = getComputedStyle(path);
			return { width: style.strokeWidth, filter: style.filter, stroke: style.stroke, path: path.getAttribute("d"), arrow: style.markerEnd };
		})()`);
		assert.ok(
			ordinaryActiveAppearance.path.includes("C") &&
				ordinaryActiveAppearance.stroke.startsWith("url(") &&
				ordinaryActiveAppearance.arrow.startsWith("url("),
			"selected normal links use a curved gradient and arrowhead",
		);
		await click(graphNode(summaryRoundId));
		await until(
			`document.querySelectorAll(${JSON.stringify(`${activeView} .session-graph-node.is-summary-source`)}).length === 2`,
			"source highlights return when selecting the summary",
		);
		assert.equal(
			await host('document.querySelectorAll(".summary-provenance-edge.is-active").length'),
			3,
			"selected summary highlights both source links and the junction-to-summary link",
		);
		const sourceLabels = await host(
			`[...document.querySelectorAll(${JSON.stringify(`${activeView} .react-flow__node[data-id="${summaryRoundId}"] .summary-node-source`)})].map(element => element.textContent)`,
		);
		assert.deepEqual(
			sourceLabels,
			(
				await host(
					`window.uiStore.getState().turns.find(turn => turn.id === ${JSON.stringify(summaryRoundId)}).pathSummary.sources.map(source => source.title)`,
				)
			).slice(0, 2),
			"summary card identifies its source paths without crossing links",
		);
		for (const orientation of ["vertical", "horizontal"]) {
			const checked = await host(
				`document.querySelector('[aria-label="Vertical layout"]').getAttribute("aria-checked")`,
			);
			if ((checked === "true") !== (orientation === "vertical"))
				await click('[aria-label="Vertical layout"]');
			await sleep(380);
			const edgeAppearance = await host(`(() => {
					const edges = [...document.querySelectorAll(".summary-provenance-edge .react-flow__edge-path")];
					return edges.map(path => {
						const style = getComputedStyle(path);
						return {
							length: path.getTotalLength(),
							stroke: style.stroke,
							width: style.strokeWidth,
							filter: style.filter,
							dash: style.strokeDasharray,
							arrow: style.markerEnd,
							curve: path.getAttribute("d").includes("C"),
						};
					});
				})()`);
			assert.ok(
				edgeAppearance.length === 3 &&
					edgeAppearance.filter(({ arrow }) => arrow === ordinaryActiveAppearance.arrow).length ===
						1 &&
					edgeAppearance.every(
						({ length, stroke, width, filter, dash, arrow, curve }) =>
							length > 0 &&
							stroke.startsWith("url(") &&
							width === ordinaryActiveAppearance.width &&
							filter === ordinaryActiveAppearance.filter &&
							dash !== "none" &&
							(arrow === ordinaryActiveAppearance.arrow || arrow === 'url("#")') &&
							curve,
					),
				`${orientation} provenance links reuse the curved gradient and arrow into the summary, but remain dashed: ${JSON.stringify(edgeAppearance)}`,
			);
		}
		await switchView();
		await until(
			'Boolean(document.querySelector(".path-summary-source-quote"))',
			"summary continuation",
		);
		assert.equal(
			await host(
				`Boolean(document.querySelector(${JSON.stringify(`.chat-turn[data-turn-id="${summaryRoundId}"] .user-bubble .path-summary-source-quote`)}))`,
			),
			true,
			"source paths appear as a quote inside the summary message",
		);
		assert.equal(
			await host(
				'Boolean(document.querySelector(".path-summary-source-quote .user-message-quote-label"))',
			),
			false,
			"source quote shows links without a heading",
		);
		assert.equal(await host('Boolean(document.querySelector(".path-summary-sources"))'), false);
		browser.setContentSize(1750, 960);
		await until('Boolean(document.querySelector(".answer-outline"))', "summary answer outline");
		const quoteAndOutline = await host(`(() => {
			const sources = document.querySelector(".path-summary-source-quote").getBoundingClientRect();
			const outline = document.querySelector(".answer-outline").getBoundingClientRect();
			return { sourcesLeft: sources.left, outlineRight: outline.right };
		})()`);
		assert.ok(
			quoteAndOutline.outlineRight <= quoteAndOutline.sourcesLeft,
			"answer outline must not overlap quoted summary sources",
		);
		browser.setContentSize(1440, 960);
		assert.equal(
			await host(
				`window.uiStore.getState().turns.filter(turn => turn.sessionId === ${JSON.stringify(summaryId)}).length`,
			),
			2,
		);
		assert.equal(
			await host('document.querySelectorAll(".path-summary-source-quote li").length'),
			2,
		);
		await click(".path-summary-source-quote li button");
		assert.notEqual(
			await host("window.uiStore.getState().activeSessionId"),
			summaryId,
			"sources navigate to the original path",
		);
		await ctrlClick(listRow("u2"));
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
		const previousPendingSessionId = await host("window.uiStore.getState().activeSessionId");
		await click(".path-summary-generate");
		await until(
			'!document.querySelector(".path-summary-toolbar") && Boolean(document.querySelector(".path-summary-composer-pending"))',
			"pending summary without a top toolbar",
		);
		assert.equal(await host('Boolean(document.querySelector(".path-summary-generate"))'), false);
		assert.equal(await host('Boolean(document.querySelector(".path-summary-prompt"))'), false);
		assert.equal(
			await host('Boolean(document.querySelector(".path-summary-selection-details"))'),
			false,
		);
		assert.equal(
			await host('Boolean(document.querySelector(".path-summary-composer-pending"))'),
			true,
		);
		assert.equal(await host("window.uiStore.getState().sessions.length"), 5);
		const pendingId = await host("window.uiStore.getState().activeSessionId");
		const pendingRoundId = await host(
			`window.uiStore.getState().turns.find(turn => turn.sessionId === ${JSON.stringify(pendingId)} && turn.role === "user").id`,
		);
		assert.equal(
			await host(
				`window.uiStore.getState().turns.find(turn => turn.sessionId === ${JSON.stringify(pendingId)} && turn.role === "assistant").status`,
			),
			"running",
		);
		await switchView();
		await until(
			`Boolean(document.querySelector(${JSON.stringify(graphNode(pendingRoundId))}))`,
			"pending graph node",
		);
		assert.equal(
			await host(
				`document.querySelector(${JSON.stringify(`${activeView} .react-flow__node[data-id="${pendingRoundId}"] .session-graph-node`)}).dataset.executionStatus`,
			),
			"running",
		);
		assert.equal(await host('document.querySelectorAll(".summary-provenance-edge").length'), 5);
		assert.equal(
			await host(
				`Boolean(document.querySelector(${JSON.stringify(`${activeView} .react-flow__node[data-id="${pendingRoundId}"] .summary-node-sources`)}))`,
			),
			true,
			"pending summary already identifies its sources",
		);
		await switchView();
		assert.equal(
			await host('document.querySelectorAll(".session-tree-select[role=checkbox]").length'),
			0,
			"running summaries do not leave selection checkboxes in the list",
		);
		assert.equal(await host('document.querySelectorAll(".summary-selection-checkbox").length'), 0);
		await click(".path-summary-composer-pending button");
		await until(
			'document.querySelector(".path-summary-error")?.textContent.includes("Summary canceled")',
			"summary cancellation",
		);
		assert.equal(await host("window.summaryListeners.size"), 0, "progress listener cleanup");
		assert.equal(await host("window.uiStore.getState().sessions.length"), 4);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), previousPendingSessionId);
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
			'Boolean(document.querySelector(".path-summary-generate"))',
			"preselected merge mode",
		);
		await click(".path-summary-generate");
		await until(
			'!document.querySelector(".path-summary-toolbar") && window.uiStore.getState().sessions.length === 5',
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
		assert.equal(
			await host('Boolean(document.querySelector(".path-summary-toolbar"))'),
			false,
			"deleting a completed summary leaves no stale status banner",
		);
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			for (const width of [1440, 1024, 768, 375]) {
				browser.setContentSize(width, 960);
				await sleep(60);
				if (width <= 900 && (await host('Boolean(document.querySelector(".sidebar-reopen"))')))
					await click(".sidebar-reopen");
				await ctrlClick(listRow("u2"));
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
			'Boolean(document.querySelector(".path-summary-source-quote"))',
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
		assert.equal(
			await host('document.querySelectorAll(".path-summary-source-quote button:disabled").length'),
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
