import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { AppStateStore } from "./services/app-state-store.js";
import { PiService } from "./services/pi-service.js";
import { SettingsStore } from "./services/settings-store.js";
import { SourceService } from "./services/source-service.js";
import {
	validateAgentPromptRequest,
	validateAppStateSaveRequest,
	validateIdRequest,
	validateKnowledgeExtractionRequest,
	validateModelCatalogRequest,
	validateOpenExternalRequest,
	validateProviderLoginRequest,
	validateProviderLogoutRequest,
	validateProviderStatusRequest,
	validateSourceSearchRequest,
	validateSummaryRequest,
	validateWorkspaceDiffRequest,
} from "../src/shared/ipc.js";

const dataRoot = path.join(homedir(), ".pi-graph");
const token = crypto.randomUUID();
const settings = new SettingsStore(dataRoot);
const appState = new AppStateStore(dataRoot);
const sources = new SourceService(dataRoot, () => settings.requireWorkspacePath());
const eventClients = new Set<ServerResponse>();
const emit = (channel: string, payload: unknown) => {
	const line = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;
	for (const client of eventClients) client.write(line);
};
const pi = new PiService(dataRoot, (event) => emit("auth", event), (event) => emit("agent", event), undefined, sources);

const server = createServer(async (request, response) => {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	response.setHeader("Access-Control-Allow-Origin", "*");
	response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
	if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
	if (request.headers.authorization !== `Bearer ${token}` && requestUrl.searchParams.get("token") !== token) { response.writeHead(401).end(); return; }
	if (requestUrl.pathname === "/events" && request.method === "GET") {
		response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
		response.write(": connected\n\n");
		eventClients.add(response);
		request.on("close", () => eventClients.delete(response));
		return;
	}
	if (requestUrl.pathname !== "/rpc" || request.method !== "POST") { response.writeHead(404).end(); return; }
	try {
		const body = await readJson(request);
		const result = await dispatch(String(body.method ?? ""), body.payload);
		response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ result }));
	} catch (error) {
		response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
	}
});

server.listen(0, "127.0.0.1", () => {
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Sidecar failed to bind a TCP port.");
	process.stdout.write(`${JSON.stringify({ port: address.port, token })}\n`);
});

async function dispatch(method: string, payload: unknown): Promise<unknown> {
	switch (method) {
		case "providerStatus": return pi.getProviderStatus(validateProviderStatusRequest(payload).providerId);
		case "providerLogin": return pi.loginProvider(validateProviderLoginRequest(payload).providerId);
		case "providerLogout": return pi.logoutProvider(validateProviderLogoutRequest(payload).providerId);
		case "modelCatalog": return pi.getModelCatalog(validateModelCatalogRequest(payload));
		case "getWorkspace": return { path: await settings.getWorkspacePath() };
		case "setWorkspace": await settings.setWorkspacePath(typeof payload === "string" ? payload : null); return { path: await settings.getWorkspacePath() };
		case "sourceList": return sources.list();
		case "sourceAdd": return sources.add(Array.isArray(payload) ? payload.filter((value): value is string => typeof value === "string") : []);
		case "sourceRefresh": return sources.refresh(validateIdRequest(payload).id);
		case "sourceArchive": return sources.archive(validateIdRequest(payload).id);
		case "sourceSearch": return sources.search(validateSourceSearchRequest(payload));
		case "workspaceDiff": return pi.getWorkspaceDiff(validateWorkspaceDiffRequest(payload).frontendSessionId);
		case "workspaceExportPatch": return { canceled: true };
		case "agentPrompt": return pi.promptAgent(validateAgentPromptRequest(payload), await settings.requireWorkspacePath());
		case "generateSummary": return pi.generateSummary(validateSummaryRequest(payload), await settings.requireWorkspacePath());
		case "extractKnowledge": return pi.extractKnowledge(validateKnowledgeExtractionRequest(payload), await settings.requireWorkspacePath());
		case "openExternal": validateOpenExternalRequest(payload); return { ok: true };
		case "appStateLoad": return appState.load(await settings.getWorkspacePath());
		case "appStateSave": { const value = validateAppStateSaveRequest(payload); await appState.save(value.workspacePath, value.value); return { ok: true }; }
		case "diagnosticReport": return { ok: true };
		default: throw new Error(`Unknown sidecar method: ${method}`);
	}
}

async function readJson(request: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > 20_000_000) throw new Error("Sidecar request is too large.");
	}
	const parsed = JSON.parse(body) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid sidecar request.");
	return parsed as Record<string, unknown>;
}

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
