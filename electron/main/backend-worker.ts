import { parentPort, threadId, workerData } from "node:worker_threads";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setDefaultResultOrder } from "node:dns";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AgentService } from "./agent-service.js";
import { AppStateStore } from "./app-state-store.js";
import { SettingsStore } from "./settings-store.js";
import { SourceService } from "./source-service.js";
import { McpService } from "./mcp-service.js";
import { PiPluginService } from "./pi-plugin-service.js";
import { listComposerSkills } from "./composer-skills.js";
import type { BackendApi, BackendEvent, BackendOptions, MainApi } from "./backend-contract.js";
import { WorkerRpc } from "./worker-rpc.js";
import { isRecord } from "../../src/shared/value.js";

if (!parentPort) throw new Error("Background service requires a worker thread.");
setDefaultResultOrder("ipv4first");
const options: BackendOptions = workerData;
const agentDir = options.agentDir ?? getAgentDir();
const legacyProductSlug = ["know", "branch"].join("");
const sessionDirectory = path.join(agentDir, "rhyza-sessions");
const settings = new SettingsStore(options.dataRoot, options.legacyUserDataPath);
const sources = new SourceService(options.dataRoot, () => settings.requireWorkspacePath());
const state = new AppStateStore(options.dataRoot, sessionDirectory);
const pendingStateSaves = new Set<Promise<void>>();
const plugins = new PiPluginService(agentDir, () => settings.getWorkspacePath());
const emit = (event: BackendEvent) => rpc.emit(event);
const mcp = new McpService(
	agentDir,
	options.dataRoot,
	(value) => emit({ type: "mcp", value }),
	(url) => rpc.call("openUrl", url),
);
const agent = new AgentService(
	options.dataRoot,
	(value) => emit({ type: "auth", value }),
	(value) => emit({ type: "agent", value }),
	agentDir,
	sources,
	mcp,
	(value) => emit({ type: "diagnostic", kind: "agent-stage", value, threadId }),
);
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
const sampleTimer = setInterval(() => {
	const memory = process.memoryUsage();
	emit({
		type: "diagnostic",
		kind: "worker-sample",
		threadId,
		value: {
			timestamp: new Date().toISOString(),
			eventLoopDelayMs: {
				mean: Number.isFinite(loopDelay.mean) ? Math.round(loopDelay.mean / 1e6) : 0,
				max: Math.round(loopDelay.max / 1e6),
				p99: Math.round(loopDelay.percentile(99) / 1e6),
			},
			memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
		},
	});
	loopDelay.reset();
}, 15_000);
sampleTimer.unref();

const handlers: BackendApi = {
	initialize: async () => {
		try {
			await mkdir(path.dirname(sessionDirectory), { recursive: true });
			await rename(path.join(agentDir, `${legacyProductSlug}-sessions`), sessionDirectory);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT" && code !== "EEXIST") throw error;
		}
		if (options.legacyUserDataPath) {
			await state.migrateLegacyState(
				await settings.getWorkspacePath(),
				path.join(options.legacyUserDataPath, `${legacyProductSlug}-workspace-state.json`),
			);
		}
	},
	shutdown: async () => {
		clearInterval(sampleTimer);
		loopDelay.disable();
		try {
			await agent.dispose();
		} finally {
			await Promise.all(pendingStateSaves);
		}
	},
	getAzureOpenAIConfig: agent.getAzureOpenAIConfig.bind(agent),
	setAzureOpenAIConfig: agent.setAzureOpenAIConfig.bind(agent),
	getProviderStatus: agent.getProviderStatus.bind(agent),
	loginProvider: agent.loginProvider.bind(agent),
	logoutProvider: agent.logoutProvider.bind(agent),
	getModelCatalog: agent.getModelCatalog.bind(agent),
	promptAgent: agent.promptAgent.bind(agent),
	getModelRequestHistory: agent.getModelRequestHistory.bind(agent),
	getWorkspaceDiff: agent.getWorkspaceDiff.bind(agent),
	getWorkspaceTodos: agent.getWorkspaceTodos.bind(agent),
	generateSummary: agent.generateSummary.bind(agent),
	extractKnowledge: agent.extractKnowledge.bind(agent),
	cancelAuxiliaryRequest: agent.cancelAuxiliaryRequest.bind(agent),
	reloadInstalledPlugins: agent.reloadInstalledPlugins.bind(agent),
	generatePathSummary: (request, workspace) =>
		agent.generatePathSummary(request, workspace, (value) => emit({ type: "path-summary", value })),
	mcpOverview: mcp.overview.bind(mcp),
	mcpEdit: mcp.edit.bind(mcp),
	mcpSave: mcp.save.bind(mcp),
	mcpRemove: mcp.remove.bind(mcp),
	mcpTrust: mcp.trust.bind(mcp),
	mcpAction: mcp.action.bind(mcp),
	mcpResources: mcp.resources.bind(mcp),
	pluginList: plugins.list.bind(plugins),
	pluginInstall: plugins.install.bind(plugins),
	pluginRemove: plugins.remove.bind(plugins),
	getWorkspacePath: settings.getWorkspacePath.bind(settings),
	getWorkspaceHistory: settings.getWorkspaceHistory.bind(settings),
	setWorkspacePath: settings.setWorkspacePath.bind(settings),
	switchWorkspace: settings.switchWorkspace.bind(settings),
	requireWorkspacePath: settings.requireWorkspacePath.bind(settings),
	sourceList: sources.list.bind(sources),
	sourceAdd: sources.add.bind(sources),
	sourceRefresh: sources.refresh.bind(sources),
	sourceRemove: sources.remove.bind(sources),
	sourceSearch: sources.search.bind(sources),
	sourceIndexingGet: sources.getIndexingConfig.bind(sources),
	sourceIndexingSave: sources.saveIndexingConfig.bind(sources),
	stateLoad: async (workspace) => {
		const serialized = state.load(workspace);
		if (!serialized) return null;
		const envelope: unknown = JSON.parse(serialized);
		if (!isRecord(envelope) || !isRecord(envelope.state))
			throw new Error("Invalid saved workspace state.");
		if (envelope.version !== undefined && typeof envelope.version !== "number")
			throw new Error("Invalid saved workspace state version.");
		return {
			state: envelope.state,
			...(envelope.version !== undefined ? { version: envelope.version } : {}),
			...(typeof envelope.workspacePath === "string"
				? { workspacePath: envelope.workspacePath }
				: {}),
		};
	},
	stateSave: (workspace, value) => {
		const saving = state.save(workspace, typeof value === "string" ? value : JSON.stringify(value));
		pendingStateSaves.add(saving);
		void saving.then(
			() => pendingStateSaves.delete(saving),
			() => pendingStateSaves.delete(saving),
		);
		return saving;
	},
	composerSkills: async (providerId) => {
		const installed = providerId !== "claude-code" ? await plugins.list() : [];
		return listComposerSkills({
			providerId,
			home: options.home,
			workspace: await settings.getWorkspacePath(),
			agentDir,
			pluginPaths: installed.flatMap((plugin) =>
				plugin.installedPath ? [plugin.installedPath] : [],
			),
		});
	},
	forkDebugDump: async (request) => {
		const safePart = (value: string) =>
			value
				.replace(/[^a-zA-Z0-9_-]/g, "-")
				.replace(/-+/g, "-")
				.slice(0, 100) || "unknown";
		const directory = path.join(
			await settings.requireWorkspacePath(),
			".rhyza-debug",
			"fork-dumps",
		);
		const filename = `${safePart(request.timestamp)}-${request.kind}-${safePart(request.selectedTurnId)}.json`;
		const filePath = path.join(directory, filename);
		await mkdir(directory, { recursive: true });
		await writeFile(filePath, `${JSON.stringify(request.snapshot, null, 2)}\n`, "utf8");
		return { ok: true, path: filePath };
	},
};
const rpc = new WorkerRpc<MainApi, BackendApi>(parentPort, handlers);
