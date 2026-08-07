export const KNOWBRANCH_BRIDGE_NAME = "knowbranch" as const;

export const ipcChannels = {
	providerStatus: "knowbranch:provider-status",
	providerLogin: "knowbranch:provider-login",
	providerLogout: "knowbranch:provider-logout",
	modelCatalog: "knowbranch:model-catalog",
	getWorkspace: "knowbranch:get-workspace",
	selectWorkspace: "knowbranch:select-workspace",
	agentPrompt: "knowbranch:agent-prompt",
	agentEvent: "knowbranch:agent-event",
	authEvent: "knowbranch:auth-event",
} as const;

export type KnowbranchIpcChannel =
	(typeof ipcChannels)[keyof typeof ipcChannels];

export type ProviderId = "github-copilot";

export interface ProviderStatusRequest {
	providerId: ProviderId;
}

export interface ProviderStatusResponse {
	providerId: ProviderId;
	configured: boolean;
	source?: string;
	label?: string;
	error?: string;
}

export interface ProviderLoginRequest {
	providerId: ProviderId;
}

export interface ProviderLogoutRequest {
	providerId: ProviderId;
}

export interface ProviderActionResponse {
	ok: boolean;
	status: ProviderStatusResponse;
	error?: string;
}

export interface ModelCatalogRequest {
	providerId?: ProviderId;
	refresh?: boolean;
}

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	api: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
}

export interface ModelCatalogResponse {
	models: ModelInfo[];
	configured: boolean;
	error?: string;
}

export interface WorkspaceInfo {
	path: string | null;
}

export interface AgentPromptRequest {
	frontendSessionId: string;
	parentFrontendSessionId?: string;
	forkedFromTurnId?: string;
	transcript: AgentTranscriptTurn[];
	prompt: string;
	model?: {
		providerId: ProviderId;
		modelId: string;
	};
}

export interface AgentTranscriptTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
}

export interface AgentPromptResponse {
	ok: boolean;
	sessionId?: string;
	assistantText?: string;
	error?: string;
}

export type AuthBridgeEvent =
	| { type: "info"; message: string; links?: { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
		}
	| { type: "progress"; message: string };

export interface AgentBridgeEvent {
	type: string;
	sessionId?: string;
	message?: string;
	payload?: unknown;
}

export interface KnowbranchBridge {
	isElectron: true;
	providerStatus(request: ProviderStatusRequest): Promise<ProviderStatusResponse>;
	providerLogin(request: ProviderLoginRequest): Promise<ProviderActionResponse>;
	providerLogout(request: ProviderLogoutRequest): Promise<ProviderActionResponse>;
	modelCatalog(request?: ModelCatalogRequest): Promise<ModelCatalogResponse>;
	getWorkspace(): Promise<WorkspaceInfo>;
	selectWorkspace(): Promise<WorkspaceInfo>;
	agentPrompt(request: AgentPromptRequest): Promise<AgentPromptResponse>;
	onAuthEvent(listener: (event: AuthBridgeEvent) => void): () => void;
	onAgentEvent(listener: (event: AgentBridgeEvent) => void): () => void;
}

const providerIds = new Set<ProviderId>(["github-copilot"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProviderStatusRequest(
	value: unknown,
): ProviderStatusRequest {
	if (!isRecord(value) || !providerIds.has(value.providerId as ProviderId)) {
		throw new Error("Invalid provider status request.");
	}
	return { providerId: value.providerId as ProviderId };
}

export const validateProviderLoginRequest = validateProviderStatusRequest;
export const validateProviderLogoutRequest = validateProviderStatusRequest;

export function validateModelCatalogRequest(value: unknown): ModelCatalogRequest {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		throw new Error("Invalid model catalog request.");
	}
	const providerId = value.providerId;
	if (providerId !== undefined && !providerIds.has(providerId as ProviderId)) {
		throw new Error("Invalid model catalog provider.");
	}
	return {
		providerId: providerId as ProviderId | undefined,
		refresh: value.refresh === true,
	};
}

export function validateAgentPromptRequest(value: unknown): AgentPromptRequest {
	if (!isRecord(value)) {
		throw new Error("Invalid agent prompt request.");
	}
	if (typeof value.prompt !== "string" || value.prompt.trim() === "") {
		throw new Error("A prompt is required.");
	}
	if (
		typeof value.frontendSessionId !== "string" ||
		value.frontendSessionId.trim() === ""
	) {
		throw new Error("A frontend session id is required.");
	}
	if (!Array.isArray(value.transcript)) {
		throw new Error("A transcript array is required.");
	}
	const request: AgentPromptRequest = {
		frontendSessionId: value.frontendSessionId,
		prompt: value.prompt,
		transcript: value.transcript.map(validateTranscriptTurn),
	};
	if (typeof value.parentFrontendSessionId === "string") {
		request.parentFrontendSessionId = value.parentFrontendSessionId;
	}
	if (typeof value.forkedFromTurnId === "string") {
		request.forkedFromTurnId = value.forkedFromTurnId;
	}
	if (value.model !== undefined) {
		if (!isRecord(value.model)) {
			throw new Error("Invalid model selection.");
		}
		if (!providerIds.has(value.model.providerId as ProviderId)) {
			throw new Error("Invalid model provider.");
		}
		if (typeof value.model.modelId !== "string" || value.model.modelId === "") {
			throw new Error("Invalid model id.");
		}
		request.model = {
			providerId: value.model.providerId as ProviderId,
			modelId: value.model.modelId,
		};
	}
	return request;
}

function validateTranscriptTurn(value: unknown): AgentTranscriptTurn {
	if (!isRecord(value)) {
		throw new Error("Invalid transcript turn.");
	}
	if (typeof value.id !== "string" || value.id.trim() === "") {
		throw new Error("Invalid transcript turn id.");
	}
	if (value.role !== "user" && value.role !== "assistant") {
		throw new Error("Invalid transcript turn role.");
	}
	if (typeof value.content !== "string") {
		throw new Error("Invalid transcript turn content.");
	}
	return { id: value.id, role: value.role, content: value.content };
}
