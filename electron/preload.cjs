const { contextBridge, ipcRenderer } = require("electron");

// Keep this allowlist synchronized with src/shared/ipc.ts and electron/preload.ts.

const ipcChannels = {
	providerStatus: "knowbranch:provider-status",
	providerLogin: "knowbranch:provider-login",
	providerLogout: "knowbranch:provider-logout",
	modelCatalog: "knowbranch:model-catalog",
	getWorkspace: "knowbranch:get-workspace",
	selectWorkspace: "knowbranch:select-workspace",
	sourceList: "knowbranch:source-list",
	sourceAdd: "knowbranch:source-add",
	sourceRefresh: "knowbranch:source-refresh",
	sourceArchive: "knowbranch:source-archive",
	sourceSearch: "knowbranch:source-search",
	workspaceDiff: "knowbranch:workspace-diff",
	workspaceExportPatch: "knowbranch:workspace-export-patch",
	agentPrompt: "knowbranch:agent-prompt",
	generateSummary: "knowbranch:generate-summary",
	extractKnowledge: "knowbranch:extract-knowledge",
	openExternal: "knowbranch:open-external",
	appStateLoad: "knowbranch:app-state-load",
	appStateSave: "knowbranch:app-state-save",
	diagnosticReport: "knowbranch:diagnostic-report",
	agentEvent: "knowbranch:agent-event",
	authEvent: "knowbranch:auth-event",
};

contextBridge.exposeInMainWorld("knowbranch", {
	isElectron: true,
	providerStatus: (request) =>
		ipcRenderer.invoke(ipcChannels.providerStatus, request),
	providerLogin: (request) => ipcRenderer.invoke(ipcChannels.providerLogin, request),
	providerLogout: (request) =>
		ipcRenderer.invoke(ipcChannels.providerLogout, request),
	modelCatalog: (request) => ipcRenderer.invoke(ipcChannels.modelCatalog, request),
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
	generateSummary: (request) => ipcRenderer.invoke(ipcChannels.generateSummary, request),
	extractKnowledge: (request) => ipcRenderer.invoke(ipcChannels.extractKnowledge, request),
	openExternal: (request) => ipcRenderer.invoke(ipcChannels.openExternal, request),
	appStateLoad: () => ipcRenderer.sendSync(ipcChannels.appStateLoad),
	appStateSave: (request) => ipcRenderer.invoke(ipcChannels.appStateSave, request),
	diagnosticReport: (report) => ipcRenderer.invoke(ipcChannels.diagnosticReport, report),
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
