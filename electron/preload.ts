import { contextBridge, ipcRenderer } from "electron";
import {
	KNOWBRANCH_BRIDGE_NAME,
	ipcChannels,
	type AgentBridgeEvent,
	type AgentPromptRequest,
	type AuthBridgeEvent,
	type KnowbranchBridge,
	type ModelCatalogRequest,
	type ProviderLoginRequest,
	type ProviderLogoutRequest,
	type ProviderStatusRequest,
} from "../src/shared/ipc.js";

const bridge: KnowbranchBridge = {
	isElectron: true,
	providerStatus: (request: ProviderStatusRequest) =>
		ipcRenderer.invoke(ipcChannels.providerStatus, request),
	providerLogin: (request: ProviderLoginRequest) =>
		ipcRenderer.invoke(ipcChannels.providerLogin, request),
	providerLogout: (request: ProviderLogoutRequest) =>
		ipcRenderer.invoke(ipcChannels.providerLogout, request),
	modelCatalog: (request?: ModelCatalogRequest) =>
		ipcRenderer.invoke(ipcChannels.modelCatalog, request),
	getWorkspace: () => ipcRenderer.invoke(ipcChannels.getWorkspace),
	selectWorkspace: () => ipcRenderer.invoke(ipcChannels.selectWorkspace),
	agentPrompt: (request: AgentPromptRequest) =>
		ipcRenderer.invoke(ipcChannels.agentPrompt, request),
	onAuthEvent: (listener: (event: AuthBridgeEvent) => void) => {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: AuthBridgeEvent) =>
			listener(payload);
		ipcRenderer.on(ipcChannels.authEvent, wrapped);
		return () => ipcRenderer.removeListener(ipcChannels.authEvent, wrapped);
	},
	onAgentEvent: (listener: (event: AgentBridgeEvent) => void) => {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentBridgeEvent) =>
			listener(payload);
		ipcRenderer.on(ipcChannels.agentEvent, wrapped);
		return () => ipcRenderer.removeListener(ipcChannels.agentEvent, wrapped);
	},
};

contextBridge.exposeInMainWorld(KNOWBRANCH_BRIDGE_NAME, bridge);
