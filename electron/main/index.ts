import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PiService } from "./pi-service.js";
import { SettingsStore } from "./settings-store.js";
import {
	ipcChannels,
	validateAgentPromptRequest,
	validateModelCatalogRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
} from "../../src/shared/ipc.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const isSmoke = process.env.KNOWBRANCH_ELECTRON_SMOKE === "1";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const smokeTimeoutMs = 15_000;
const smokeUserDataPath = isSmoke
	? path.join(app.getPath("temp"), `knowbranch-electron-smoke-${process.pid}`)
	: undefined;

if (smokeUserDataPath) {
	app.setPath("userData", smokeUserDataPath);
}

interface ElectronSmokeEvidence {
	title: string;
	bodyText: string;
	isElectron: boolean;
	bridgeKeys: string[];
}

let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore;
let piService: PiService;
let smokeTimeout: NodeJS.Timeout | undefined;
let allowedRendererUrls = new Set<string>();

async function createWindow(): Promise<void> {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 960,
		minHeight: 640,
		show: false,
		webPreferences: {
			preload: path.join(currentDirectory, "..", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	allowedRendererUrls = new Set([
		devServerUrl,
		pathToFileURL(
			path.join(currentDirectory, "..", "..", "..", "dist", "index.html"),
		).toString(),
	]);
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!isAllowedRendererUrl(url)) {
			event.preventDefault();
		}
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) =>
		isAllowedRendererUrl(url) ? { action: "allow" } : { action: "deny" },
	);

	mainWindow.once("ready-to-show", () => mainWindow?.show());
	if (isSmoke) {
		mainWindow.webContents.once("did-finish-load", () => {
			void runSmokeCheck(mainWindow!);
		});
	}

	if (isDev) {
		await waitForDevServer(devServerUrl);
		await mainWindow.loadURL(devServerUrl);
		if (!isSmoke) {
			mainWindow.webContents.openDevTools({ mode: "detach" });
		}
	} else {
		await mainWindow.loadFile(
			path.join(currentDirectory, "..", "..", "..", "dist", "index.html"),
		);
	}
}

function registerIpcHandlers(): void {
	ipcMain.handle(ipcChannels.providerStatus, async (event, payload) =>
		withValidSender(event, () =>
			piService.getProviderStatus(validateProviderStatusRequest(payload).providerId),
		),
	);
	ipcMain.handle(ipcChannels.providerLogin, async (event, payload) =>
		withValidSender(event, () =>
			piService.loginProvider(validateProviderLoginRequest(payload).providerId),
		),
	);
	ipcMain.handle(ipcChannels.providerLogout, async (event, payload) =>
		withValidSender(event, () =>
			piService.logoutProvider(validateProviderLogoutRequest(payload).providerId),
		),
	);
	ipcMain.handle(ipcChannels.modelCatalog, async (event, payload) =>
		withValidSender(event, () =>
			piService.getModelCatalog(validateModelCatalogRequest(payload)),
		),
	);
	ipcMain.handle(ipcChannels.getWorkspace, async (event) =>
		withValidSender(event, async () => ({
			path: await settingsStore.getWorkspacePath(),
		})),
	);
	ipcMain.handle(ipcChannels.selectWorkspace, async (event) =>
		withValidSender(event, async () => {
			const selection = await dialog.showOpenDialog(mainWindow!, {
				properties: ["openDirectory"],
				title: "Select KnowBranch workspace",
			});
			if (!selection.canceled && selection.filePaths[0]) {
				await settingsStore.setWorkspacePath(selection.filePaths[0]);
			}
			return { path: await settingsStore.getWorkspacePath() };
		}),
	);
	ipcMain.handle(ipcChannels.agentPrompt, async (event, payload) =>
		withValidSender(event, async () =>
			piService.promptAgent(
				validateAgentPromptRequest(payload),
				await settingsStore.requireWorkspacePath(),
			),
		),
	);
}

async function withValidSender<T>(
	event: IpcMainInvokeEvent,
	action: () => Promise<T> | T,
): Promise<T> {
	if (!event.senderFrame || !isAllowedRendererUrl(event.senderFrame.url)) {
		throw new Error("IPC sender is not an allowed renderer URL.");
	}
	return action();
}

function isAllowedRendererUrl(url: string): boolean {
	if (isDev) {
		return (
			url === devServerUrl ||
			url.startsWith(`${devServerUrl}/`) ||
			url.startsWith(`${devServerUrl}#`)
		);
	}
	return [...allowedRendererUrls].some(
		(allowedUrl) => url === allowedUrl || url.startsWith(`${allowedUrl}#`),
	);
}

app.whenReady().then(async () => {
	if (isSmoke) {
		smokeTimeout = setTimeout(() => {
			console.error("ELECTRON_SMOKE timeout waiting for renderer load");
			app.exit(1);
		}, smokeTimeoutMs).unref();
	}
	settingsStore = new SettingsStore(app.getPath("userData"));
	piService = new PiService(
		app.getPath("userData"),
		(event) => mainWindow?.webContents.send(ipcChannels.authEvent, event),
		(event) => mainWindow?.webContents.send(ipcChannels.agentEvent, event),
	);
	registerIpcHandlers();
	await createWindow();

	app.on("activate", async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			await createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

async function waitForDevServer(url: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {
			// Vite is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

async function runSmokeCheck(window: BrowserWindow): Promise<void> {
	try {
		const evidence = (await window.webContents.executeJavaScript(
			`(async () => {
				const deadline = Date.now() + ${smokeTimeoutMs - 1_000};
				while (Date.now() < deadline) {
					const evidence = {
						title: document.title,
						bodyText: document.body?.innerText?.slice(0, 200) ?? '',
						isElectron: window.knowbranch?.isElectron === true,
						bridgeKeys: Object.keys(window.knowbranch ?? {}).sort(),
					};
					if (evidence.bodyText.trim() && evidence.isElectron) return evidence;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return {
					title: document.title,
					bodyText: document.body?.innerText?.slice(0, 200) ?? '',
					isElectron: window.knowbranch?.isElectron === true,
					bridgeKeys: Object.keys(window.knowbranch ?? {}).sort(),
				};
			})()`,
			true,
		)) as ElectronSmokeEvidence;
		if (!evidence.bodyText.trim()) {
			throw new Error("Renderer body did not render text.");
		}
		if (!evidence.isElectron) {
			throw new Error(
				`window.knowbranch.isElectron was not true; evidence=${JSON.stringify(evidence)}`,
			);
		}
		console.log(`ELECTRON_SMOKE ${JSON.stringify(evidence)}`);
		clearSmokeTimeout();
		app.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`ELECTRON_SMOKE failed: ${message}`);
		clearSmokeTimeout();
		app.exit(1);
	}
}

function clearSmokeTimeout(): void {
	if (smokeTimeout) {
		clearTimeout(smokeTimeout);
		smokeTimeout = undefined;
	}
}
