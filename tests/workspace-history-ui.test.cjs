const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { spawn } = require("node:child_process");
	const test = require("node:test");
	test(
		"workspace picker uses persisted history, real preload IPC and isolated workspace state",
		{ timeout: 120_000 },
		async () => {
			const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-workspace-picker-"));
			const env = {
				...process.env,
				RHYZA_WORKSPACE_PICKER_TEST: root,
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
	const { app, BrowserWindow, dialog, ipcMain } = require("electron");
	const root = process.env.RHYZA_WORKSPACE_PICKER_TEST;
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
			const button = document.querySelector(${JSON.stringify(selector)});
			button.focus();
			button.click();
		})()`);
		await sleep(50);
	};

	async function run() {
		await app.whenReady();
		const compiled = path.join(projectRoot, "dist-electron");
		const { SettingsStore } = await import(
			pathToFileURL(path.join(compiled, "electron", "main", "settings-store.js")).href
		);
		const { AppStateStore } = await import(
			pathToFileURL(path.join(compiled, "electron", "main", "app-state-store.js")).href
		);
		const { ipcChannels, validateWorkspaceSwitchRequest, validateAppStateSaveRequest } =
			await import(pathToFileURL(path.join(compiled, "src", "shared", "ipc.js")).href);
		const data = path.join(root, "data");
		const first = path.join(root, "Research notes");
		const second = path.join(root, "Project handbook");
		const added = path.join(root, "New workspace");
		const missing = path.join(root, "Removed workspace");
		await Promise.all([mkdir(data), mkdir(first), mkdir(second), mkdir(added)]);
		await writeFile(
			path.join(data, "settings.json"),
			JSON.stringify({
				workspacePath: first,
				workspaceHistory: [
					{ path: first, lastUsedAt: "2026-10-12T00:00:00.000Z" },
					{ path: second, lastUsedAt: "2026-10-11T00:00:00.000Z" },
					{ path: missing, lastUsedAt: "2026-10-10T00:00:00.000Z" },
				],
			}),
		);
		let settings = new SettingsStore(data);
		const states = new AppStateStore(data);
		const state = (id) =>
			JSON.stringify({
				state: {
					sessions: [{ id, parentId: null, title: id, isRoot: true, status: "idle" }],
					activeSessionId: id,
					turns: [],
					entities: [],
					relations: [],
					diagrams: [],
					sources: [],
					changesets: [],
					settings: { language: "en", theme: "light", reduceMotion: true },
				},
			});
		await states.save(first, state("first-chat"));
		await states.save(second, state("second-chat"));
		let nativePickerCalls = 0;
		let nextSelection = null;
		let historyFailure = false;
		let delayHistory = false;
		let releaseHistory;
		let delaySwitch = false;
		let releaseSwitch;
		let releaseSearch;
		const originalDialog = dialog.showOpenDialog;
		dialog.showOpenDialog = async () => {
			nativePickerCalls++;
			return { canceled: nextSelection === null, filePaths: nextSelection ? [nextSelection] : [] };
		};
		ipcMain.handle(ipcChannels.getWorkspace, async () => ({
			path: await settings.getWorkspacePath(),
		}));
		ipcMain.handle(ipcChannels.workspaceHistory, async () => {
			if (historyFailure) throw new Error("History read failed");
			if (delayHistory)
				await new Promise((resolve) => {
					releaseHistory = resolve;
				});
			return settings.getWorkspaceHistory();
		});
		ipcMain.handle(ipcChannels.switchWorkspace, async (_event, payload) => {
			if (delaySwitch)
				await new Promise((resolve) => {
					releaseSwitch = resolve;
				});
			await settings.switchWorkspace(validateWorkspaceSwitchRequest(payload).path);
			return { path: await settings.getWorkspacePath() };
		});
		ipcMain.handle(ipcChannels.selectWorkspace, async () => {
			const selection = await dialog.showOpenDialog(browser, {
				properties: ["openDirectory", "createDirectory"],
			});
			if (!selection.canceled && selection.filePaths[0])
				await settings.setWorkspacePath(selection.filePaths[0]);
			return { path: await settings.getWorkspacePath() };
		});
		ipcMain.on(ipcChannels.appStateLoad, (event) => {
			event.returnValue = states.load(settings.getWorkspacePathSync());
		});
		ipcMain.handle(ipcChannels.appStateSave, async (_event, payload) => {
			const request = validateAppStateSaveRequest(payload);
			await states.save(request.workspacePath, request.value);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.sourceList, () => []);
		ipcMain.handle(
			ipcChannels.sourceSearch,
			() =>
				new Promise((resolve) => {
					releaseSearch = resolve;
				}),
		);
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
			if (event.level === "error" && !event.message.includes("History read failed"))
				errors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/#/sources`);
		await until('Boolean(document.querySelector(".sources-workspace-card"))', "workspace page");
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		await until(
			'document.querySelector(".sources-workspace-path").textContent.includes("Research notes")',
			"current workspace",
		);
		const opener = ".sources-workspace-card > button";
		const entry = (name) => `.workspace-picker-entry[title=${JSON.stringify(name)}]`;
		const open = async () => {
			await click(opener);
			await until('document.querySelector(".workspace-picker")?.open', "history dialog");
		};
		await open();
		await until(
			'document.querySelectorAll(".workspace-picker-entry").length === 3',
			"persisted history",
		);
		assert.equal(nativePickerCalls, 0, "opening history must not show the native picker");
		assert.equal(
			await host(
				'document.querySelector(".workspace-picker-entry.is-current").getAttribute("title")',
			),
			first,
		);
		assert.equal(
			await host('document.querySelector(".workspace-picker-entry.is-current").disabled'),
			true,
		);
		assert.equal(
			await host(
				'document.querySelector(".workspace-picker-header button") === document.activeElement',
			),
			true,
		);
		await host('document.querySelector(".workspace-picker-footer button").focus()');
		for (let index = 0; index < 5; index++) {
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
			await sleep(30);
			assert.equal(
				await host('document.querySelector(".workspace-picker").contains(document.activeElement)'),
				true,
				"keyboard focus remains inside the modal",
			);
		}
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until('!document.querySelector(".workspace-picker")', "escape dismisses dialog");
		assert.equal(
			await host(`document.activeElement === document.querySelector(${JSON.stringify(opener)})`),
			true,
			"closing restores trigger focus",
		);

		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			browser.setContentSize(760, 640);
			await open();
			await until(
				'document.querySelectorAll(".workspace-picker-entry").length === 3',
				"history in theme",
			);
			assert.equal(
				await host(`(() => {
				const rect = document.querySelector(".workspace-picker").getBoundingClientRect();
				return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
			})()`),
				true,
				`${theme}: dialog fits a narrow window`,
			);
			const contrasts = await host(`(() => {
				const luminance = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
					.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
					.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
				return [...document.querySelectorAll(".workspace-picker-footer button, .workspace-picker-entry.is-current")].map(element => {
					const style = getComputedStyle(element);
					const text = luminance(style.color), background = luminance(style.backgroundColor);
					return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
				});
			})()`);
			assert.ok(
				contrasts.every((contrast) => contrast >= 4.5),
				`${theme}: text contrast ${contrasts}`,
			);
			await click(".workspace-picker-header button");
		}
		browser.setContentSize(1280, 860);
		await open();
		await click(".workspace-picker-footer button");
		assert.equal(nativePickerCalls, 1, "only Add workspace opens a native picker");
		assert.equal(
			await host('Boolean(document.querySelector(".workspace-picker"))'),
			true,
			"cancel leaves history open",
		);
		assert.equal(
			await host("window.uiStore.getState().activeSessionId"),
			"first-chat",
			"cancel retains current state",
		);
		assert.equal(await settings.getWorkspacePath(), first);
		await click(entry(missing));
		await until(
			'Boolean(document.querySelector(".workspace-picker-error"))',
			"missing folder error",
		);
		assert.equal(await settings.getWorkspacePath(), first);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), "first-chat");
		await host(`(() => {
			const input = document.querySelector("#sources-query");
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "old workspace");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await sleep(50);
		await host(
			'document.querySelector(".sources-search").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))',
		);
		await until(
			'Boolean(document.querySelector(".sources-results[aria-busy=true]"))',
			"old workspace search",
		);
		delaySwitch = true;
		await click(entry(second));
		await until(
			'[...document.querySelectorAll(".workspace-picker button")].every(button => button.disabled)',
			"switch controls are disabled",
		);
		assert.equal(await host("window.uiStore.getState().activeSessionId"), "first-chat");
		await host(
			'document.querySelector(".workspace-picker").dispatchEvent(new Event("cancel", { cancelable: true }))',
		);
		assert.equal(
			await host('document.querySelector(".workspace-picker").open'),
			true,
			"busy dialog cannot dismiss",
		);
		delaySwitch = false;
		releaseSwitch();
		await until('!document.querySelector(".workspace-picker")', "successful switch closes");
		assert.equal(
			await host("window.uiStore.getState().activeSessionId"),
			"second-chat",
			"switch restores target chat state",
		);
		assert.equal(await settings.getWorkspacePath(), second);
		releaseSearch([
			{ sourceId: "old-source", path: "old-workspace.txt", line: 1, preview: "Old search result" },
		]);
		await sleep(100);
		assert.equal(
			await host('document.querySelector("#sources-query").value'),
			"",
			"workspace switch clears search input",
		);
		assert.equal(
			await host('Boolean(document.querySelector(".sources-results"))'),
			false,
			"late old-workspace search results are discarded",
		);
		settings = new SettingsStore(data);
		await open();
		await until(
			'document.querySelectorAll(".workspace-picker-entry").length === 3',
			"history after settings restart",
		);
		assert.equal(
			await host('document.querySelector(".workspace-picker-entry").getAttribute("title")'),
			second,
			"most recent is first",
		);
		nextSelection = added;
		await click(".workspace-picker-footer button");
		await until('!document.querySelector(".workspace-picker")', "added workspace closes");
		assert.equal(await settings.getWorkspacePath(), added);
		assert.equal(
			await host("window.uiStore.getState().sessions.length"),
			0,
			"new workspace has isolated empty state",
		);
		await open();
		await until(
			'document.querySelectorAll(".workspace-picker-entry").length === 4',
			"added workspace is remembered",
		);
		await click(entry(first));
		await until('!document.querySelector(".workspace-picker")', "return to initial workspace");
		assert.equal(await host("window.uiStore.getState().activeSessionId"), "first-chat");
		assert.equal(nativePickerCalls, 2, "history switches never use the native picker");

		historyFailure = true;
		await open();
		await until(
			'Boolean(document.querySelector(".workspace-picker-error button"))',
			"history read failure offers retry",
		);
		historyFailure = false;
		await click(".workspace-picker-error button");
		await until(
			'document.querySelectorAll(".workspace-picker-entry").length === 4',
			"history retry",
		);
		await click(".workspace-picker-header button");
		delayHistory = true;
		await open();
		await until(
			'Boolean(document.querySelector(".workspace-picker-history [role=status]"))',
			"loading state",
		);
		await click(".workspace-picker-header button");
		delayHistory = false;
		releaseHistory();
		await sleep(100);

		await writeFile(
			path.join(data, "settings.json"),
			JSON.stringify({ workspacePath: null, workspaceHistory: [] }),
		);
		settings = new SettingsStore(data);
		await open();
		await until(
			'document.querySelector(".workspace-picker-history > p")?.textContent.includes("No recent workspaces")',
			"empty state",
		);
		assert.equal(
			await host('document.querySelector(".workspace-picker-footer button").disabled'),
			false,
		);
		await click(".workspace-picker-header button");
		assert.ok(JSON.parse(await readFile(path.join(data, "settings.json"), "utf8")));
		assert.deepEqual(errors, []);
		dialog.showOpenDialog = originalDialog;
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
