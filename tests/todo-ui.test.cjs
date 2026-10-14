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
		"workspace TODO clicks and keyboard edits persist through preload and backend RPC",
		{ timeout: 120_000 },
		async () => {
			const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-todo-ui-"));
			const env = {
				...process.env,
				RHYZA_TODO_UI_TEST: root,
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
				await rm(root, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow, ipcMain } = require("electron");
	const root = process.env.RHYZA_TODO_UI_TEST;
	app.setPath("userData", path.join(root, "profile"));
	app.on("window-all-closed", () => {});
	let backend;
	let server;
	let browser;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(`Timed out: ${label}`);
	};

	async function run() {
		await app.whenReady();
		const compiled = path.join(projectRoot, "dist-electron");
		const { BackendService } = await import(
			pathToFileURL(path.join(compiled, "electron", "main", "backend-service.js")).href
		);
		const { ipcChannels, validateWorkspaceTodosRequest, validateWorkspaceTodoUpdateRequest } =
			await import(pathToFileURL(path.join(compiled, "src", "shared", "ipc.js")).href);
		const workspace = path.join(root, "workspace");
		await mkdir(workspace);
		const original = "# Delivery\r\n- [ ] Parent\r\n  - [ ] Child\r\n";
		const file = path.join(workspace, "TODO.md");
		await writeFile(file, original);
		backend = new BackendService(
			{ dataRoot: path.join(root, "data"), home: root, agentDir: path.join(root, "agent") },
			{
				openUrl: async () => {
					throw new Error("Unexpected external URL.");
				},
			},
			() => {},
		);
		await backend.ready;
		let saveFailure = false;
		let delaySave = false;
		let releaseSave;
		let writes = 0;
		ipcMain.handle(ipcChannels.workspaceTodos, (_event, payload) => {
			const request = validateWorkspaceTodosRequest(payload);
			return backend.agent.getWorkspaceTodos(request.frontendSessionId, workspace);
		});
		ipcMain.handle(ipcChannels.workspaceTodoUpdate, async (_event, payload) => {
			writes++;
			const request = validateWorkspaceTodoUpdateRequest(payload);
			if (delaySave)
				await new Promise((resolve) => {
					releaseSave = resolve;
				});
			if (saveFailure) throw new Error("Synthetic disk permission failure");
			return backend.agent.updateWorkspaceTodo(request, workspace);
		});
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		const page = `<!doctype html><html><body><div id="root"></div>
			<script type="module">
				import React from "react";
				import { createRoot } from "react-dom/client";
				import { KnowledgePane } from "/src/components/KnowledgePane.tsx";
				import { useAppStore } from "/src/store/index.ts";
				import "/src/index.css";
				window.uiStore = useAppStore;
				useAppStore.setState({ rightPaneOpen: true, rightPaneView: "todo", activeSessionId: "test-chat" });
				createRoot(document.getElementById("root")).render(React.createElement(KnowledgePane));
			</script></body></html>`;
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
			plugins: [
				{
					name: "todo-regression",
					configureServer(vite) {
						vite.middlewares.use("/__todo-test", async (_request, response, next) => {
							try {
								response.setHeader("Content-Type", "text/html");
								response.end(await vite.transformIndexHtml("/__todo-test", page));
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
			height: 800,
			webPreferences: {
				preload: path.join(projectRoot, "electron", "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__todo-test`);
		await until('document.querySelectorAll(".workspace-todo-node").length === 2', "TODO rows");
		delaySave = true;
		await host('document.querySelector(".workspace-todo-node").click()');
		await until(
			'document.querySelector(".workspace-todo-node").getAttribute("aria-busy") === "true"',
			"pending save",
		);
		assert.equal(await readFile(file, "utf8"), original);
		assert.equal(
			await host(
				'[...document.querySelectorAll(".workspace-todo-node")].every(button => button.disabled)',
			),
			true,
		);
		await host('document.querySelector(".workspace-todo-node").click()');
		assert.equal(writes, 1);
		delaySave = false;
		releaseSave();
		await until(
			'document.querySelector(".workspace-todo-node").getAttribute("aria-checked") === "true" && !document.querySelector(".workspace-todo-node").disabled',
			"saved checkbox",
		);
		assert.equal(
			await host(
				'document.querySelectorAll(".workspace-todo-status, .workspace-todo-line").length',
			),
			0,
			"TODO rows do not show redundant status badges or source line numbers",
		);
		assert.equal(
			await host('document.querySelector(".workspace-todo-node").textContent.trim()'),
			"Parent",
		);
		assert.equal(await readFile(file, "utf8"), original.replace("[ ] Parent", "[x] Parent"));
		assert.equal(
			await host(
				'document.querySelectorAll(".workspace-todo-node")[1].getAttribute("aria-checked")',
			),
			"false",
		);
		assert.equal(
			await host('document.querySelector(".workspace-todo-progress strong").textContent.trim()'),
			"1 of 2 completed",
		);

		await host('document.querySelector(".workspace-todo-node").focus()');
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
		browser.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
		await until(
			'document.querySelector(".workspace-todo-node").getAttribute("aria-checked") === "false" && !document.querySelector(".workspace-todo-node").disabled',
			"keyboard uncheck",
		);
		assert.equal(await readFile(file, "utf8"), original);

		saveFailure = true;
		await host('document.querySelector(".workspace-todo-node").click()');
		await until(
			'document.querySelector("[role=alert]")?.textContent.includes("disk permission failure")',
			"save error",
		);
		assert.equal(
			await host('document.querySelector(".workspace-todo-node").getAttribute("aria-checked")'),
			"false",
		);
		assert.equal(await readFile(file, "utf8"), original);
		saveFailure = false;
		await writeFile(file, original.replace("Parent", "Updated parent"));
		await host('document.querySelector(".workspace-todo-node").click()');
		await until(
			'document.querySelector("[role=alert]")?.textContent.includes("changed on disk")',
			"conflict error",
		);
		assert.equal(await readFile(file, "utf8"), original.replace("Parent", "Updated parent"));
		await host('document.querySelector(".workspace-todo-actions button").click()');
		await until(
			'document.querySelector(".workspace-todo-node span").textContent === "Updated parent"',
			"refresh conflict",
		);
		await host('document.querySelectorAll(".workspace-todo-node")[1].click()');
		await until(
			'document.querySelectorAll(".workspace-todo-node")[1].getAttribute("aria-checked") === "true"',
			"nested checkbox",
		);
		assert.equal(
			await readFile(file, "utf8"),
			original.replace("Parent", "Updated parent").replace("[ ] Child", "[x] Child"),
		);
		assert.equal(await host('document.querySelector("[role=alert]") === null'), true);

		await new Promise((resolve) => {
			browser.webContents.once("did-finish-load", resolve);
			browser.reload();
		});
		await until(
			'document.querySelectorAll(".workspace-todo-node")[1]?.getAttribute("aria-checked") === "true"',
			"persisted reload",
		);
	}

	run()
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		})
		.finally(async () => {
			if (browser && !browser.isDestroyed()) browser.destroy();
			if (server) await server.close();
			if (backend) await backend.dispose();
			app.exit(process.exitCode || 0);
		});
}
