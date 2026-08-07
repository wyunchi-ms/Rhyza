const { contextBridge, ipcRenderer } = require("electron");

// Keep this allowlist synchronized with src/shared/ipc.ts and electron/preload.ts.

const ipcChannels = {
	providerStatus: "knowbranch:provider-status",
	providerLogin: "knowbranch:provider-login",
	providerLogout: "knowbranch:provider-logout",
	modelCatalog: "knowbranch:model-catalog",
	getWorkspace: "knowbranch:get-workspace",
	selectWorkspace: "knowbranch:select-workspace",
	agentPrompt: "knowbranch:agent-prompt",
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
	agentPrompt: (request) => ipcRenderer.invoke(ipcChannels.agentPrompt, request),
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
