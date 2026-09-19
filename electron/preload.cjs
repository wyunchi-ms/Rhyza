const { contextBridge, ipcRenderer } = require("electron");

// Keep this allowlist synchronized with src/shared/ipc.ts and electron/preload.ts.

const ipcChannels = {
	providerStatus: "rhyza:provider-status",
	providerLogin: "rhyza:provider-login",
	providerLogout: "rhyza:provider-logout",
	modelCatalog: "rhyza:model-catalog",
	pluginList: "rhyza:plugin-list",
	pluginInstall: "rhyza:plugin-install",
	pluginSelectLocal: "rhyza:plugin-select-local",
	pluginRemove: "rhyza:plugin-remove",
	getWorkspace: "rhyza:get-workspace",
	selectWorkspace: "rhyza:select-workspace",
	sourceList: "rhyza:source-list",
	sourceAdd: "rhyza:source-add",
	sourceRefresh: "rhyza:source-refresh",
	sourceArchive: "rhyza:source-archive",
	sourceSearch: "rhyza:source-search",
	workspaceDiff: "rhyza:workspace-diff",
	workspaceExportPatch: "rhyza:workspace-export-patch",
	agentPrompt: "rhyza:agent-prompt",
	modelRequestHistory: "rhyza:model-request-history",
	workspaceTodos: "rhyza:workspace-todos",
	generateSummary: "rhyza:generate-summary",
	extractKnowledge: "rhyza:extract-knowledge",
	cancelAuxiliaryRequest: "rhyza:cancel-auxiliary-request",

	openExternal: "rhyza:open-external",
	appStateLoad: "rhyza:app-state-load",
	appStateSave: "rhyza:app-state-save",
	diagnosticReport: "rhyza:diagnostic-report",

	forkDebugDump: "rhyza:fork-debug-dump",
	agentEvent: "rhyza:agent-event",
	authEvent: "rhyza:auth-event",
};

contextBridge.exposeInMainWorld("rhyza", {
	isElectron: true,
	providerStatus: (request) => ipcRenderer.invoke(ipcChannels.providerStatus, request),
	providerLogin: (request) => ipcRenderer.invoke(ipcChannels.providerLogin, request),
	providerLogout: (request) => ipcRenderer.invoke(ipcChannels.providerLogout, request),
	modelCatalog: (request) => ipcRenderer.invoke(ipcChannels.modelCatalog, request),
	pluginList: () => ipcRenderer.invoke(ipcChannels.pluginList),
	pluginInstall: (request) => ipcRenderer.invoke(ipcChannels.pluginInstall, request),
	pluginSelectLocal: () => ipcRenderer.invoke(ipcChannels.pluginSelectLocal),
	pluginRemove: (request) => ipcRenderer.invoke(ipcChannels.pluginRemove, request),
	getWorkspace: () => ipcRenderer.invoke(ipcChannels.getWorkspace),
	selectWorkspace: () => ipcRenderer.invoke(ipcChannels.selectWorkspace),
	sourceList: () => ipcRenderer.invoke(ipcChannels.sourceList),
	sourceAdd: () => ipcRenderer.invoke(ipcChannels.sourceAdd),
	sourceRefresh: (request) => ipcRenderer.invoke(ipcChannels.sourceRefresh, request),
	sourceArchive: (request) => ipcRenderer.invoke(ipcChannels.sourceArchive, request),
	sourceSearch: (request) => ipcRenderer.invoke(ipcChannels.sourceSearch, request),
	workspaceDiff: (request) => ipcRenderer.invoke(ipcChannels.workspaceDiff, request),
	workspaceExportPatch: (request) => ipcRenderer.invoke(ipcChannels.workspaceExportPatch, request),
	agentPrompt: (request) => ipcRenderer.invoke(ipcChannels.agentPrompt, request),
	modelRequestHistory: (request) => ipcRenderer.invoke(ipcChannels.modelRequestHistory, request),
	workspaceTodos: (request) => ipcRenderer.invoke(ipcChannels.workspaceTodos, request),
	generateSummary: (request) => ipcRenderer.invoke(ipcChannels.generateSummary, request),
	extractKnowledge: (request) => ipcRenderer.invoke(ipcChannels.extractKnowledge, request),
	cancelAuxiliaryRequest: (request) =>
		ipcRenderer.invoke(ipcChannels.cancelAuxiliaryRequest, request),

	openExternal: (request) => ipcRenderer.invoke(ipcChannels.openExternal, request),
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
