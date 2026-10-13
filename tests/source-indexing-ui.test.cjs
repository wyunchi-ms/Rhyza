const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");
if (!process.versions.electron) {
	const test = require("node:test");
	const { spawn } = require("node:child_process");
	test(
		"source indexing and removal support persistence, cancellation and recoverable errors",
		{ timeout: 120_000 },
		async () => {
			const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-source-settings-"));
			const env = {
				...process.env,
				RHYZA_SOURCE_SETTINGS_TEST: root,
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
					const code = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(code, 0, output);
				} finally {
					clearTimeout(timeout);
				}
			} finally {
				await rm(root, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow, ipcMain } = require("electron");
	const root = process.env.RHYZA_SOURCE_SETTINGS_TEST;
	app.setPath("userData", path.join(root, "profile"));
	app.on("window-all-closed", () => {});
	let browser;
	let server;
	const errors = [];
	const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(`Timed out: ${label}`);
	};
	const click = async (selector) => {
		await host(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			element.focus(); element.click();
		})()`);
		await sleep(50);
	};
	const setInput = async (selector, value) => {
		await host(`(() => {
			const input = document.querySelector(${JSON.stringify(selector)});
			const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await sleep(50);
	};

	async function run() {
		await app.whenReady();
		const compiled = path.join(projectRoot, "dist-electron");
		const load = (relative) => import(pathToFileURL(path.join(compiled, ...relative)).href);
		const { SourceService } = await load(["electron", "main", "source-service.js"]);
		const { AppStateStore } = await load(["electron", "main", "app-state-store.js"]);
		const {
			ipcChannels,
			validateIdRequest,
			validateSourceIndexingSaveRequest,
			validateSourceSearchRequest,
			validateAppStateSaveRequest,
		} = await load(["src", "shared", "ipc.js"]);
		const source = path.join(root, "Demonstration source");
		const data = path.join(root, "data");
		await Promise.all(
			["docs", "scratch", ".rhyza-debug"].map((directory) =>
				mkdir(path.join(source, directory), { recursive: true }),
			),
		);
		for (const segments of [
			["docs", "guide.md"],
			["scratch", "notes.md"],
			["generated.json"],
			[".rhyza-debug", "dump.json"],
		]) {
			await writeFile(path.join(source, ...segments), "catalogneedle");
		}
		let service = new SourceService(data, async () => source);
		const [indexed] = await service.add([source]);
		const states = new AppStateStore(data);
		await states.save(
			source,
			JSON.stringify({
				state: {
					sessions: [
						{ id: "saved-chat", parentId: null, title: "Saved chat", isRoot: true, status: "idle" },
					],
					turns: [
						{
							id: "saved-turn",
							sessionId: "saved-chat",
							role: "user",
							content: "Saved question",
							status: "complete",
							createdAt: "2026-10-12T00:00:00Z",
						},
					],
					entities: [
						{
							id: "saved-knowledge",
							name: "Saved knowledge",
							aliases: [],
							type: "Concept",
							summary: "Saved summary",
							content: "Saved content",
							confidence: "confirmed",
							sourceRefs: [{ sourceId: indexed.id, path: path.join("docs", "guide.md") }],
							version: 1,
							updatedAt: "2026-10-12T00:00:00Z",
						},
					],
					relations: [],
					diagrams: [],
					sources: [indexed],
					changesets: [],
					settings: { language: "en", theme: "light", reduceMotion: true },
				},
			}),
		);
		let getFailure = false;
		let saveFailure = false;
		let delaySave = false;
		let releaseSave;
		let removeFailure = false;
		let delayRemove = false;
		let releaseRemove;
		let removalCalls = 0;
		ipcMain.handle(ipcChannels.getWorkspace, () => ({ path: source }));
		ipcMain.handle(ipcChannels.sourceList, () => service.list());
		ipcMain.handle(ipcChannels.sourceSearch, (_event, request) =>
			service.search(validateSourceSearchRequest(request)),
		);
		ipcMain.handle(ipcChannels.sourceIndexingGet, (_event, request) => {
			if (getFailure) throw new Error("Unable to load indexing settings");
			return service.getIndexingConfig(validateIdRequest(request).id);
		});
		ipcMain.handle(ipcChannels.sourceIndexingSave, async (_event, request) => {
			if (saveFailure) throw new Error("Unable to save indexing settings");
			if (delaySave)
				await new Promise((resolve) => {
					releaseSave = resolve;
				});
			return service.saveIndexingConfig(validateSourceIndexingSaveRequest(request));
		});
		ipcMain.handle(ipcChannels.sourceRemove, async (_event, request) => {
			const { id } = validateIdRequest(request);
			removalCalls += 1;
			if (removeFailure) throw new Error("Unable to remove source");
			if (delayRemove)
				await new Promise((resolve) => {
					releaseRemove = resolve;
				});
			await service.remove(id);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.appStateLoad, () => states.load(source));
		ipcMain.handle(ipcChannels.appStateSave, async (_event, payload) => {
			const request = validateAppStateSaveRequest(payload);
			await states.save(
				request.workspacePath,
				typeof request.value === "string" ? request.value : JSON.stringify(request.value),
			);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.providerStatus, (_event, request) => ({
			providerId: request.providerId,
			configured: false,
		}));
		ipcMain.handle(ipcChannels.modelCatalog, () => ({ models: [], configured: false }));
		ipcMain.handle(ipcChannels.composerSkills, () => []);
		ipcMain.handle(ipcChannels.diagnosticReport, () => ({ ok: true }));
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
		});
		await server.listen();
		browser = new BrowserWindow({
			show: false,
			width: 1280,
			height: 860,
			useContentSize: true,
			webPreferences: {
				preload: path.join(projectRoot, "electron", "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/#/sources`);
		await until(
			'Boolean(document.querySelector(".source-index-settings-open"))',
			"source settings action",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		const opener = ".source-index-settings-open";
		const scratch = '.source-excluded-directories input[value="scratch"]';
		const patterns = "#source-exclude-patterns";
		const save = ".source-index-settings-footer .command-button";
		const cancel = ".source-index-settings-footer .secondary-button";
		const open = async () => {
			await click(opener);
			await until(
				'document.querySelector(".source-index-settings")?.open',
				"index settings dialog",
			);
			await until(
				'Boolean(document.querySelector("#source-exclude-patterns"))',
				"configuration loaded",
			);
		};
		await open();
		assert.equal(
			await host(
				'document.querySelector(".source-excluded-directories input[value=\\".rhyza-debug\\"]").checked',
			),
			true,
		);
		assert.equal(
			await host(
				'document.querySelector(".source-excluded-directories input[value=\\".rhyza-debug\\"]").disabled',
			),
			true,
		);
		assert.equal(await host(`document.querySelector(${JSON.stringify(scratch)}).checked`), false);
		await click(scratch);
		await setInput(patterns, "*.json");
		await click(cancel);
		await until('!document.querySelector(".source-index-settings")', "cancel closes");
		assert.deepEqual(
			(await service.getIndexingConfig(indexed.id)).excludedDirectories,
			[],
			"cancel does not persist",
		);
		assert.equal(
			await host(`document.activeElement === document.querySelector(${JSON.stringify(opener)})`),
			true,
		);

		await setInput("#sources-query", "catalogneedle");
		await host(
			'document.querySelector(".sources-search").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))',
		);
		await until(
			'document.querySelectorAll(".sources-search-hit").length === 3',
			"initial indexed files are searchable",
		);
		await open();
		assert.equal(await host(`document.querySelector(${JSON.stringify(scratch)}).checked`), false);
		await click(scratch);
		await setInput(patterns, "*.json");
		saveFailure = true;
		await click(save);
		await until(
			'Boolean(document.querySelector(".source-index-settings-error"))',
			"save failure shown",
		);
		assert.deepEqual((await service.getIndexingConfig(indexed.id)).excludedDirectories, []);
		assert.equal(
			await host(`document.querySelector(${JSON.stringify(scratch)}).checked`),
			true,
			"failed save retains the draft",
		);
		saveFailure = false;
		delaySave = true;
		await click(save);
		await until(
			'[...document.querySelectorAll(".source-index-settings button, .source-index-settings input, .source-index-settings textarea")].every(element => element.disabled)',
			"saving locks controls",
		);
		await host(
			'document.querySelector(".source-index-settings").dispatchEvent(new Event("cancel", { cancelable: true }))',
		);
		assert.equal(await host('document.querySelector(".source-index-settings").open'), true);
		delaySave = false;
		releaseSave();
		await until('!document.querySelector(".source-index-settings")', "successful save closes");
		assert.equal((await service.list())[0].fileCount, 1);
		assert.equal(
			await host('document.querySelector(".source-metadata").textContent.includes("1 text file")'),
			true,
		);
		assert.equal(await host('document.querySelector("#sources-query").value'), "");
		assert.equal(
			await host('Boolean(document.querySelector(".sources-results"))'),
			false,
			"save clears stale search results",
		);
		assert.deepEqual(
			(await service.search({ query: "catalogneedle" })).map((hit) => hit.path),
			[path.join("docs", "guide.md")],
		);
		service = new SourceService(data, async () => source);
		await browser.reload();
		await until('Boolean(document.querySelector(".source-index-settings-open"))', "page reload");
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		await open();
		assert.equal(
			await host(`document.querySelector(${JSON.stringify(scratch)}).checked`),
			true,
			"directory selection persists",
		);
		assert.equal(await host(`document.querySelector(${JSON.stringify(patterns)}).value`), "*.json");
		await click(".source-index-settings-header button");

		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			browser.setContentSize(760, 640);
			await open();
			assert.equal(
				await host(`(() => {
				const rect = document.querySelector(".source-index-settings").getBoundingClientRect();
				return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
			})()`),
				true,
				`${theme}: settings fit a narrow desktop window`,
			);
			assert.equal(
				await host(`(() => {
				const button = document.querySelector(${JSON.stringify(save)});
				return button.scrollWidth <= button.clientWidth && getComputedStyle(button).whiteSpace === "nowrap";
			})()`),
				true,
				`${theme}: save label fits`,
			);
			const contrast = await host(`(() => {
				const style = getComputedStyle(document.querySelector(${JSON.stringify(save)}));
				const luminance = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
					.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
					.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
				const text = luminance(style.color), background = luminance(style.backgroundColor);
				return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
			})()`);
			assert.ok(contrast >= 4.5, `${theme}: readable save text`);
			await host(`document.querySelector(${JSON.stringify(save)}).focus()`);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
			await sleep(40);
			assert.equal(
				await host(
					'document.querySelector(".source-index-settings").contains(document.activeElement)',
				),
				true,
			);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
			await until('!document.querySelector(".source-index-settings")', "escape closes settings");
		}
		browser.setContentSize(1280, 860);
		getFailure = true;
		await click(opener);
		await until(
			'Boolean(document.querySelector(".source-index-settings-error button"))',
			"load failure offers retry",
		);
		getFailure = false;
		await click(".source-index-settings-error button");
		await until(
			'Boolean(document.querySelector("#source-exclude-patterns"))',
			"configuration retry",
		);
		await click(scratch);
		await setInput(patterns, "!docs/");
		await click(save);
		await until(
			'document.querySelector(".source-index-settings-error")?.textContent.includes("exclusion settings")',
			"include rules rejected",
		);
		await setInput(patterns, "");
		await click(save);
		await until('!document.querySelector(".source-index-settings")', "clear exclusions");
		assert.equal((await service.list())[0].fileCount, 3);

		const removeOpener = ".source-remove-button";
		const confirmRemove = ".source-removal-footer .command-button";
		const cancelRemove = ".source-removal-footer .secondary-button";
		const history = await host(`(() => {
			const state = window.uiStore.getState();
			return JSON.stringify({ sessions: state.sessions, turns: state.turns, entities: state.entities,
				relations: state.relations, diagrams: state.diagrams });
		})()`);
		assert.equal(await host(`document.querySelector("${removeOpener}").title`), "Delete source");
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			browser.setContentSize(760, 640);
			await click(removeOpener);
			await until('document.querySelector(".source-removal-dialog")?.open', "delete confirmation");
			assert.equal(
				await host(
					'document.querySelector("#source-removal-description").textContent.includes("Files on disk will not be deleted.")',
				),
				true,
			);
			assert.equal(
				await host(
					'document.querySelector(".source-removal-body").textContent.includes("Existing chats and knowledge are kept.")',
				),
				true,
			);
			assert.equal(
				await host(`(() => {
					const rect = document.querySelector(".source-removal-dialog").getBoundingClientRect();
					return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
				})()`),
				true,
				`${theme}: deletion confirmation fits a narrow window`,
			);
			const contrast = await host(`(() => {
				const style = getComputedStyle(document.querySelector(${JSON.stringify(confirmRemove)}));
				const luminance = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
					.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
					.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
				const text = luminance(style.color), background = luminance(style.backgroundColor);
				return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
			})()`);
			assert.ok(contrast >= 4.5, `${theme}: readable delete button`);
			await host(`document.querySelector(${JSON.stringify(confirmRemove)}).focus()`);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
			await sleep(40);
			assert.equal(
				await host(
					'document.querySelector(".source-removal-dialog").contains(document.activeElement)',
				),
				true,
				"confirmation traps keyboard focus",
			);
			if (theme === "light") await click(cancelRemove);
			else browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
			await until(
				'!document.querySelector(".source-removal-dialog")',
				"cancel closes delete confirmation",
			);
			assert.equal(
				await host(`document.activeElement === document.querySelector("${removeOpener}")`),
				true,
			);
			assert.equal(removalCalls, 0, "opening and canceling never removes a source");
			assert.equal((await service.list()).length, 1);
		}
		browser.setContentSize(1280, 860);
		await setInput("#sources-query", "catalogneedle");
		await host(
			'document.querySelector(".sources-search").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))',
		);
		await until(
			'document.querySelectorAll(".sources-search-hit").length === 3',
			"search before removal",
		);
		removeFailure = true;
		await click(removeOpener);
		await click(confirmRemove);
		await until(
			'document.querySelector(".source-removal-error")?.textContent.includes("Unable to remove source")',
			"removal failure is visible",
		);
		assert.equal((await service.list()).length, 1, "failed removal preserves registration");
		assert.equal(await host('document.querySelector(".source-removal-dialog").open'), true);
		assert.equal(await host('document.querySelectorAll(".sources-search-hit").length'), 3);
		removeFailure = false;
		delayRemove = true;
		await click(confirmRemove);
		await until(
			'[...document.querySelectorAll(".source-removal-dialog button")].every(button => button.disabled)',
			"removal locks controls",
		);
		await host(`document.querySelector(${JSON.stringify(confirmRemove)}).click()`);
		await host(
			'document.querySelector(".source-removal-dialog").dispatchEvent(new Event("cancel", { cancelable: true }))',
		);
		assert.equal(await host('document.querySelector(".source-removal-dialog").open'), true);
		assert.equal(removalCalls, 2, "removal cannot submit twice");
		delayRemove = false;
		releaseRemove();
		await until(
			'!document.querySelector(".source-removal-dialog") && !document.querySelector(".source-remove-button")',
			"successful removal clears the row",
		);
		assert.equal(await host('document.querySelector("#sources-query").value'), "");
		assert.equal(await host('Boolean(document.querySelector(".sources-results"))'), false);
		assert.deepEqual(await service.list(), []);
		for (const segments of [
			["docs", "guide.md"],
			["scratch", "notes.md"],
			["generated.json"],
			[".rhyza-debug", "dump.json"],
		]) {
			assert.equal(await readFile(path.join(source, ...segments), "utf8"), "catalogneedle");
		}
		assert.equal(
			await host(`(() => {
			const state = window.uiStore.getState();
			return JSON.stringify({ sessions: state.sessions, turns: state.turns, entities: state.entities,
				relations: state.relations, diagrams: state.diagrams });
		})()`),
			history,
			"removal leaves all historical data intact",
		);
		const saved = JSON.parse(states.load(source));
		saved.state.sources = [indexed];
		await states.save(source, JSON.stringify(saved));
		service = new SourceService(data, async () => source);
		await browser.reload();
		await until(
			'document.querySelector(".sources-empty-state h2")?.textContent === "No sources yet"',
			"catalog replaces stale source registrations after reload",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		assert.deepEqual(await service.list(), []);
		assert.equal(await host("window.uiStore.getState().sources.length"), 0);
		assert.equal(
			await host("window.uiStore.getState().entities[0].sourceRefs[0].sourceId"),
			indexed.id,
		);
		assert.equal(await host("window.uiStore.getState().sessions[0].id"), "saved-chat");
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
