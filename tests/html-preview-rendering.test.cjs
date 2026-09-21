const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const test = require("node:test");
	const { spawn } = require("node:child_process");
	async function runPreviewTest(archify) {
		const userData = await mkdtemp(path.join(projectRoot, ".rhyza-preview-rendering-"));
		const env = {
			...process.env,
			RHYZA_PREVIEW_TEST_DATA: userData,
			RHYZA_PREVIEW_TEST_ARCHIFY: archify ? "1" : "0",
			ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
		};
		delete env.ELECTRON_RUN_AS_NODE;
		try {
			if (archify) {
				const { tsImport } = await import("tsx/esm/api");
				const extensionRoot = path.join(projectRoot, "extensions", "pi-archify");
				const { ArchifyService } = await tsImport(
					pathToFileURL(path.join(extensionRoot, "src", "runtime.ts")).href,
					pathToFileURL(__filename).href,
				);
				const { createArchifyPreviewHtml } = await tsImport(
					pathToFileURL(path.join(extensionRoot, "src", "viewer.ts")).href,
					pathToFileURL(__filename).href,
				);
				const skillRoot = path.join(extensionRoot, "skills", "archify");
				const source = await readFile(
					path.join(skillRoot, "examples", "agent-tool-call.workflow.json"),
					"utf8",
				);
				const diagram = await new ArchifyService(skillRoot, userData).render(source);
				assert.equal(diagram.ok, true, diagram.error);
				await writeFile(path.join(userData, "archify.html"), diagram.html);
				await writeFile(
					path.join(userData, "archify.preview.html"),
					createArchifyPreviewHtml(diagram.html),
				);
			}
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
	}
	test(
		"HTML previews preserve interactive state and settle content-driven resizing",
		{ timeout: 120_000 },
		() => runPreviewTest(false),
	);
	test(
		"Archify compact previews preserve natural height and expand the full document",
		{ timeout: 120_000 },
		() => runPreviewTest(true),
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_PREVIEW_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	let fontWarnings = 0;
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
		<main><h1 style="margin: 0">Iframe heading</h1><input id="state" value="initial"></main>
		<script>parent.postMessage({ type: "preview-test-loaded" }, "*");</script>`;
	const reference = { version: 1, path: "preview.html", title: "Interactive preview" };

	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		const page = `<!doctype html><html><body><div id="root" style="width: 900px"></div>
			<script type="module">
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { TurnBubbleContent, TurnMessage } from "/src/components/chat/TurnMessage.tsx";
				import { markdownHeadingSelector, revealMarkdownHeadingEvent } from "/src/utils/markdownSections.ts";
				import "/src/index.css";
				const root = createRoot(document.getElementById("root"));
				let html = ${JSON.stringify(html).replace(/</g, "\\u003c")};
				let reference = ${JSON.stringify(reference)};
				let previewHtml;
				let previewError;
				let extraDocuments = [];
				let revision = 0;
				let status = "complete";
				let tail = "";
				window.headingSelector = markdownHeadingSelector;
				window.revealHeading = (target) => {
					target.dispatchEvent(new CustomEvent(revealMarkdownHeadingEvent, {
						detail: { headingId: target.dataset.markdownHeadingId ?? target.dataset.markdownSectionId },
						bubbles: true
					}));
				};
				window.loads = 0;
				window.addEventListener("message", (event) => {
					if (event.data?.type === "preview-test-loaded") window.loads++;
				});
				window.refreshPreview = (updates = {}) => {
					if ("html" in updates) html = updates.html;
					if ("reference" in updates) reference = updates.reference;
					if ("previewHtml" in updates) previewHtml = updates.previewHtml;
					if ("previewError" in updates) previewError = updates.previewError;
					if ("extraDocuments" in updates) extraDocuments = updates.extraDocuments;
					if ("status" in updates) status = updates.status;
					if ("tail" in updates) tail = updates.tail;
					const currentRevision = ++revision;
					const content = [
						"# Preview **sections**",
						"",
						"Introductory text.",
						"",
						"### [Entity](#knowledge/entity/example) and $x^2$",
						"",
						"\`\`\`html-preview",
						JSON.stringify(reference),
						"\`\`\`",
						"",
						"[Entity](#knowledge/entity/example) [Diagram](#knowledge/diagram/example)",
						"",
						"###### Deep section",
						"",
						"Deep body.",
						"",
						"### Duplicate",
						"",
						"Sibling body.",
						"",
						"### Duplicate",
						"",
						"Another sibling.",
						"",
						"Setext section",
						"==============",
						"",
						"\`\`\`markdown",
						"# Fenced heading",
						"\`\`\`",
						tail
					].join("\\n");
					root.render(React.createElement(React.StrictMode, null,
						React.createElement(TurnMessage, {
							turn: {
								id: "preview-turn",
								sessionId: "session",
								role: "assistant",
								status,
								content,
								reasoning: "# Reasoning heading\\n\\nNot an answer section.",
								htmlPreviews: html === null ? [] : [...extraDocuments, { ...reference, html, previewHtml, previewError }],
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
				const secondaryHost = document.createElement("div");
				secondaryHost.id = "secondary-markdown";
				document.body.append(secondaryHost);
				const secondaryProps = {
					turn: {
						id: "secondary-turn",
						role: "assistant",
						status: "complete",
						content: "# Graph preview heading\\n\\nUnchanged rendering.",
						createdAt: "2026-01-01T00:00:00Z"
					},
					entities: [],
					relations: [],
					diagrams: [],
					onEntityClick: () => {},
					onDiagramClick: () => {}
				};
				createRoot(secondaryHost).render(React.createElement(React.Fragment, null,
					React.createElement(TurnBubbleContent, secondaryProps),
					React.createElement(TurnMessage, {
						...secondaryProps,
						turn: { ...secondaryProps.turn, id: "user-turn", role: "user", content: "# User heading" },
						sessionNodeId: "session",
						onFork: () => {},
						canFork: false,
						onTextSelection: () => {},
						onOpenContextMenu: () => {},
						isFocused: false
					})
				));
				window.refreshPreview();
			</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
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
		browser.webContents.on("console-message", (event) => {
			if (
				event.message.includes("fonts.googleapis.com") &&
				event.message.includes("Content Security Policy")
			) {
				fontWarnings++;
			}
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__preview-test`);
		if (process.env.RHYZA_PREVIEW_TEST_ARCHIFY === "1") {
			await verifyArchify();
		} else {
			await verifyGenericPreviews();
		}
	}

	async function verifyGenericPreviews() {
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
		await verifyMarkdownSections();

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

		const dualReference = { ...reference, previewPath: "compact.html" };
		const compactHtml = `<style>body { margin: 0; } main { height: 260px; }</style>
			<main data-view="compact"><input id="state" value="compact-initial">Compact only</main>
			<script>parent.postMessage({ type: "dual-preview-loaded", kind: "compact" }, "*");</script>`;
		const fullHtml = `<style>body { margin: 0; } main { height: 900px; }</style>
			<main data-view="full"><input id="state" value="full-initial">Full only</main>
			<script>parent.postMessage({ type: "dual-preview-loaded", kind: "full" }, "*");</script>`;
		await host(`window.dualLoads = { compact: 0, full: 0 };
			window.addEventListener("message", (event) => {
				if (event.data?.type === "dual-preview-loaded") window.dualLoads[event.data.kind]++;
			});
			window.refreshPreview(${JSON.stringify({
				reference: dualReference,
				html: fullHtml,
				previewHtml: compactHtml,
				extraDocuments: [
					{
						...reference,
						previewPath: "other-compact.html",
						html: "<p>Wrong full document</p>",
						previewHtml: "<p>Wrong compact document</p>",
					},
				],
			})})`);
		await until("window.dualLoads.compact === 1", "compact snapshot loads inline");
		await until(
			'document.querySelector(".html-preview > iframe")?.style.height === "260px"',
			"compact document drives inline height",
		);
		assert.equal(await host("window.dualLoads.full"), 0, "Full HTML must not execute inline.");
		assert.equal(
			await browser.webContents.mainFrame.frames[0].executeJavaScript(
				'document.querySelector("main").dataset.view',
			),
			"compact",
		);
		await host('window.compactFrame = document.querySelector(".html-preview > iframe")');
		await browser.webContents.mainFrame.frames[0].executeJavaScript(
			'document.querySelector("#state").value = "compact-preserved"',
		);
		for (const status of ["running", "complete"]) {
			await host(`window.refreshPreview({ status: ${JSON.stringify(status)} })`);
			await sleep(100);
			assert.equal(
				await host('window.compactFrame === document.querySelector(".html-preview > iframe")'),
				true,
			);
			assert.equal(await host("window.dualLoads.compact"), 1);
		}

		await host("document.querySelector('button[aria-label=\"Expand HTML preview\"]').click()");
		await until("window.dualLoads.full === 1", "Expand loads full HTML");
		assert.equal(await host('document.querySelectorAll("iframe").length'), 2);
		assert.equal(
			await host('window.compactFrame === document.querySelector(".html-preview > iframe")'),
			true,
			"Opening the full document must keep the inline frame mounted.",
		);
		assert.equal(
			await browser.webContents.mainFrame.frames[0].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"compact-preserved",
		);
		assert.equal(
			await browser.webContents.mainFrame.frames[1].executeJavaScript(
				'document.querySelector("main").dataset.view',
			),
			"full",
		);
		assert.equal(
			await host(
				'document.querySelector(".html-preview-dialog iframe").srcdoc.includes("ResizeObserver")',
			),
			false,
			"The full document must not contain the inline sizing script.",
		);
		await host('window.fullFrame = document.querySelector(".html-preview-dialog iframe")');
		await browser.webContents.mainFrame.frames[1].executeJavaScript(
			'document.querySelector("#state").value = "full-preserved"',
		);

		const updatedCompact = compactHtml
			.replace("260px", "320px")
			.replace("compact-initial", "compact-updated");
		await host(`window.refreshPreview({ previewHtml: ${JSON.stringify(updatedCompact)} })`);
		await until("window.dualLoads.compact === 2", "compact snapshot updates independently");
		assert.equal(
			await browser.webContents.mainFrame.frames[0].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"compact-updated",
		);
		assert.equal(
			await host('window.compactFrame === document.querySelector(".html-preview > iframe")'),
			true,
			"Compact updates navigate, rather than remount, the inline frame.",
		);
		assert.equal(
			await host('window.fullFrame === document.querySelector(".html-preview-dialog iframe")'),
			true,
		);
		assert.equal(await host("window.dualLoads.full"), 1);
		assert.equal(
			await browser.webContents.mainFrame.frames[1].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"full-preserved",
		);
		await browser.webContents.mainFrame.frames[0].executeJavaScript(
			'document.querySelector("#state").value = "compact-updated-preserved"',
		);

		const updatedFull = fullHtml.replace("full-initial", "full-updated");
		await host(`window.refreshPreview({ html: ${JSON.stringify(updatedFull)} })`);
		await until("window.dualLoads.full === 2", "full snapshot updates independently");
		assert.equal(await host("window.dualLoads.compact"), 2);
		assert.equal(
			await browser.webContents.mainFrame.frames[0].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"compact-updated-preserved",
		);
		assert.equal(
			await browser.webContents.mainFrame.frames[1].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"full-updated",
		);
		assert.equal(
			await host(`(() => {
				const frames = [...document.querySelectorAll("iframe")];
				return frames.every((frame) =>
					frame.getAttribute("sandbox") === "allow-scripts allow-downloads" &&
					frame.referrerPolicy === "no-referrer" &&
					frame.srcdoc.includes("connect-src 'none'")
				);
			})()`),
			true,
			"Both documents must use the same opaque-origin sandbox and CSP.",
		);

		await host(`window.originalCreateObjectURL = URL.createObjectURL;
			window.originalAnchorClick = HTMLAnchorElement.prototype.click;
			URL.createObjectURL = (blob) => {
				window.downloadBlob = blob;
				return window.originalCreateObjectURL(blob);
			};
			HTMLAnchorElement.prototype.click = function () {
				window.downloadName = this.download;
			};
			document.querySelector('button[aria-label="Download HTML"]').click();`);
		assert.equal(await host("window.downloadBlob.text()"), updatedFull);
		assert.equal(await host("window.downloadName"), "Interactive-preview.html");
		await host(`URL.createObjectURL = window.originalCreateObjectURL;
			HTMLAnchorElement.prototype.click = window.originalAnchorClick;
			void 0;`);

		for (const close of [
			"document.querySelector('button[aria-label=\"Close HTML preview\"]').click()",
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))',
			'document.querySelector(".html-preview-backdrop").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))',
		]) {
			await host(close);
			await until('document.querySelectorAll("iframe").length === 1', "full viewer closes");
			await until(
				'document.querySelector(".html-preview > iframe")?.style.height === "320px"',
				"updated compact height after the full viewer no longer occludes it",
			);
			assert.equal(
				await host('window.compactFrame === document.querySelector(".html-preview > iframe")'),
				true,
			);
			assert.equal(await host("window.dualLoads.compact"), 2);
			assert.equal(
				await browser.webContents.mainFrame.frames[0].executeJavaScript(
					'document.querySelector("#state").value',
				),
				"compact-updated-preserved",
			);
			if (close.includes("backdrop")) break;
			const fullLoads = await host("window.dualLoads.full");
			await host("document.querySelector('button[aria-label=\"Expand HTML preview\"]').click()");
			await until('document.querySelectorAll("iframe").length === 2', "full viewer reopens");
			await until(`window.dualLoads.full === ${fullLoads + 1}`, "reopened full HTML loads");
		}

		await host('window.refreshPreview({ previewHtml: "" })');
		await until(
			'document.querySelector(".html-preview > iframe").srcdoc.endsWith("</script>")',
			"an empty compact snapshot remains an empty document instead of falling back",
		);
		await host(
			`window.refreshPreview({ previewHtml: undefined, previewError: "Compact file is missing." })`,
		);
		await until(
			'document.querySelector(".html-preview > iframe").srcdoc.includes(\'data-view="full"\')',
			"failed compact snapshot falls back to full HTML",
		);
		await until(
			'document.querySelector(".html-preview > iframe")?.style.height === "900px"',
			"fallback full document height",
		);
		assert.match(
			await host('document.querySelector(".html-preview [role=status]").textContent'),
			/Compact preview unavailable\. Showing the full HTML document\. Compact file is missing\./,
		);
		assert.equal(
			await host('window.compactFrame === document.querySelector(".html-preview > iframe")'),
			true,
			"Adding an optional-preview error notice must not remount the frame.",
		);
		const fallbackLoads = await host("window.dualLoads.full");
		await host(`window.refreshPreview({
			reference: ${JSON.stringify(reference)},
			previewError: undefined,
			extraDocuments: [{
				...${JSON.stringify(dualReference)},
				html: "<p>Wrong compact attachment's full document</p>",
				previewHtml: "<p>Wrong compact document</p>"
			}]
		})`);
		await until(
			'!document.querySelector(".html-preview [role=status]")',
			"legacy full-only attachment has no optional-preview error notice",
		);
		assert.equal(
			await host(
				'document.querySelector(".html-preview > iframe").srcdoc.includes(\'data-view="full"\')',
			),
			true,
			"A legacy reference must not match a different compact attachment with the same full path.",
		);
		assert.equal(await host("window.dualLoads.full"), fallbackLoads);
		await host("window.refreshPreview({ extraDocuments: [] })");

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

	async function verifyMarkdownSections() {
		assert.deepEqual(
			await host(`Array.from(document.querySelectorAll(window.headingSelector), (heading) => ({
				idMatches: heading.id === heading.dataset.markdownHeadingId,
				level: heading.dataset.markdownHeadingLevel,
				text: heading.dataset.markdownHeadingText
			}))`),
			[
				{ idMatches: true, level: "1", text: "Preview sections" },
				{ idMatches: true, level: "3", text: "Entity and x^2" },
				{ idMatches: true, level: "6", text: "Deep section" },
				{ idMatches: true, level: "3", text: "Duplicate" },
				{ idMatches: true, level: "3", text: "Duplicate" },
				{ idMatches: true, level: "1", text: "Setext section" },
			],
		);
		assert.equal(
			await host(
				'document.querySelectorAll("#secondary-markdown [data-markdown-heading-id], .reasoning-block [data-markdown-heading-id]").length',
			),
			0,
			"User messages, reasoning and graph previews must not expose folding metadata.",
		);
		assert.equal(
			await host(
				'document.querySelectorAll(".markdown-section-toggle a, .markdown-section-toggle button").length',
			),
			0,
			"Heading links must not be nested in the toggle button.",
		);
		assert.equal(
			await host(
				'!!document.querySelector(".markdown-section-heading strong") && !!document.querySelector(".markdown-section-heading .katex")',
			),
			true,
			"Heading emphasis and inline math must retain their renderers.",
		);
		await host(`window.originalHeadings = Array.from(document.querySelectorAll(window.headingSelector));
			window.headingIds = window.originalHeadings.map((heading) => heading.id);
			window.originalHeadings[1].querySelector("a").click();`);
		assert.equal(
			await host(
				'window.originalHeadings[1].querySelector("button").getAttribute("aria-expanded")',
			),
			"true",
			"Following a heading link must not toggle its section.",
		);
		await host(
			'window.originalHeadings[1].querySelector(".markdown-section-heading-text").click()',
		);
		await until(
			'window.originalHeadings[1].querySelector("button").getAttribute("aria-expanded") === "false"',
			"heading text toggles its section",
		);
		assert.equal(
			await host(
				'document.getElementById(window.originalHeadings[1].querySelector("button").getAttribute("aria-controls")).hidden',
			),
			true,
		);
		assert.equal(
			await host("window.originalHeadings.every((heading) => heading.isConnected)"),
			true,
		);
		assert.equal(
			await host('window.originalFrame === document.querySelector("iframe")'),
			true,
			"Folding must preserve the iframe DOM node.",
		);
		const revision = await host(
			'window.refreshPreview({ tail: "\\n\\n## Streaming heading\\n\\nStreaming content.", status: "running" })',
		);
		await until(
			"document.querySelectorAll(window.headingSelector).length === 7",
			"streamed heading joins the outline",
		);
		assert.deepEqual(
			await host(
				"Array.from(document.querySelectorAll(window.headingSelector), (heading) => heading.id).slice(0, 6)",
			),
			await host("window.headingIds"),
		);
		assert.equal(
			await host(
				'window.originalHeadings[1].querySelector("button").getAttribute("aria-expanded")',
			),
			"false",
			"Streaming must preserve the collapsed section.",
		);
		assert.equal(
			await host("window.originalHeadings.every((heading) => heading.isConnected)"),
			true,
		);
		await host('window.originalHeadings[1].querySelector("a").click()');
		assert.deepEqual(await host("window.lastClick"), { kind: "entity", id: "example", revision });
		for (const dispatchOnSection of [false, true]) {
			await host(`for (const index of [0, 1, 2, 3]) {
				const button = window.originalHeadings[index].querySelector("button");
				if (button.getAttribute("aria-expanded") === "true") button.click();
			}
			document.querySelector(".response-collapse").click();`);
			await until(
				'document.querySelector(".turn-expanded-content").hidden',
				"whole response is hidden without unmounting",
			);
			assert.equal(
				await host("window.originalHeadings.every((heading) => heading.isConnected)"),
				true,
			);
			assert.deepEqual(
				await host(`new Promise((resolve) => {
					document.querySelector(".response-collapse").focus({ preventScroll: true });
					const focused = document.activeElement;
					const scrollTop = window.scrollY;
					const heading = window.originalHeadings[2];
					window.revealHeading(${dispatchOnSection ? 'heading.closest("[data-markdown-section-id]")' : "heading"});
					requestAnimationFrame(() => resolve({
						expanded: [0, 1, 2].every((index) =>
							window.originalHeadings[index].querySelector("button").getAttribute("aria-expanded") === "true"),
						unrelatedCollapsed: window.originalHeadings[3].querySelector("button").getAttribute("aria-expanded") === "false",
						responseVisible: !document.querySelector(".turn-expanded-content").hidden,
						focusUnchanged: document.activeElement === focused,
						scrollUnchanged: window.scrollY === scrollTop
					}));
				})`),
				{
					expanded: true,
					unrelatedCollapsed: true,
					responseVisible: true,
					focusUnchanged: true,
					scrollUnchanged: true,
				},
				`Reveal dispatched on a ${dispatchOnSection ? "section" : "heading"} must synchronously expand the target and ancestors without focus or scroll side effects.`,
			);
		}
		await host(`window.originalHeadings[3].querySelector("button").focus({ preventScroll: true });
			document.getElementById("root").style.width = "320px";`);
		browser.webContents.debugger.attach("1.3");
		await browser.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			text: "\r",
		});
		await browser.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await until(
			'window.originalHeadings[3].querySelector("button").getAttribute("aria-expanded") === "true"',
			"Enter operates a native heading button at narrow widths",
		);
		await browser.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: " ",
			code: "Space",
			windowsVirtualKeyCode: 32,
			text: " ",
		});
		await browser.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: " ",
			code: "Space",
			windowsVirtualKeyCode: 32,
		});
		await until(
			'window.originalHeadings[3].querySelector("button").getAttribute("aria-expanded") === "false"',
			"Space operates a native heading button",
		);
		browser.webContents.debugger.detach();
		await host(`window.revealHeading(window.originalHeadings[3]);
			document.getElementById("root").style.width = "900px";
			window.refreshPreview({ tail: "", status: "complete" });`);
		await until(
			"document.querySelectorAll(window.headingSelector).length === 6",
			"stream fixture restored",
		);
		assert.equal(await host('window.originalFrame === document.querySelector("iframe")'), true);
		assert.equal(
			await host("window.loads"),
			1,
			"Folding, revealing and streaming must not reload previews.",
		);
		assert.equal(
			await browser.webContents.mainFrame.frames[0].executeJavaScript(
				'document.querySelector("#state").value',
			),
			"preserved",
		);
	}

	async function verifyArchify() {
		await until("window.loads === 1", "initial iframe load");
		await until(
			'document.querySelector("iframe")?.style.height === "1800px"',
			"initial fitted height",
		);
		const archifyHtml = await readFile(
			path.join(process.env.RHYZA_PREVIEW_TEST_DATA, "archify.html"),
			"utf8",
		);
		const archifyPreviewHtml = await readFile(
			path.join(process.env.RHYZA_PREVIEW_TEST_DATA, "archify.preview.html"),
			"utf8",
		);
		assert.notEqual(archifyPreviewHtml, archifyHtml);
		await host(
			`window.refreshPreview(${JSON.stringify({
				reference: {
					version: 1,
					path: "archify.html",
					previewPath: "archify.preview.html",
					title: "Archify integration",
				},
				html: archifyHtml,
				previewHtml: archifyPreviewHtml,
			})})`,
		);
		await until(
			'document.querySelector("iframe")?.srcdoc.includes("rhyza-archify-host")',
			"Archify compact snapshot attaches",
		);
		assert.equal(
			await host(
				`document.querySelector("iframe").srcdoc.endsWith(${JSON.stringify(archifyPreviewHtml)})`,
			),
			true,
			"The inline iframe must receive the original compact snapshot.",
		);
		await until(
			'parseFloat(document.querySelector("iframe").style.height) > 150',
			"Archify preview grows beyond the initial 150px iframe",
		);
		for (const width of [900, 600, 1200]) {
			await host(`document.querySelector("#root").style.width = "${width}px"`);
			await sleep(750);
			const archifyFrame = browser.webContents.mainFrame.frames[0];
			const samples = await archifyFrame.executeJavaScript(`new Promise((resolve) => {
				const samples = [];
				const sample = () => {
					const svg = document.querySelector(".diagram-container > svg");
					const rect = svg.getBoundingClientRect();
					const box = svg.viewBox.baseVal;
					samples.push({
						height: innerHeight,
						svgHeight: rect.height,
						naturalHeight: rect.width * box.height / box.width,
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
				`Archify's natural height must settle at ${width}px: ${JSON.stringify(samples.slice(0, 12))}`,
			);
			assert(samples[0].svgHeight > 150, "The initial iframe must not shrink the diagram.");
			assert(Math.abs(samples[0].svgHeight - samples[0].naturalHeight) < 1);
			assert.equal(samples[0].overflow, 0);
		}
		await host('window.archifyInlineFrame = document.querySelector(".html-preview > iframe")');
		await host("document.querySelector('button[aria-label=\"Expand HTML preview\"]').click()");
		await until(
			'document.querySelector(".html-preview-dialog iframe") !== null',
			"Archify full document opens separately",
		);
		assert.equal(
			await host(
				`document.querySelector(".html-preview-dialog iframe").srcdoc.endsWith(${JSON.stringify(archifyHtml)})`,
			),
			true,
		);
		await host("document.querySelector('button[aria-label=\"Close HTML preview\"]').click()");
		await until('document.querySelectorAll("iframe").length === 1', "Archify full viewer closes");
		assert.equal(
			await host('window.archifyInlineFrame === document.querySelector(".html-preview > iframe")'),
			true,
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
