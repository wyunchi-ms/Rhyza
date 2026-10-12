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
		"MCP desktop settings manage servers, permissions, trust and resource previews in both themes",
		{ timeout: 120_000 },
		async () => {
			const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-mcp-ui-"));
			const env = {
				...process.env,
				RHYZA_MCP_UI_ROOT: root,
				RHYZA_TEST_NODE: process.execPath,
				PI_CODING_AGENT_DIR: path.join(root, "agent"),
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
	const root = process.env.RHYZA_MCP_UI_ROOT;
	app.setPath("userData", path.join(root, "profile"));
	app.on("window-all-closed", () => {});
	let browser;
	let vite;
	let service;
	const errors = [];
	const host = async (code) => {
		try {
			return await browser.webContents.executeJavaScript(code);
		} catch (error) {
			throw new Error(`Renderer script failed: ${code}\n${errors.join("\n")}`, { cause: error });
		}
	};
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const until = async (code, label) => {
		for (let index = 0; index < 200; index++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(
			`Timed out: ${label}\n${await host('document.querySelector(".mcp-settings")?.textContent')}`,
		);
	};
	const click = async (selector) => {
		await until(
			`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
			`enabled ${selector}`,
		);
		await host(`document.querySelector(${JSON.stringify(selector)}).click()`);
		await sleep(50);
	};
	const field = async (label, value) => {
		await until(
			`[...document.querySelectorAll(".mcp-settings label")].some(item => item.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)} && item.querySelector("input,textarea,select") && !item.querySelector("input,textarea,select").matches(":disabled"))`,
			`editable ${label}`,
		);
		await host(`(() => {
			const label = [...document.querySelectorAll(".mcp-settings label")].find(item => item.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)});
			const input = label.querySelector("input,textarea,select");
			const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
		})()`);
		await sleep(40);
	};
	const textButton = async (text, scope = ".mcp-settings") => {
		await until(
			`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].some(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled)`,
			`enabled ${text}`,
		);
		await host(
			`(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(item => item.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error("Missing button"); button.click(); })()`,
		);
		await sleep(50);
	};
	async function run() {
		await app.whenReady();
		const load = (...segments) =>
			import(pathToFileURL(path.join(projectRoot, "dist-electron", ...segments)).href);
		const { McpService } = await load("electron", "main", "mcp-service.js");
		const { ipcChannels } = await load("src", "shared", "ipc.js");
		const { validateMcpSave, validateMcpTarget, validateMcpAction, validateMcpResource } =
			await load("src", "shared", "mcp.js");
		const workspace = root;
		service = new McpService(path.join(root, "agent"), path.join(root, "data"), (event) =>
			browser?.webContents.send(ipcChannels.mcpEvent, event),
		);
		let saveFailure = false;
		let removeFailure = false;
		ipcMain.handle(ipcChannels.mcpList, () => service.overview(workspace));
		ipcMain.handle(ipcChannels.mcpEdit, (_event, request) =>
			service.edit(workspace, validateMcpTarget(request)),
		);
		ipcMain.handle(ipcChannels.mcpSave, async (_event, request) => {
			if (saveFailure) throw new Error("Fixture save failure");
			await service.save(workspace, validateMcpSave(request));
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpRemove, async (_event, request) => {
			if (removeFailure) throw new Error("Fixture remove failure");
			await service.remove(workspace, validateMcpTarget(request));
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpTrust, async (_event, request) => {
			await service.trust(workspace, request.trusted);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpAction, async (_event, request) => {
			await service.action(workspace, validateMcpAction(request));
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpResources, (_event, request) =>
			service.resources(workspace, validateMcpResource(request)),
		);
		ipcMain.handle(ipcChannels.getWorkspace, () => ({ path: workspace }));
		ipcMain.handle(ipcChannels.sourceList, () => []);
		ipcMain.handle(ipcChannels.providerStatus, (_event, request) => ({
			providerId: request.providerId,
			configured: false,
		}));
		ipcMain.handle(ipcChannels.modelCatalog, () => ({ models: [], configured: false }));
		ipcMain.handle(ipcChannels.pluginList, () => []);
		ipcMain.handle(ipcChannels.composerSkills, () => []);
		ipcMain.handle(ipcChannels.diagnosticReport, () => ({ ok: true }));
		ipcMain.on(ipcChannels.appStateLoad, (event) => {
			event.returnValue = null;
		});
		ipcMain.handle(ipcChannels.appStateSave, () => ({ ok: true }));
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		vite = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
		});
		await vite.listen();
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
		await browser.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/#/settings`);
		await until(
			'Boolean(document.querySelector("[data-section=mcp-heading]"))',
			"MCP settings navigation",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; window.uiStore.getState().updateSettings({ language: "en", theme: "light", reduceMotion: true }); })',
		);
		await click("[data-section=mcp-heading]");
		await until('document.querySelector(".mcp-empty")', "empty state");
		await textButton("Add server");
		await field("Server name", "fixture");
		await field("Executable", process.env.RHYZA_TEST_NODE);
		await field(
			"Arguments",
			JSON.stringify([path.join(projectRoot, "tests", "fixtures", "mcp-server.mjs")]),
		);
		saveFailure = true;
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-error")?.textContent.includes("Fixture save failure")',
			"save failure visible",
		);
		assert.equal(
			await host('document.querySelector(".mcp-editor input").value'),
			"fixture",
			"Save failure retains draft.",
		);
		service.changed(workspace);
		await sleep(300);
		assert(
			await host(
				'document.querySelector(".mcp-error")?.textContent.includes("Fixture save failure")',
			),
			"A background refresh must not clear operation errors.",
		);
		saveFailure = false;
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"server connection",
		);
		assert.equal(await host('document.querySelector(".mcp-editor") === null'), true);
		await textButton("Tools & resources");
		await until('document.querySelectorAll(".mcp-tool").length === 5', "tool discovery");
		assert.equal(
			await host(
				'[...document.querySelectorAll(".mcp-tool select[aria-label$=Permission]")].every(input => input.value === "blocked")',
			),
			true,
			"Read-only annotations do not approve tools.",
		);
		await host(`(() => {
			const input = document.querySelector('[aria-label="echo Permission"]');
			Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(input, "read");
			input.dispatchEvent(new Event("change", { bubbles: true }));
		})()`);
		await textButton("Save tool settings");
		await until(
			'document.querySelector(\'[aria-label="echo Permission"]\')?.value === "read" && document.querySelector(".mcp-state")?.textContent === "Connected"',
			"approval persisted",
		);
		assert.equal(
			service.config.get(workspace, { name: "fixture", scope: "user" }).policy.tools.echo,
			"read",
		);
		await field("Tool exposure", "direct");
		await textButton("Save tool settings");
		await until(
			'document.querySelector(\'[aria-label="echo Tool exposure"]\')?.value === "direct" && document.querySelector(".mcp-state")?.textContent === "Connected"',
			"direct exposure saved",
		);
		assert.equal(
			service.config.get(workspace, { name: "fixture", scope: "user" }).config.toolExposure.echo,
			"direct",
		);
		await click(".mcp-resources summary");
		await textButton("List resources");
		await until(
			'document.querySelector(".mcp-resource-preview")?.textContent.includes("fixture://guide")',
			"resource list",
		);
		await field("Resource URI", "fixture://guide");
		await textButton("Read resource");
		await until(
			'document.querySelector(".mcp-resource-preview")?.textContent.includes("fixture resource text")',
			"resource preview",
		);
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme);
			for (const width of [375, 768, 1024, 1440]) {
				browser.setContentSize(width, 720);
				await sleep(80);
				assert(
					await host("document.documentElement.scrollWidth <= innerWidth + 1"),
					`MCP ${theme} layout fits ${width}px.`,
				);
				assert(
					await host('document.querySelector(".mcp-tools").getBoundingClientRect().width > 0'),
				);
			}
		}
		await host(
			'[...document.querySelectorAll(".mcp-settings button")].find(button => button.textContent.trim() === "Trust project").focus()',
		);
		await textButton("Trust project");
		await until('document.querySelector(".mcp-confirmation")?.open', "trust dialog");
		await textButton("Cancel", ".mcp-confirmation");
		assert.equal(service.config.snapshot(workspace).trusted, false);
		await until(
			'document.activeElement?.textContent.trim() === "Trust project"',
			"confirmation restores focus",
		);
		await textButton("Trust project");
		await textButton("Trust project", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-trust")?.textContent.includes("Revoke trust")',
			"trust applied",
		);
		await textButton("Disable");
		await until('document.querySelector(".mcp-state")?.textContent === "Disabled"', "disabled");
		await textButton("Enable");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"enabled again",
		);
		await click('[aria-label="Delete fixture"]');
		await until('document.querySelector(".mcp-confirmation")?.open', "remove dialog");
		removeFailure = true;
		await textButton("Delete", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-confirmation .mcp-error")?.textContent.includes("Fixture remove failure")',
			"delete error retains dialog",
		);
		assert.equal((await service.overview(workspace)).servers.length, 1);
		removeFailure = false;
		await textButton("Delete", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-empty") && !document.querySelector(".mcp-confirmation")',
			"removed and persisted",
		);
		assert.equal((await service.overview(workspace)).servers.length, 0);
		await textButton("Add server");
		await click(".mcp-editor details summary");
		await field("Configuration JSON", "{invalid");
		await textButton("Load configuration");
		await until('document.querySelector(".mcp-editor .mcp-error")', "invalid import");
		await field(
			"Configuration JSON",
			JSON.stringify({
				mcpServers: {
					imported: {
						command: process.env.RHYZA_TEST_NODE,
						args: [path.join(projectRoot, "tests", "fixtures", "mcp-server.mjs")],
					},
					another: { command: "not-loaded" },
				},
			}),
		);
		await textButton("Load configuration");
		await until(
			'document.querySelector(".mcp-editor .mcp-error")?.textContent.includes("Enter the server name")',
			"multiple server import requires selection",
		);
		await field("Server name to import", "imported");
		await textButton("Load configuration");
		await field("Configuration scope", "project");
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"imported project server",
		);
		assert.equal(
			service.config.get(workspace, { name: "imported", scope: "project" }).config.command,
			process.env.RHYZA_TEST_NODE,
		);
		await textButton("Revoke trust");
		await textButton("Revoke trust", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-empty")',
			"project servers disconnected after trust revocation",
		);
		assert.equal((await service.overview(workspace)).projectTrusted, false);
		assert.deepEqual(errors, []);
		console.log(
			"MCP_UI verified add/save errors, discovery, permissions, resources, themes, trust, enable/disable and delete errors.",
		);
	}
	run()
		.then(async () => {
			await service.dispose();
			browser?.destroy();
			await vite?.close();
			app.exit(0);
		})
		.catch(async (error) => {
			console.error(error);
			await service?.dispose();
			browser?.destroy();
			await vite?.close();
			app.exit(1);
		});
}
