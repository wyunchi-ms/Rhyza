import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PiService } from "./pi-service.js";
import { SettingsStore } from "./settings-store.js";
import { SourceService } from "./source-service.js";
import {
	ipcChannels,
	validateAgentPromptRequest,
	validateModelCatalogRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
	validateIdRequest,
	validateSourceSearchRequest,
	validateWorkspaceDiffRequest,
	validateSummaryRequest,
	validateKnowledgeExtractionRequest,
	validateOpenExternalRequest,
	validateAppStateSaveRequest,
} from "../../src/shared/ipc.js";
import { AppStateStore } from "./app-state-store.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const isSmoke = process.env.KNOWBRANCH_ELECTRON_SMOKE === "1";
setDefaultResultOrder("ipv4first");

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const smokeTimeoutMs = 15_000;
const legacyUserDataPath = app.getPath("userData");
const dataRootPath = path.join(app.getPath("home"), ".pi-graph");
const smokeUserDataPath = isSmoke
	? path.join(app.getPath("temp"), `knowbranch-electron-smoke-${process.pid}`)
	: undefined;
app.setName("PiGraph");
app.setPath("userData", smokeUserDataPath ?? path.join(app.getPath("appData"), "PiGraph"));
const ownsSingleInstanceLock = isSmoke || app.requestSingleInstanceLock();

interface ElectronSmokeEvidence {
	title: string;
	bodyText: string;
	isElectron: boolean;
	bridgeKeys: string[];
	stateBytes: number;
	stateSessions: number;
	stateTurns: number;
	knowledgeReferenceCount: number;
}

let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore;
let piService: PiService;
let sourceService: SourceService;
let appStateStore: AppStateStore;
let smokeTimeout: NodeJS.Timeout | undefined;
let allowedRendererUrls = new Set<string>();

if (!ownsSingleInstanceLock) {
	app.quit();
} else if (!isSmoke) {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	});
}

async function createWindow(): Promise<void> {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 760,
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
	ipcMain.on(ipcChannels.appStateLoad, (event) => {
		// This synchronous read can arrive before Electron has attached senderFrame.
		// The preload is scoped to our BrowserWindow, so validate its webContents instead.
		if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
			event.returnValue = null;
			return;
		}
		const workspacePath = settingsStore.getWorkspacePathSync();
		const value = appStateStore.load(workspacePath);
		if (process.env.KNOWBRANCH_STATE_DEBUG === "1") {
			console.log("APP_STATE_LOAD", { workspacePath, bytes: value?.length ?? 0 });
		}
		event.returnValue = value;
	});
	ipcMain.handle(ipcChannels.appStateSave, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateAppStateSaveRequest(payload);
			if (process.env.KNOWBRANCH_STATE_DEBUG === "1") {
				console.log("APP_STATE_SAVE", { workspacePath: request.workspacePath, bytes: request.value.length });
			}
			await appStateStore.save(request.workspacePath, request.value);
			return { ok: true as const };
		}),
	);
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
	ipcMain.handle(ipcChannels.sourceList, async (event) =>
		withValidSender(event, () => sourceService.list()),
	);
	ipcMain.handle(ipcChannels.sourceAdd, async (event) =>
		withValidSender(event, async () => {
			const selection = await dialog.showOpenDialog(mainWindow!, {
				properties: ["openDirectory", "multiSelections"],
				title: "Add code or documentation sources",
			});
			return selection.canceled ? [] : sourceService.add(selection.filePaths);
		}),
	);
	ipcMain.handle(ipcChannels.sourceRefresh, async (event, payload) =>
		withValidSender(event, () => sourceService.refresh(validateIdRequest(payload).id)),
	);
	ipcMain.handle(ipcChannels.sourceArchive, async (event, payload) =>
		withValidSender(event, () => sourceService.archive(validateIdRequest(payload).id)),
	);
	ipcMain.handle(ipcChannels.sourceSearch, async (event, payload) =>
		withValidSender(event, () => sourceService.search(validateSourceSearchRequest(payload))),
	);
	ipcMain.handle(ipcChannels.workspaceDiff, async (event, payload) =>
		withValidSender(event, () =>
			piService.getWorkspaceDiff(validateWorkspaceDiffRequest(payload).frontendSessionId),
		),
	);
	ipcMain.handle(ipcChannels.workspaceExportPatch, async (event, payload) =>
		withValidSender(event, async () => {
			const diff = await piService.getWorkspaceDiff(validateWorkspaceDiffRequest(payload).frontendSessionId);
			const selection = await dialog.showSaveDialog(mainWindow!, {
				title: "Export session patch",
				defaultPath: "knowbranch-session.patch",
				filters: [{ name: "Git patch", extensions: ["patch", "diff"] }],
			});
			if (selection.canceled || !selection.filePath) return { canceled: true };
			await writeFile(selection.filePath, diff.diff, "utf8");
			return { canceled: false, path: selection.filePath };
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
	ipcMain.handle(ipcChannels.generateSummary, async (event, payload) =>
		withValidSender(event, async () =>
			piService.generateSummary(
				validateSummaryRequest(payload),
				await settingsStore.requireWorkspacePath(),
			),
		),
	);
	ipcMain.handle(ipcChannels.extractKnowledge, async (event, payload) =>
		withValidSender(event, async () =>
			piService.extractKnowledge(
				validateKnowledgeExtractionRequest(payload),
				await settingsStore.requireWorkspacePath(),
			),
		),
	);
	ipcMain.handle(ipcChannels.openExternal, async (event, payload) =>
		withValidSender(event, async () => {
			await shell.openExternal(validateOpenExternalRequest(payload).url);
			return { ok: true as const };
		}),
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
	if (!ownsSingleInstanceLock) return;
	if (isSmoke) {
		smokeTimeout = setTimeout(() => {
			console.error("ELECTRON_SMOKE timeout waiting for renderer load");
			app.exit(1);
		}, smokeTimeoutMs).unref();
	}
	settingsStore = new SettingsStore(dataRootPath, legacyUserDataPath);
	appStateStore = new AppStateStore(dataRootPath);
	await appStateStore.migrateLegacyState(
		await settingsStore.getWorkspacePath(),
		path.join(legacyUserDataPath, "knowbranch-workspace-state.json"),
	);
	piService = new PiService(
		dataRootPath,
		(event) => mainWindow?.webContents.send(ipcChannels.authEvent, event),
		(event) => mainWindow?.webContents.send(ipcChannels.agentEvent, event),
	);
	sourceService = new SourceService(dataRootPath, () => settingsStore.requireWorkspacePath());
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
				let evidence;
				while (Date.now() < deadline) {
					const serializedState = window.knowbranch?.appStateLoad?.() ?? null;
					let parsedState = {};
					try { parsedState = serializedState ? (JSON.parse(serializedState).state ?? {}) : {}; } catch {}
					evidence = {
						title: document.title,
						bodyText: document.body?.innerText?.slice(0, 200) ?? '',
						isElectron: window.knowbranch?.isElectron === true,
						bridgeKeys: Object.keys(window.knowbranch ?? {}).sort(),
						stateBytes: serializedState?.length ?? 0,
						stateSessions: Array.isArray(parsedState.sessions) ? parsedState.sessions.length : 0,
						stateTurns: Array.isArray(parsedState.turns) ? parsedState.turns.length : 0,
						knowledgeReferenceCount: document.querySelectorAll('a[href^="#knowledge/"]').length,
					};
					if (evidence.bodyText.trim() && evidence.isElectron) return evidence;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return evidence;
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
