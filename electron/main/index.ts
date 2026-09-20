import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentService } from "./agent-service.js";
import { PiPluginService } from "./pi-plugin-service.js";
import { listComposerSkills } from "./composer-skills.js";
import { SettingsStore } from "./settings-store.js";
import { SourceService } from "./source-service.js";
import {
	ipcChannels,
	validateAgentPromptRequest,
	validateAuxiliaryRequestCancelRequest,
	validateModelRequestHistoryRequest,
	validateWorkspaceTodosRequest,
	validateModelCatalogRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
	validatePiPluginSource,
	validatePiPluginRemoveRequest,
	validateIdRequest,
	validateSourceSearchRequest,
	validateWorkspaceDiffRequest,
	validateSummaryRequest,
	validateKnowledgeExtractionRequest,
	validateOpenExternalRequest,
	validateAppStateSaveRequest,
	validateForkDebugDumpRequest,
	type DiagnosticReport,
} from "../../src/shared/ipc.js";
import { AppStateStore } from "./app-state-store.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationId = "com.rhyza.desktop";
// Direct script launches resolve app.getAppPath() to dist-electron/electron/main.
const brandingDirectory = app.isPackaged
	? path.join(process.resourcesPath, "branding")
	: path.resolve(currentDirectory, "..", "..", "..", "resources", "branding");
const applicationIcon = path.join(
	brandingDirectory,
	process.platform === "win32" ? "icon.ico" : "icon.png",
);
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const isSmoke = process.env.RHYZA_ELECTRON_SMOKE === "1";
setDefaultResultOrder("ipv4first");

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5175";
const smokeTimeoutMs = 15_000;
const legacyProductSlug = ["know", "branch"].join("");
const legacyUserDataPath = app.getPath("userData");
const dataRootPath = path.join(app.getPath("home"), ".pi-graph");
const smokeUserDataPath = isSmoke
	? path.join(app.getPath("temp"), `rhyza-electron-smoke-${process.pid}`)
	: undefined;
app.setName("Rhyza");
if (process.platform === "win32") {
	app.setAppUserModelId(applicationId);
}
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
	activeChatTurnCount: number;
	chatAtEnd: boolean;
	branchLoadingVisible: boolean;
	entityPreviewOpened: boolean;
	entityPreviewClosed: boolean;
	entityPreviewOpenMs?: number;
	entityPreviewCloseMs?: number;
}

let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore;
let piService: AgentService;
let piPluginService: PiPluginService;
let sourceService: SourceService;
let appStateStore: AppStateStore;
let smokeTimeout: NodeJS.Timeout | undefined;
let allowedRendererUrls = new Set<string>();
const diagnosticsDirectory = path.join(dataRootPath, "diagnostics");
const mainLoopDelay = monitorEventLoopDelay({ resolution: 20 });
let diagnosticsWriteQueue = Promise.resolve();

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
		icon: applicationIcon,
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
	if (process.platform === "win32") {
		mainWindow.setAppDetails({
			appId: applicationId,
			appIconPath: applicationIcon,
			appIconIndex: 0,
		});
	}
	allowedRendererUrls = new Set([
		devServerUrl,
		pathToFileURL(path.join(currentDirectory, "..", "..", "..", "dist", "index.html")).toString(),
	]);
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!isAllowedRendererUrl(url)) {
			event.preventDefault();
		}
	});
	mainWindow.webContents.on("will-frame-navigate", (event) => {
		if (!isAllowedRendererUrl(event.url) && event.url !== "about:srcdoc") {
			event.preventDefault();
		}
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) =>
		isAllowedRendererUrl(url) ? { action: "allow" } : { action: "deny" },
	);

	mainWindow.once("ready-to-show", () => mainWindow?.show());
	mainWindow.on("unresponsive", () => {
		void writeDiagnostic("window-unresponsive", mainProcessSnapshot());
	});
	mainWindow.on("responsive", () => {
		void writeDiagnostic("window-responsive", mainProcessSnapshot());
	});
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		void writeDiagnostic("renderer-process-gone", {
			...mainProcessSnapshot(),
			reason: details.reason,
			exitCode: details.exitCode,
		});
	});
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
		await mainWindow.loadFile(path.join(currentDirectory, "..", "..", "..", "dist", "index.html"));
	}
	if (!mainWindow.isDestroyed()) {
		mainWindow.show();
		mainWindow.focus();
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
		if (process.env.RHYZA_STATE_DEBUG === "1") {
			console.log("APP_STATE_LOAD", { workspacePath, bytes: value?.length ?? 0 });
		}
		event.returnValue = value;
	});
	ipcMain.handle(ipcChannels.appStateSave, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateAppStateSaveRequest(payload);
			if (process.env.RHYZA_STATE_DEBUG === "1") {
				console.log("APP_STATE_SAVE", {
					workspacePath: request.workspacePath,
					bytes: request.value.length,
				});
			}
			await appStateStore.save(request.workspacePath, request.value);
			return { ok: true as const };
		}),
	);
	ipcMain.handle(ipcChannels.diagnosticReport, async (event, payload) =>
		withValidSender(event, async () => {
			await writeDiagnostic("renderer-sample", validateDiagnosticReport(payload));
			return { ok: true as const };
		}),
	);
	ipcMain.handle(ipcChannels.forkDebugDump, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateForkDebugDumpRequest(payload);
			const workspacePath = await settingsStore.requireWorkspacePath();
			const dumpDirectory = path.join(workspacePath, ".rhyza-debug", "fork-dumps");
			const fileName = `${safeDebugFilePart(request.timestamp)}-${request.kind}-${safeDebugFilePart(request.selectedTurnId)}.json`;
			const filePath = path.join(dumpDirectory, fileName);
			await mkdir(dumpDirectory, { recursive: true });
			await writeFile(filePath, `${JSON.stringify(request.snapshot, null, 2)}\n`, "utf8");
			return { ok: true as const, path: filePath };
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
		withValidSender(event, () => piService.getModelCatalog(validateModelCatalogRequest(payload))),
	);
	ipcMain.handle(ipcChannels.pluginList, async (event) =>
		withValidSender(event, () => piPluginService.list()),
	);
	ipcMain.handle(ipcChannels.composerSkills, async (event, payload) =>
		withValidSender(event, async () => {
			const { providerId } = validateProviderStatusRequest(payload);
			const plugins = providerId !== "claude-code" ? await piPluginService.list() : [];
			return listComposerSkills({
				providerId,
				home: app.getPath("home"),
				workspace: await settingsStore.getWorkspacePath(),
				agentDir: getAgentDir(),
				pluginPaths: plugins.flatMap((plugin) =>
					plugin.installedPath ? [plugin.installedPath] : [],
				),
			});
		}),
	);
	ipcMain.handle(ipcChannels.pluginInstall, async (event, payload) =>
		withValidSender(event, async () => {
			const { source } = validatePiPluginSource(payload);
			const plugins = await piPluginService.install(source);

			piService.reloadInstalledPlugins();
			return { ok: true as const, plugins };
		}),
	);
	ipcMain.handle(ipcChannels.pluginSelectLocal, async (event) =>
		withValidSender(event, async () => {
			const options = {
				title: "Install local extension",
				properties: ["openDirectory"] as Array<"openDirectory">,
			};
			const result = mainWindow
				? await dialog.showOpenDialog(mainWindow, options)
				: await dialog.showOpenDialog(options);
			return { source: result.canceled ? null : (result.filePaths[0] ?? null) };
		}),
	);
	ipcMain.handle(ipcChannels.pluginRemove, async (event, payload) =>
		withValidSender(event, async () => {
			const { source } = validatePiPluginRemoveRequest(payload);
			const plugins = await piPluginService.remove(source);

			piService.reloadInstalledPlugins();
			return { ok: true as const, plugins };
		}),
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
				title: "Select Rhyza workspace",
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
			const diff = await piService.getWorkspaceDiff(
				validateWorkspaceDiffRequest(payload).frontendSessionId,
			);
			const selection = await dialog.showSaveDialog(mainWindow!, {
				title: "Export session patch",
				defaultPath: "rhyza-session.patch",
				filters: [{ name: "Git patch", extensions: ["patch", "diff"] }],
			});
			if (selection.canceled || !selection.filePath) return { canceled: true };
			await writeFile(selection.filePath, diff.diff, "utf8");
			return { canceled: false, path: selection.filePath };
		}),
	);
	ipcMain.handle(ipcChannels.agentPrompt, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateAgentPromptRequest(payload);
			return timedDiagnostic(
				"agent-prompt",
				{ frontendSessionId: request.frontendSessionId },
				async () => piService.promptAgent(request, await settingsStore.requireWorkspacePath()),
			);
		}),
	);
	ipcMain.handle(ipcChannels.modelRequestHistory, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateModelRequestHistoryRequest(payload);
			return piService.getModelRequestHistory(request.frontendSessionId);
		}),
	);
	ipcMain.handle(ipcChannels.workspaceTodos, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateWorkspaceTodosRequest(payload);
			return piService.getWorkspaceTodos(
				request.frontendSessionId,
				await settingsStore.requireWorkspacePath(),
			);
		}),
	);
	ipcMain.handle(ipcChannels.generateSummary, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateSummaryRequest(payload);
			return timedDiagnostic("generate-summary", {}, async () =>
				piService.generateSummary(request, await settingsStore.requireWorkspacePath()),
			);
		}),
	);
	ipcMain.handle(ipcChannels.extractKnowledge, async (event, payload) =>
		withValidSender(event, async () => {
			const request = validateKnowledgeExtractionRequest(payload);
			return timedDiagnostic("extract-knowledge", {}, async () =>
				piService.extractKnowledge(request, await settingsStore.requireWorkspacePath()),
			);
		}),
	);
	ipcMain.handle(ipcChannels.cancelAuxiliaryRequest, async (event, payload) =>
		withValidSender(event, async () => ({
			canceled: await piService.cancelAuxiliaryRequest(
				validateAuxiliaryRequestCancelRequest(payload).requestId,
			),
		})),
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

function safeDebugFilePart(value: string): string {
	return (
		value
			.replace(/[^a-zA-Z0-9_-]/g, "-")
			.replace(/-+/g, "-")
			.slice(0, 100) || "unknown"
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
	const sessionDirectory = path.join(getAgentDir(), "rhyza-sessions");
	await migrateLegacyDirectory(
		path.join(getAgentDir(), `${legacyProductSlug}-sessions`),
		sessionDirectory,
	);
	appStateStore = new AppStateStore(dataRootPath, sessionDirectory);
	await appStateStore.migrateLegacyState(
		await settingsStore.getWorkspacePath(),
		path.join(legacyUserDataPath, `${legacyProductSlug}-workspace-state.json`),
	);
	sourceService = new SourceService(dataRootPath, () => settingsStore.requireWorkspacePath());
	piPluginService = new PiPluginService(getAgentDir(), () => settingsStore.getWorkspacePath());
	piService = new AgentService(
		dataRootPath,
		(event) => mainWindow?.webContents.send(ipcChannels.authEvent, event),
		(event) => mainWindow?.webContents.send(ipcChannels.agentEvent, event),
		undefined,
		sourceService,
	);
	app.once("before-quit", () => {
		void piService.dispose();
	});

	async function migrateLegacyDirectory(source: string, destination: string): Promise<void> {
		try {
			await rename(source, destination);
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				((error as NodeJS.ErrnoException).code === "ENOENT" ||
					(error as NodeJS.ErrnoException).code === "EEXIST")
			) {
				return;
			}
			throw error;
		}
	}
	registerIpcHandlers();
	mainLoopDelay.enable();
	setInterval(() => {
		void writeDiagnostic("main-sample", mainProcessSnapshot());
		mainLoopDelay.reset();
	}, 15_000).unref();
	await createWindow();

	app.on("activate", async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			await createWindow();
		}
	});
});

function validateDiagnosticReport(value: unknown): DiagnosticReport {
	if (!value || typeof value !== "object") throw new Error("Invalid diagnostic report.");
	const report = value as DiagnosticReport;
	if (typeof report.timestamp !== "string" || typeof report.route !== "string")
		throw new Error("Invalid diagnostic report.");
	return JSON.parse(JSON.stringify(report)) as DiagnosticReport;
}

function mainProcessSnapshot() {
	const memory = process.memoryUsage();
	return {
		timestamp: new Date().toISOString(),
		uptimeMs: Math.round(process.uptime() * 1_000),
		eventLoopDelayMs: {
			mean: Number.isFinite(mainLoopDelay.mean) ? Math.round(mainLoopDelay.mean / 1e6) : 0,
			max: Math.round(mainLoopDelay.max / 1e6),
			p99: Math.round(mainLoopDelay.percentile(99) / 1e6),
		},
		memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
	};
}

function writeDiagnostic(kind: string, payload: object): Promise<void> {
	const day = new Date().toISOString().slice(0, 10);
	const filePath = path.join(diagnosticsDirectory, `performance-${day}.jsonl`);
	diagnosticsWriteQueue = diagnosticsWriteQueue
		.then(async () => {
			await mkdir(diagnosticsDirectory, { recursive: true });
			await appendFile(filePath, `${JSON.stringify({ kind, ...payload })}\n`, "utf8");
		})
		.catch((error: unknown) => console.error("DIAGNOSTIC_WRITE_FAILED", error));
	return diagnosticsWriteQueue;
}

async function timedDiagnostic<T>(
	operation: string,
	metadata: object,
	action: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	await writeDiagnostic("operation-start", {
		timestamp: new Date(startedAt).toISOString(),
		operation,
		...metadata,
	});
	try {
		const result = await action();
		await writeDiagnostic("operation-end", {
			timestamp: new Date().toISOString(),
			operation,
			durationMs: Date.now() - startedAt,
			ok: true,
			...metadata,
		});
		return result;
	} catch (error) {
		await writeDiagnostic("operation-end", {
			timestamp: new Date().toISOString(),
			operation,
			durationMs: Date.now() - startedAt,
			ok: false,
			error: error instanceof Error ? error.name : "UnknownError",
			...metadata,
		});
		throw error;
	}
}

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
					await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					const serializedState = window.rhyza?.appStateLoad?.() ?? null;
					let parsedState = {};
					try { parsedState = serializedState ? (JSON.parse(serializedState).state ?? {}) : {}; } catch {}
					const chat = document.querySelector('.chat-scroll');
					const activeChatTurnCount = chat?.querySelectorAll('[data-turn-id]').length ?? 0;
					evidence = {
						title: document.title,
						bodyText: document.body?.innerText?.slice(0, 200) ?? '',
						isElectron: window.rhyza?.isElectron === true,
						bridgeKeys: Object.keys(window.rhyza ?? {}).sort(),
						stateBytes: serializedState?.length ?? 0,
						stateSessions: Array.isArray(parsedState.sessions) ? parsedState.sessions.length : 0,
						stateTurns: Array.isArray(parsedState.turns) ? parsedState.turns.length : 0,
						knowledgeReferenceCount: document.querySelectorAll('a[href^="#knowledge/"]').length,
						activeChatTurnCount,
						chatAtEnd: !chat || activeChatTurnCount === 0 || Math.abs(chat.scrollHeight - chat.clientHeight - chat.scrollTop) <= 2,
						branchLoadingVisible: false,
						entityPreviewOpened: false,
						entityPreviewClosed: false,
					};
					if (evidence.bodyText.trim() && evidence.isElectron) {
						window.dispatchEvent(new Event('rhyza:branch-switch-start'));
						await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
						evidence.branchLoadingVisible = document.querySelector('.branch-switch-loading') !== null;
						window.dispatchEvent(new Event('rhyza:branch-switch-end'));
						const entityLink = document.querySelector('a[href^="#knowledge/entity/"]');
						if (entityLink instanceof HTMLElement) {
							const openStartedAt = performance.now();
							entityLink.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							evidence.entityPreviewOpened = document.querySelector('.knowledge-entity-preview-dialog') !== null;
							evidence.entityPreviewOpenMs = Math.round((performance.now() - openStartedAt) * 10) / 10;
							const closeButton = document.querySelector('.knowledge-preview-header button');
							if (closeButton instanceof HTMLElement) {
								const closeStartedAt = performance.now();
								closeButton.click();
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
								evidence.entityPreviewClosed = document.querySelector('.knowledge-preview-dialog') === null;
								evidence.entityPreviewCloseMs = Math.round((performance.now() - closeStartedAt) * 10) / 10;
							}
						}
						return evidence;
					}
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
			throw new Error(`window.rhyza.isElectron was not true; evidence=${JSON.stringify(evidence)}`);
		}
		if (!evidence.chatAtEnd) {
			throw new Error(
				`Active conversation did not open at its final turn; evidence=${JSON.stringify(evidence)}`,
			);
		}
		if (!evidence.branchLoadingVisible) {
			throw new Error(
				`Branch loading feedback did not render; evidence=${JSON.stringify(evidence)}`,
			);
		}
		if (
			evidence.knowledgeReferenceCount > 0 &&
			(!evidence.entityPreviewOpened || !evidence.entityPreviewClosed)
		) {
			throw new Error(
				`Entity preview did not open and close cleanly; evidence=${JSON.stringify(evidence)}`,
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
