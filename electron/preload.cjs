const { contextBridge, ipcRenderer } = require("electron");

// Keep this allowlist synchronized with src/shared/ipc.ts and electron/preload.ts.

const ipcChannels = {
	azureOpenAIConfigGet: "rhyza:azure-openai-config-get",
	azureOpenAIConfigSet: "rhyza:azure-openai-config-set",
	providerStatus: "rhyza:provider-status",
	providerLogin: "rhyza:provider-login",
	providerLogout: "rhyza:provider-logout",
	modelCatalog: "rhyza:model-catalog",
	pluginList: "rhyza:plugin-list",
	composerSkills: "rhyza:composer-skills",
	pluginInstall: "rhyza:plugin-install",
	pluginSelectLocal: "rhyza:plugin-select-local",
	pluginRemove: "rhyza:plugin-remove",
	getWorkspace: "rhyza:get-workspace",
	workspaceHistory: "rhyza:workspace-history",
	switchWorkspace: "rhyza:switch-workspace",
	selectWorkspace: "rhyza:select-workspace",
	sourceList: "rhyza:source-list",
	sourceAdd: "rhyza:source-add",
	sourceRefresh: "rhyza:source-refresh",
	sourceIndexingGet: "rhyza:source-indexing-get",
	sourceIndexingSave: "rhyza:source-indexing-save",
	sourceRemove: "rhyza:source-remove",
	sourceSearch: "rhyza:source-search",
	workspaceDiff: "rhyza:workspace-diff",
	workspaceExportPatch: "rhyza:workspace-export-patch",
	agentPrompt: "rhyza:agent-prompt",
	modelRequestHistory: "rhyza:model-request-history",
	workspaceTodos: "rhyza:workspace-todos",
	generateSummary: "rhyza:generate-summary",
	generatePathSummary: "rhyza:generate-path-summary",
	pathSummaryEvent: "rhyza:path-summary-event",
	extractKnowledge: "rhyza:extract-knowledge",
	cancelAuxiliaryRequest: "rhyza:cancel-auxiliary-request",

	openExternal: "rhyza:open-external",
	showApplicationMenu: "rhyza:show-application-menu",
	appStateLoad: "rhyza:app-state-load",
	appStateSave: "rhyza:app-state-save",
	diagnosticReport: "rhyza:diagnostic-report",

	forkDebugDump: "rhyza:fork-debug-dump",
	agentEvent: "rhyza:agent-event",
	authEvent: "rhyza:auth-event",
};

contextBridge.exposeInMainWorld("rhyza", {
	isElectron: true,
	platform: process.platform,
	azureOpenAIConfigGet: () => ipcRenderer.invoke(ipcChannels.azureOpenAIConfigGet),
	azureOpenAIConfigSet: (config) => ipcRenderer.invoke(ipcChannels.azureOpenAIConfigSet, config),
	providerStatus: (request) => ipcRenderer.invoke(ipcChannels.providerStatus, request),
	providerLogin: (request) => ipcRenderer.invoke(ipcChannels.providerLogin, request),
	providerLogout: (request) => ipcRenderer.invoke(ipcChannels.providerLogout, request),
	modelCatalog: (request) => ipcRenderer.invoke(ipcChannels.modelCatalog, request),
	pluginList: () => ipcRenderer.invoke(ipcChannels.pluginList),
	composerSkills: (request) => ipcRenderer.invoke(ipcChannels.composerSkills, request),
	pluginInstall: (request) => ipcRenderer.invoke(ipcChannels.pluginInstall, request),
	pluginSelectLocal: () => ipcRenderer.invoke(ipcChannels.pluginSelectLocal),
	pluginRemove: (request) => ipcRenderer.invoke(ipcChannels.pluginRemove, request),
	getWorkspace: () => ipcRenderer.invoke(ipcChannels.getWorkspace),
	workspaceHistory: () => ipcRenderer.invoke(ipcChannels.workspaceHistory),
	switchWorkspace: (request) => ipcRenderer.invoke(ipcChannels.switchWorkspace, request),
	selectWorkspace: () => ipcRenderer.invoke(ipcChannels.selectWorkspace),
	sourceList: () => ipcRenderer.invoke(ipcChannels.sourceList),
	sourceAdd: () => ipcRenderer.invoke(ipcChannels.sourceAdd),
	sourceRefresh: (request) => ipcRenderer.invoke(ipcChannels.sourceRefresh, request),
	sourceIndexingGet: (request) => ipcRenderer.invoke(ipcChannels.sourceIndexingGet, request),
	sourceIndexingSave: (request) => ipcRenderer.invoke(ipcChannels.sourceIndexingSave, request),
	sourceRemove: (request) => ipcRenderer.invoke(ipcChannels.sourceRemove, request),
	sourceSearch: (request) => ipcRenderer.invoke(ipcChannels.sourceSearch, request),
	workspaceDiff: (request) => ipcRenderer.invoke(ipcChannels.workspaceDiff, request),
	workspaceExportPatch: (request) => ipcRenderer.invoke(ipcChannels.workspaceExportPatch, request),
	agentPrompt: (request) => ipcRenderer.invoke(ipcChannels.agentPrompt, request),
	modelRequestHistory: (request) => ipcRenderer.invoke(ipcChannels.modelRequestHistory, request),
	workspaceTodos: (request) => ipcRenderer.invoke(ipcChannels.workspaceTodos, request),
	generateSummary: (request) => ipcRenderer.invoke(ipcChannels.generateSummary, request),
	generatePathSummary: (request) => ipcRenderer.invoke(ipcChannels.generatePathSummary, request),
	onPathSummaryEvent: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on(ipcChannels.pathSummaryEvent, wrapped);
		return () => ipcRenderer.removeListener(ipcChannels.pathSummaryEvent, wrapped);
	},
	extractKnowledge: (request) => ipcRenderer.invoke(ipcChannels.extractKnowledge, request),
	cancelAuxiliaryRequest: (request) =>
		ipcRenderer.invoke(ipcChannels.cancelAuxiliaryRequest, request),

	openExternal: (request) => ipcRenderer.invoke(ipcChannels.openExternal, request),
	showApplicationMenu: () => ipcRenderer.invoke(ipcChannels.showApplicationMenu),
	appStateLoad: () => ipcRenderer.sendSync(ipcChannels.appStateLoad),
	appStateSave: (request) => ipcRenderer.invoke(ipcChannels.appStateSave, request),
	diagnosticReport: (report) => ipcRenderer.invoke(ipcChannels.diagnosticReport, report),

	forkDebugDump: (request) => ipcRenderer.invoke(ipcChannels.forkDebugDump, request),
	onAuthEvent: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on(ipcChannels.authEvent, wrapped);
		return () => ipcRenderer.removeListener(ipcChannels.authEvent, wrapped);
	},
	onAgentEvent: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on(ipcChannels.agentEvent, wrapped);
		return () => ipcRenderer.removeListener(ipcChannels.agentEvent, wrapped);
	},
});
