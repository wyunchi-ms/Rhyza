import { Worker } from "node:worker_threads";
import type { PathSummaryProgress } from "../../src/shared/ipc.js";
import { isRecord } from "../../src/shared/value.js";
import type { BackendApi, BackendEvent, BackendOptions, MainApi } from "./backend-contract.js";
import { WorkerRpc } from "./worker-rpc.js";

export class BackendService {
	private readonly worker: Worker;
	private readonly rpc: WorkerRpc<BackendApi, MainApi>;
	private readonly progressListeners = new Map<string, (progress: PathSummaryProgress) => void>();
	private shutdownPromise?: Promise<void>;
	readonly ready: Promise<void>;
	readonly agent;
	readonly settings;
	readonly sources;
	readonly state;
	readonly plugins;

	constructor(
		options: BackendOptions,
		main: MainApi,
		onEvent: (event: BackendEvent) => void,
		workerUrl = new URL("./backend-worker.js", import.meta.url),
	) {
		this.worker = new Worker(workerUrl, { workerData: options });
		this.rpc = new WorkerRpc(this.worker, main, (event) => {
			if (!isRecord(event) || typeof event.type !== "string") return;
			const backendEvent = event as BackendEvent;
			if (backendEvent.type === "path-summary") {
				this.progressListeners.get(backendEvent.value.requestId)?.(backendEvent.value);
			} else {
				onEvent(backendEvent);
			}
		});
		this.worker.on("error", (error) => this.rpc.close(error));
		this.worker.on("exit", (code) => {
			this.rpc.close(
				new Error(`Background service exited (code ${code}). Restart Rhyza to reconnect.`),
			);
		});
		this.ready = this.rpc.call("initialize");
		const method = <K extends keyof BackendApi & string>(name: K) => {
			const call = this.rpc.method(name);
			return async (...args: Parameters<typeof call>) => {
				await this.ready;
				if (this.shutdownPromise) throw new Error("Background service is shutting down.");
				return call(...args);
			};
		};
		this.agent = {
			getAzureOpenAIConfig: method("getAzureOpenAIConfig"),
			setAzureOpenAIConfig: method("setAzureOpenAIConfig"),
			getProviderStatus: method("getProviderStatus"),
			loginProvider: method("loginProvider"),
			logoutProvider: method("logoutProvider"),
			getModelCatalog: method("getModelCatalog"),
			promptAgent: method("promptAgent"),
			getModelRequestHistory: method("getModelRequestHistory"),
			getWorkspaceDiff: method("getWorkspaceDiff"),
			getWorkspaceTodos: method("getWorkspaceTodos"),
			updateWorkspaceTodo: method("updateWorkspaceTodo"),
			generateSummary: method("generateSummary"),
			extractKnowledge: method("extractKnowledge"),
			cancelAuxiliaryRequest: method("cancelAuxiliaryRequest"),
			reloadInstalledPlugins: method("reloadInstalledPlugins"),
			generatePathSummary: async (
				request: Parameters<BackendApi["generatePathSummary"]>[0],
				workspace: string,
				progress: (value: PathSummaryProgress) => void,
			) => {
				if (this.progressListeners.has(request.requestId))
					throw new Error("This summary request is already running.");
				this.progressListeners.set(request.requestId, progress);
				try {
					return await method("generatePathSummary")(request, workspace);
				} finally {
					this.progressListeners.delete(request.requestId);
				}
			},
			mcp: {
				overview: method("mcpOverview"),
				edit: method("mcpEdit"),
				save: method("mcpSave"),
				remove: method("mcpRemove"),
				trust: method("mcpTrust"),
				action: method("mcpAction"),
				resources: method("mcpResources"),
			},
		};
		this.settings = {
			getWorkspacePath: method("getWorkspacePath"),
			getWorkspaceHistory: method("getWorkspaceHistory"),
			setWorkspacePath: method("setWorkspacePath"),
			switchWorkspace: method("switchWorkspace"),
			requireWorkspacePath: method("requireWorkspacePath"),
		};
		this.sources = {
			list: method("sourceList"),
			add: method("sourceAdd"),
			refresh: method("sourceRefresh"),
			remove: method("sourceRemove"),
			search: method("sourceSearch"),
			getIndexingConfig: method("sourceIndexingGet"),
			saveIndexingConfig: method("sourceIndexingSave"),
		};
		this.state = {
			load: method("stateLoad"),
			save: method("stateSave"),
		};
		this.plugins = {
			list: method("pluginList"),
			install: method("pluginInstall"),
			remove: method("pluginRemove"),
		};
		this.composerSkills = method("composerSkills");
		this.forkDebugDump = method("forkDebugDump");
	}

	readonly composerSkills;
	readonly forkDebugDump;

	dispose(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.shutdownPromise = this.stop();
		return this.shutdownPromise;
	}

	private async stop(): Promise<void> {
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				this.ready.then(() => this.rpc.call("shutdown")),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error("Background service shutdown timed out.")),
						5_000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
			this.rpc.close();
			this.progressListeners.clear();
			await this.worker.terminate();
		}
	}
}
