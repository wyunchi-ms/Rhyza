import type { AgentBridgeEvent, AuthBridgeEvent, KnowbranchBridge } from "./shared/ipc";

type Endpoint = { baseUrl: string; token: string };

export async function installTauriBridge(): Promise<void> {
	if (window.knowbranch || !("__TAURI_INTERNALS__" in window)) return;
	const { invoke } = await import("@tauri-apps/api/core");
	const endpoint = await invoke<Endpoint>("sidecar_endpoint");
	const rpc = async <T>(method: string, payload?: unknown): Promise<T> => {
		const response = await fetch(`${endpoint.baseUrl}/rpc`, {
			method: "POST",
			headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ method, payload }),
		});
		const body = await response.json() as { result?: T; error?: string };
		if (!response.ok || body.error) throw new Error(body.error || `Sidecar request failed (${response.status}).`);
		return body.result as T;
	};
	let cachedState = await rpc<string | null>("appStateLoad");
	const authListeners = new Set<(event: AuthBridgeEvent) => void>();
	const agentListeners = new Set<(event: AgentBridgeEvent) => void>();
	const events = new EventSource(`${endpoint.baseUrl}/events?token=${encodeURIComponent(endpoint.token)}`);
	events.addEventListener("auth", (event) => { const payload = JSON.parse((event as MessageEvent).data) as AuthBridgeEvent; authListeners.forEach((listener) => listener(payload)); });
	events.addEventListener("agent", (event) => { const payload = JSON.parse((event as MessageEvent).data) as AgentBridgeEvent; agentListeners.forEach((listener) => listener(payload)); });

	window.knowbranch = {
		isTauri: true,
		providerStatus: (payload) => rpc("providerStatus", payload),
		providerLogin: (payload) => rpc("providerLogin", payload),
		providerLogout: (payload) => rpc("providerLogout", payload),
		modelCatalog: (payload) => rpc("modelCatalog", payload),
		getWorkspace: () => rpc("getWorkspace"),
		selectWorkspace: async () => { const selected = await invoke<string | null>("choose_workspace"); return selected ? rpc("setWorkspace", selected) : rpc("getWorkspace"); },
		sourceList: () => rpc("sourceList"),
		sourceAdd: async () => rpc("sourceAdd", await invoke<string[]>("choose_sources")),
		sourceRefresh: (payload) => rpc("sourceRefresh", payload),
		sourceArchive: (payload) => rpc("sourceArchive", payload),
		sourceSearch: (payload) => rpc("sourceSearch", payload),
		workspaceDiff: (payload) => rpc("workspaceDiff", payload),
		workspaceExportPatch: (payload) => rpc("workspaceExportPatch", payload),
		agentPrompt: (payload) => rpc("agentPrompt", payload),
		generateSummary: (payload) => rpc("generateSummary", payload),
		extractKnowledge: (payload) => rpc("extractKnowledge", payload),
		openExternal: async ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); return { ok: true }; },
		appStateLoad: () => cachedState,
		appStateSave: async (payload) => { cachedState = payload.value; return rpc("appStateSave", payload); },
		diagnosticReport: (payload) => rpc("diagnosticReport", payload),
		onAuthEvent: (listener) => { authListeners.add(listener); return () => authListeners.delete(listener); },
		onAgentEvent: (listener) => { agentListeners.add(listener); return () => agentListeners.delete(listener); },
	} satisfies KnowbranchBridge;
}
