export const KNOWBRANCH_BRIDGE_NAME = "knowbranch" as const;

export const ipcChannels = {
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

export interface SourceInfo {
	id: string;
	name: string;
	path: string;
	fileCount: number;
	status: "pending" | "scanning" | "indexed" | "stale" | "error" | "archived";
	type: "repo" | "docs";
	revision?: string;
	indexedAt?: string;
	error?: string;
}

export interface SourceRefreshRequest { id: string }
export interface SourceArchiveRequest { id: string }
export interface SourceSearchRequest { query: string; sourceId?: string; limit?: number }
export interface SourceSearchHit { sourceId: string; path: string; line: number; preview: string }
export interface WorkspaceDiffRequest { frontendSessionId: string }
export interface WorkspaceDiffResponse { path: string; diff: string; status: string; isolated: boolean }
export interface WorkspaceExportPatchResponse { canceled: boolean; path?: string }

export interface AgentPromptRequest {
	frontendSessionId: string;
	parentFrontendSessionId?: string;
	forkedFromTurnId?: string;
	transcript: AgentTranscriptTurn[];
	prompt: string;
	images?: AgentPromptImage[];
	knowledgeContext?: string;
	thinkingLevel?: "off" | "low" | "medium" | "high";
	model?: {
		providerId: ProviderId;
		modelId: string;
	};
	writable?: boolean;
}

export interface AgentPromptImage {
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp";
	data: string;
}

export interface AgentTranscriptTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
	images?: AgentPromptImage[];
}

export interface AgentPromptResponse {
	ok: boolean;
	sessionId?: string;
	assistantText?: string;
	reasoningText?: string;
	usage?: AgentUsage;
	error?: string;
	workspacePath?: string;
	isolated?: boolean;
	sourceRefs?: Array<{
		sourceId: string;
		path: string;
		revision?: string;
		lineStart?: number;
		lineEnd?: number;
	}>;
}

export interface SummaryRequest {
	text: string;
	model?: { providerId: ProviderId; modelId: string };
}

export interface SummaryResponse {
	summary?: string;
	error?: string;
	usage?: AgentUsage;
}

export interface AgentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface KnowledgeCandidate {
	existingEntityId?: string;
	name: string;
	type: string;
	summary: string;
	content: string;
	confidence: "explicit" | "inferred";
}

export interface KnowledgeRelationCandidate {
	sourceEntityId?: string;
	targetEntityId?: string;
	sourceName: string;
	targetName: string;
	type: string;
	description: string;
	confidence: "explicit" | "inferred";
}

export interface KnowledgeDiagramCandidate {
	name: string;
	type: "architecture" | "structure" | "flowchart" | "sequence" | "swimlane" | "dependency";
	existingDiagramId?: string;
	mermaidSource: string;
	nodes: Array<{ key: string; label: string; type?: string }>;
	edges: Array<{ sourceKey: string; targetKey: string; label?: string }>;
}

export interface KnowledgeExtractionRequest {
	question: string;
	answer: string;
	existingEntities: Array<{ id: string; name: string; aliases: string[]; type: string; summary: string; content: string; version: number }>;
	existingDiagrams: Array<{ id: string; name: string; type: string; nodeLabels: string[] }>;
	model?: { providerId: ProviderId; modelId: string };
}

export interface KnowledgeExtractionResponse {
	entities: KnowledgeCandidate[];
	relations: KnowledgeRelationCandidate[];
	diagrams: KnowledgeDiagramCandidate[];
	error?: string;
	usage?: AgentUsage;
}

export interface OpenExternalRequest { url: string }
export interface AppStateSaveRequest { value: string; workspacePath: string }
export interface DiagnosticReport {
	timestamp: string;
	route: string;
	visibility: string;
	uptimeMs: number;
	domNodes: number;
	memoryBytes?: number;
	activeSessionId?: string;
	turnCount: number;
	runningTurnCount: number;
	entityCount: number;
	longTasks: { count: number; totalMs: number; maxMs: number };
	heartbeat: { delayedCount: number; totalDelayMs: number; maxDelayMs: number };
	regionStalls: Record<string, number>;
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
	frontendSessionId?: string;
	message?: string;
	streamKind?: "text" | "reasoning";
	payload?: unknown;
	usage?: AgentUsage;
}

export interface KnowbranchBridge {
	isElectron: true;
	providerStatus(request: ProviderStatusRequest): Promise<ProviderStatusResponse>;
	providerLogin(request: ProviderLoginRequest): Promise<ProviderActionResponse>;
	providerLogout(request: ProviderLogoutRequest): Promise<ProviderActionResponse>;
	modelCatalog(request?: ModelCatalogRequest): Promise<ModelCatalogResponse>;
	getWorkspace(): Promise<WorkspaceInfo>;
	selectWorkspace(): Promise<WorkspaceInfo>;
	sourceList(): Promise<SourceInfo[]>;
	sourceAdd(): Promise<SourceInfo[]>;
	sourceRefresh(request: SourceRefreshRequest): Promise<SourceInfo>;
	sourceArchive(request: SourceArchiveRequest): Promise<SourceInfo>;
	sourceSearch(request: SourceSearchRequest): Promise<SourceSearchHit[]>;
	workspaceDiff(request: WorkspaceDiffRequest): Promise<WorkspaceDiffResponse>;
	workspaceExportPatch(request: WorkspaceDiffRequest): Promise<WorkspaceExportPatchResponse>;
	agentPrompt(request: AgentPromptRequest): Promise<AgentPromptResponse>;
	generateSummary(request: SummaryRequest): Promise<SummaryResponse>;
	extractKnowledge(request: KnowledgeExtractionRequest): Promise<KnowledgeExtractionResponse>;
	openExternal(request: OpenExternalRequest): Promise<{ ok: true }>;
	appStateLoad(): string | null;
	appStateSave(request: AppStateSaveRequest): Promise<{ ok: true }>;
	diagnosticReport(report: DiagnosticReport): Promise<{ ok: true }>;
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
	const images = validatePromptImages(value.images);
	if (typeof value.prompt !== "string" || (value.prompt.trim() === "" && images.length === 0)) {
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
	if (images.length) request.images = images;
	if (typeof value.parentFrontendSessionId === "string") {
		request.parentFrontendSessionId = value.parentFrontendSessionId;
	}
	if (typeof value.forkedFromTurnId === "string") {
		request.forkedFromTurnId = value.forkedFromTurnId;
	}
	if (typeof value.knowledgeContext === "string") {
		request.knowledgeContext = value.knowledgeContext.slice(0, 20_000);
	}
	if (["off", "low", "medium", "high"].includes(String(value.thinkingLevel))) {
		request.thinkingLevel = value.thinkingLevel as AgentPromptRequest["thinkingLevel"];
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
	request.writable = value.writable === true;
	return request;
}

export function validateAppStateSaveRequest(value: unknown): AppStateSaveRequest {
	if (!isRecord(value) || typeof value.value !== "string" || typeof value.workspacePath !== "string" || !value.workspacePath.trim()) {
		throw new Error("Invalid app state payload.");
	}
	return { value: value.value, workspacePath: value.workspacePath };
}

export function validateKnowledgeExtractionRequest(value: unknown): KnowledgeExtractionRequest {
	if (!isRecord(value) || typeof value.question !== "string" || !value.question.trim()) {
		throw new Error("A question is required for knowledge extraction.");
	}
	if (typeof value.answer !== "string" || !value.answer.trim()) {
		throw new Error("An answer is required for knowledge extraction.");
	}
	if (!Array.isArray(value.existingEntities)) {
		throw new Error("Existing entities must be an array.");
	}
	if (!Array.isArray(value.existingDiagrams)) {
		throw new Error("Existing diagrams must be an array.");
	}
	const request: KnowledgeExtractionRequest = {
		question: value.question.slice(0, 8_000),
		answer: value.answer.slice(0, 24_000),
		existingEntities: value.existingEntities.slice(0, 200).flatMap((entity) =>
			isRecord(entity) && typeof entity.id === "string" && typeof entity.name === "string" && typeof entity.summary === "string"
				? [{
					id: entity.id.slice(0, 160),
					name: entity.name.slice(0, 120),
					aliases: Array.isArray(entity.aliases) ? entity.aliases.filter((alias): alias is string => typeof alias === "string").slice(0, 20) : [],
					type: typeof entity.type === "string" ? entity.type.slice(0, 60) : "Concept",
					summary: entity.summary.slice(0, 500),
					content: typeof entity.content === "string" ? entity.content.slice(0, 2_000) : "",
					version: typeof entity.version === "number" ? entity.version : 1,
				}]
				: [],
		),
		existingDiagrams: value.existingDiagrams.slice(0, 100).flatMap((diagram) =>
			isRecord(diagram) && typeof diagram.id === "string" && typeof diagram.name === "string" && typeof diagram.type === "string" && Array.isArray(diagram.nodeLabels)
				? [{
					id: diagram.id.slice(0, 160),
					name: diagram.name.slice(0, 160),
					type: diagram.type.slice(0, 60),
					nodeLabels: diagram.nodeLabels.slice(0, 100).filter((label): label is string => typeof label === "string").map((label) => label.slice(0, 160)),
				}]
				: [],
		),
	};
	if (value.model !== undefined) {
		if (!isRecord(value.model) || !providerIds.has(value.model.providerId as ProviderId) || typeof value.model.modelId !== "string") {
			throw new Error("Invalid model selection.");
		}
		request.model = { providerId: value.model.providerId as ProviderId, modelId: value.model.modelId };
	}
	return request;
}

export function validateIdRequest(value: unknown): { id: string } {
	if (!isRecord(value) || typeof value.id !== "string" || value.id.trim() === "") {
		throw new Error("A valid id is required.");
	}
	return { id: value.id };
}

export function validateSourceSearchRequest(value: unknown): SourceSearchRequest {
	if (!isRecord(value) || typeof value.query !== "string") throw new Error("A search query is required.");
	return {
		query: value.query.trim(),
		sourceId: typeof value.sourceId === "string" ? value.sourceId : undefined,
		limit: typeof value.limit === "number" ? Math.max(1, Math.min(100, value.limit)) : 30,
	};
}

export function validateWorkspaceDiffRequest(value: unknown): WorkspaceDiffRequest {
	if (!isRecord(value) || typeof value.frontendSessionId !== "string" || value.frontendSessionId.trim() === "") {
		throw new Error("A frontend session id is required.");
	}
	return { frontendSessionId: value.frontendSessionId };
}

export function validateSummaryRequest(value: unknown): SummaryRequest {
	if (!isRecord(value) || typeof value.text !== "string" || value.text.trim() === "") {
		throw new Error("Text is required for summary generation.");
	}
	const request: SummaryRequest = { text: value.text.trim().slice(0, 4_000) };
	if (value.model !== undefined) {
		if (
			!isRecord(value.model) ||
			!providerIds.has(value.model.providerId as ProviderId) ||
			typeof value.model.modelId !== "string"
		) {
			throw new Error("Invalid summary model.");
		}
		request.model = {
			providerId: value.model.providerId as ProviderId,
			modelId: value.model.modelId,
		};
	}
	return request;
}

export function validateOpenExternalRequest(value: unknown): OpenExternalRequest {
	if (!isRecord(value) || typeof value.url !== "string") throw new Error("A URL is required.");
	const url = new URL(value.url);
	if (url.protocol !== "https:") throw new Error("Only HTTPS URLs can be opened externally.");
	return { url: url.toString() };
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
	const images = validatePromptImages(value.images);
	return { id: value.id, role: value.role, content: value.content, ...(images.length ? { images } : {}) };
}

function validatePromptImages(value: unknown): AgentPromptImage[] {
	if (!Array.isArray(value)) return [];
	const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);
	return value.slice(0, 4).flatMap((image) => {
		if (!isRecord(image) || typeof image.data !== "string" || image.data.length > 6_000_000) return [];
		return typeof image.mimeType === "string" && allowedMimeTypes.has(image.mimeType)
			? [{ mimeType: image.mimeType as AgentPromptImage["mimeType"], data: image.data }]
			: [];
	});
}
