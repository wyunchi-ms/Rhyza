import type { AgentService } from "./agent-service.js";
import type { McpService } from "./mcp-service.js";
import type { PiPluginService } from "./pi-plugin-service.js";
import type { SettingsStore } from "./settings-store.js";
import type { SourceService } from "./source-service.js";
import type { AgentDiagnosticEvent } from "./agent-diagnostics.js";
import type {
	AgentBridgeEvent,
	AppStateSaveRequest,
	AuthBridgeEvent,
	ComposerSkillInfo,
	ForkDebugDumpRequest,
	PathSummaryProgress,
	PathSummaryRequest,
	PathSummaryResponse,
	ProviderId,
	WorkspaceStateEnvelope,
} from "../../src/shared/ipc.js";
import type { McpEvent } from "../../src/shared/mcp.js";

export interface BackendOptions {
	dataRoot: string;
	legacyUserDataPath?: string;
	home: string;
	agentDir?: string;
}

export type BackendApi = Pick<
	AgentService,
	| "getAzureOpenAIConfig"
	| "setAzureOpenAIConfig"
	| "getProviderStatus"
	| "loginProvider"
	| "logoutProvider"
	| "getModelCatalog"
	| "promptAgent"
	| "getModelRequestHistory"
	| "getWorkspaceDiff"
	| "getWorkspaceTodos"
	| "generateSummary"
	| "extractKnowledge"
	| "cancelAuxiliaryRequest"
	| "reloadInstalledPlugins"
> & {
	initialize(): Promise<void>;
	shutdown(): Promise<void>;
	generatePathSummary(request: PathSummaryRequest, workspace: string): Promise<PathSummaryResponse>;
	composerSkills(providerId: ProviderId): Promise<ComposerSkillInfo[]>;
	forkDebugDump(request: ForkDebugDumpRequest): Promise<{ ok: true; path: string }>;
	mcpOverview: McpService["overview"];
	mcpEdit: McpService["edit"];
	mcpSave: McpService["save"];
	mcpRemove: McpService["remove"];
	mcpTrust: McpService["trust"];
	mcpAction: McpService["action"];
	mcpResources: McpService["resources"];
	pluginList: PiPluginService["list"];
	pluginInstall: PiPluginService["install"];
	pluginRemove: PiPluginService["remove"];
	getWorkspacePath: SettingsStore["getWorkspacePath"];
	getWorkspaceHistory: SettingsStore["getWorkspaceHistory"];
	setWorkspacePath: SettingsStore["setWorkspacePath"];
	switchWorkspace: SettingsStore["switchWorkspace"];
	requireWorkspacePath: SettingsStore["requireWorkspacePath"];
	sourceList: SourceService["list"];
	sourceAdd: SourceService["add"];
	sourceRefresh: SourceService["refresh"];
	sourceRemove: SourceService["remove"];
	sourceSearch: SourceService["search"];
	sourceIndexingGet: SourceService["getIndexingConfig"];
	sourceIndexingSave: SourceService["saveIndexingConfig"];
	stateLoad(workspace: string | null): Promise<WorkspaceStateEnvelope | null>;
	stateSave(workspace: string, value: AppStateSaveRequest["value"]): Promise<void>;
};

export interface MainApi {
	openUrl(url: string): Promise<void>;
}

export type BackendEvent =
	| { type: "agent"; value: AgentBridgeEvent }
	| { type: "auth"; value: AuthBridgeEvent }
	| { type: "mcp"; value: McpEvent }
	| { type: "path-summary"; value: PathSummaryProgress }
	| { type: "diagnostic"; kind: "agent-stage"; value: AgentDiagnosticEvent; threadId: number }
	| { type: "diagnostic"; kind: "worker-sample"; value: object; threadId: number };
