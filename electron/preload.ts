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
	pluginList: () => ipcRenderer.invoke(ipcChannels.pluginList),
	pluginInstall: (request) => ipcRenderer.invoke(ipcChannels.pluginInstall, request),
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
	agentPrompt: (request: AgentPromptRequest) =>
		ipcRenderer.invoke(ipcChannels.agentPrompt, request),
	generateSummary: (request) => ipcRenderer.invoke(ipcChannels.generateSummary, request),
	extractKnowledge: (request) => ipcRenderer.invoke(ipcChannels.extractKnowledge, request),
	renderArchify: (request) => ipcRenderer.invoke(ipcChannels.renderArchify, request),
	openExternal: (request) => ipcRenderer.invoke(ipcChannels.openExternal, request),
	appStateLoad: () => ipcRenderer.sendSync(ipcChannels.appStateLoad),
	appStateSave: (request) => ipcRenderer.invoke(ipcChannels.appStateSave, request),
	diagnosticReport: (report) => ipcRenderer.invoke(ipcChannels.diagnosticReport, report),
	archifyParseFailure: (report) => ipcRenderer.invoke(ipcChannels.archifyParseFailure, report),
	forkDebugDump: (request) => ipcRenderer.invoke(ipcChannels.forkDebugDump, request),
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
