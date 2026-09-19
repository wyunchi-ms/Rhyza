import { isRecord } from "./value.js";

export const KNOWBRANCH_BRIDGE_NAME = "knowbranch" as const;

export const ipcChannels = {
	providerStatus: "knowbranch:provider-status",
	providerLogin: "knowbranch:provider-login",
	providerLogout: "knowbranch:provider-logout",
	modelCatalog: "knowbranch:model-catalog",
	pluginList: "knowbranch:plugin-list",
	pluginInstall: "knowbranch:plugin-install",
	pluginSelectLocal: "knowbranch:plugin-select-local",
	pluginRemove: "knowbranch:plugin-remove",
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
	modelRequestHistory: "knowbranch:model-request-history",
	workspaceTodos: "knowbranch:workspace-todos",
	generateSummary: "knowbranch:generate-summary",
	extractKnowledge: "knowbranch:extract-knowledge",
	cancelAuxiliaryRequest: "knowbranch:cancel-auxiliary-request",

	openExternal: "knowbranch:open-external",
	appStateLoad: "knowbranch:app-state-load",
	appStateSave: "knowbranch:app-state-save",
	diagnosticReport: "knowbranch:diagnostic-report",

	forkDebugDump: "knowbranch:fork-debug-dump",
	agentEvent: "knowbranch:agent-event",
	authEvent: "knowbranch:auth-event",
} as const;

export type KnowbranchIpcChannel = (typeof ipcChannels)[keyof typeof ipcChannels];

export type ProviderId = "github-copilot" | "codex" | "claude-code";

export interface ProviderStatusRequest {
	providerId: ProviderId;
}

export interface ProviderStatusResponse {
	providerId: ProviderId;
	configured: boolean;
	source?: string;
	label?: string;
	error?: string;
	externalAuth?: boolean;
	setupInstructions?: string;
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

export interface PiPluginInfo {
	source: string;
	scope: "user" | "project";
	installed: boolean;
	installedPath?: string;
}

export interface PiPluginInstallRequest {
	source: string;
}
export interface PiPluginRemoveRequest {
	source: string;
}
export interface PiPluginMutationResponse {
	ok: true;
	plugins: PiPluginInfo[];
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

export interface SourceRefreshRequest {
	id: string;
}
export interface SourceArchiveRequest {
	id: string;
}
export interface SourceSearchRequest {
	query: string;
	sourceId?: string;
	limit?: number;
}
export interface SourceSearchHit {
	sourceId: string;
	path: string;
	line: number;
	preview: string;
}
export interface WorkspaceDiffRequest {
	frontendSessionId: string;
}
export interface WorkspaceDiffResponse {
	path: string;
	diff: string;
	status: string;
	isolated: boolean;
}
export interface WorkspaceExportPatchResponse {
	canceled: boolean;
	path?: string;
}

export interface AgentPromptRequest {
	frontendSessionId: string;
	frontendTurnId?: string;
	parentFrontendSessionId?: string;
	forkedFromTurnId?: string;
	transcript: AgentTranscriptTurn[];
	prompt: string;
	images?: AgentPromptImage[];
	knowledgeContext?: string;
	thinkingLevel?: "off" | "low" | "medium" | "high";
	model?: {
		providerId: ProviderId;
		/** Empty selects this provider's default model. */
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
	htmlPreviews?: import("./html-preview.js").HtmlPreviewDocument[];
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
	requestId?: string;
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
	/** Per-request subset of cacheWrite written with one-hour retention, when reported. */
	cacheWrite1h?: number;
	cost: number;
}

export interface KnowledgeCandidate {
	existingEntityId?: string;
	name: string;
	type: string;
	summary: string;
	content: string;
	confidence: "explicit" | "inferred";
	sourceScope: "workspace" | "general" | "mixed";
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
	type:
		| "architecture"
		| "structure"
		| "flowchart"
		| "sequence"
		| "swimlane"
		| "dependency"
		| "workflow"
		| "dataflow"
		| "lifecycle";
	existingDiagramId?: string;
	mermaidSource: string;

	nodes: Array<{ key: string; label: string; type?: string }>;
	edges: Array<{ sourceKey: string; targetKey: string; label?: string }>;
}

export interface KnowledgeExtractionRequest {
	question: string;
	answer: string;
	requestId?: string;
	existingEntities: Array<{
		id: string;
		name: string;
		aliases: string[];
		type: string;
		summary: string;
		content: string;
		sourceScope?: "workspace" | "general" | "mixed";
		version: number;
	}>;
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

export interface AuxiliaryRequestCancelRequest {
	requestId: string;
}

export interface OpenExternalRequest {
	url: string;
}
export interface AppStateSaveRequest {
	value: string;
	workspacePath: string;
}
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
	timings?: Record<
		string,
		{ count: number; totalMs: number; maxMs: number; totalBytes?: number; maxBytes?: number }
	>;
}

/** Actual cache configuration reported by a provider, not a model-based default. */
export interface AgentCacheEvidence {
	ttl: string;
	ttlMs: number;
	mode?: "implicit" | "explicit";
	semantics: "minimum";
	source: "response";
	/** Provider creation time; fall back to the recorded request start if absent. */
	startedAt?: string;
}

/** Small per-turn record retained when full request telemetry is evicted from app state. */
export type AgentCacheRequest = Pick<
	AgentModelRequestSnapshot,
	"model" | "timestamp" | "usage" | "cache"
>;

/** A provider-neutral context snapshot plus the final provider payload for one LLM call. */
export interface AgentModelRequestSnapshot {
	id: string;
	sequence: number;
	timestamp: string;
	model: string;
	provider: string;
	api: string;
	thinking: string;
	frontendTurnId?: string;
	contextWindow?: number;
	dumpPath?: string;
	context: {
		systemPrompt?: string;
		messages: unknown[];
		tools?: unknown[];
	};
	wirePayload?: unknown;
	usage?: AgentUsage;
	cache?: AgentCacheEvidence;
}

export interface ModelRequestHistoryRequest {
	frontendSessionId: string;
}
export interface ModelRequestHistoryResponse {
	turns: Record<string, AgentModelRequestSnapshot[]>;
}

export interface WorkspaceTodoNode {
	id: string;
	text: string;
	completed: boolean;
	line: number;
	children: WorkspaceTodoNode[];
}
export interface WorkspaceTodoFile {
	path: string;
	completed: number;
	total: number;
	nodes: WorkspaceTodoNode[];
}
export interface WorkspaceTodosRequest {
	frontendSessionId?: string;
}
export interface WorkspaceTodosResponse {
	workspacePath: string;
	completed: number;
	total: number;
	files: WorkspaceTodoFile[];
}

export interface ForkDebugDumpRequest {
	kind: "fork" | "selection-append";
	timestamp: string;
	selectedTurnId: string;
	snapshot: unknown;
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
	cache?: AgentCacheEvidence;
	requestId?: string;
	modelRequest?: AgentModelRequestSnapshot;
	wirePayload?: unknown;
}

export interface KnowbranchBridge {
	isElectron: true;
	providerStatus(request: ProviderStatusRequest): Promise<ProviderStatusResponse>;
	providerLogin(request: ProviderLoginRequest): Promise<ProviderActionResponse>;
	providerLogout(request: ProviderLogoutRequest): Promise<ProviderActionResponse>;
	modelCatalog(request?: ModelCatalogRequest): Promise<ModelCatalogResponse>;
	pluginList(): Promise<PiPluginInfo[]>;
	pluginInstall(request: PiPluginInstallRequest): Promise<PiPluginMutationResponse>;
	pluginSelectLocal(): Promise<{ source: string | null }>;
	pluginRemove(request: PiPluginRemoveRequest): Promise<PiPluginMutationResponse>;
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
	modelRequestHistory(request: ModelRequestHistoryRequest): Promise<ModelRequestHistoryResponse>;
	workspaceTodos(request?: WorkspaceTodosRequest): Promise<WorkspaceTodosResponse>;
	generateSummary(request: SummaryRequest): Promise<SummaryResponse>;
	extractKnowledge(request: KnowledgeExtractionRequest): Promise<KnowledgeExtractionResponse>;
	cancelAuxiliaryRequest(request: AuxiliaryRequestCancelRequest): Promise<{ canceled: boolean }>;

	openExternal(request: OpenExternalRequest): Promise<{ ok: true }>;
	appStateLoad(): string | null;
	appStateSave(request: AppStateSaveRequest): Promise<{ ok: true }>;
	diagnosticReport(report: DiagnosticReport): Promise<{ ok: true }>;

	forkDebugDump(request: ForkDebugDumpRequest): Promise<{ ok: true; path: string }>;
	onAuthEvent(listener: (event: AuthBridgeEvent) => void): () => void;
	onAgentEvent(listener: (event: AgentBridgeEvent) => void): () => void;
}

const providerIds = new Set<ProviderId>(["github-copilot", "codex", "claude-code"]);

function validateModelSelection(value: unknown): NonNullable<AgentPromptRequest["model"]> {
	if (
		!isRecord(value) ||
		!providerIds.has(value.providerId as ProviderId) ||
		typeof value.modelId !== "string" ||
		value.modelId.length > 200 ||
		/[\u0000-\u001f\u007f]/.test(value.modelId)
	) {
		throw new Error("Invalid model selection.");
	}
	return { providerId: value.providerId as ProviderId, modelId: value.modelId.trim() };
}

export function validateProviderStatusRequest(value: unknown): ProviderStatusRequest {
	if (!isRecord(value) || !providerIds.has(value.providerId as ProviderId)) {
		throw new Error("Invalid provider status request.");
	}
	return { providerId: value.providerId as ProviderId };
}

export const validateProviderLoginRequest = validateProviderStatusRequest;
export const validateProviderLogoutRequest = validateProviderStatusRequest;

export function validatePiPluginSource(value: unknown): { source: string } {
	const source = requirePiPluginSource(value);
	const supported =
		/^(npm:|git:|https?:\/\/|ssh:\/\/|git:\/\/)/i.test(source) ||
		/^[a-zA-Z]:[\\/]/.test(source) ||
		source.startsWith("\\\\") ||
		source.startsWith("/");
	if (!supported) {
		throw new Error("Use an npm:, git:, HTTPS, SSH, or absolute local path source.");
	}
	return { source };
}

export function validatePiPluginRemoveRequest(value: unknown): PiPluginRemoveRequest {
	return { source: requirePiPluginSource(value) };
}

function requirePiPluginSource(value: unknown): string {
	if (!isRecord(value) || typeof value.source !== "string") {
		throw new Error("A Pi package source is required.");
	}
	const source = value.source.trim();
	if (!source || source.length > 2_048 || /[\u0000-\u001f\u007f]/.test(source)) {
		throw new Error("Invalid Pi package source.");
	}
	return source;
}

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
	if (typeof value.frontendSessionId !== "string" || value.frontendSessionId.trim() === "") {
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
	if (typeof value.frontendTurnId === "string" && value.frontendTurnId.trim()) {
		request.frontendTurnId = value.frontendTurnId.slice(0, 180);
	}
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
		request.model = validateModelSelection(value.model);
	}
	request.writable = value.writable === true;
	return request;
}

export function validateModelRequestHistoryRequest(value: unknown): ModelRequestHistoryRequest {
	if (
		!isRecord(value) ||
		typeof value.frontendSessionId !== "string" ||
		!value.frontendSessionId.trim()
	) {
		throw new Error("A frontend session id is required for model request history.");
	}
	return { frontendSessionId: value.frontendSessionId.slice(0, 180) };
}

export function validateWorkspaceTodosRequest(value: unknown): WorkspaceTodosRequest {
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) throw new Error("Invalid workspace TODO request.");
	return typeof value.frontendSessionId === "string" && value.frontendSessionId.trim()
		? { frontendSessionId: value.frontendSessionId.slice(0, 180) }
		: {};
}

export function validateAppStateSaveRequest(value: unknown): AppStateSaveRequest {
	if (
		!isRecord(value) ||
		typeof value.value !== "string" ||
		typeof value.workspacePath !== "string" ||
		!value.workspacePath.trim()
	) {
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
		answer: value.answer.slice(0, 100_000),
		existingEntities: value.existingEntities.slice(0, 200).flatMap((entity) =>
			isRecord(entity) &&
			typeof entity.id === "string" &&
			typeof entity.name === "string" &&
			typeof entity.summary === "string"
				? [
						{
							id: entity.id.slice(0, 160),
							name: entity.name.slice(0, 120),
							aliases: Array.isArray(entity.aliases)
								? entity.aliases
										.filter((alias): alias is string => typeof alias === "string")
										.slice(0, 20)
								: [],
							type: typeof entity.type === "string" ? entity.type.slice(0, 60) : "Concept",
							summary: entity.summary.slice(0, 500),
							content: typeof entity.content === "string" ? entity.content.slice(0, 2_000) : "",
							sourceScope:
								entity.sourceScope === "workspace" ||
								entity.sourceScope === "general" ||
								entity.sourceScope === "mixed"
									? entity.sourceScope
									: undefined,
							version: typeof entity.version === "number" ? entity.version : 1,
						},
					]
				: [],
		),
		existingDiagrams: value.existingDiagrams.slice(0, 100).flatMap((diagram) =>
			isRecord(diagram) &&
			typeof diagram.id === "string" &&
			typeof diagram.name === "string" &&
			typeof diagram.type === "string" &&
			Array.isArray(diagram.nodeLabels)
				? [
						{
							id: diagram.id.slice(0, 160),
							name: diagram.name.slice(0, 160),
							type: diagram.type.slice(0, 60),
							nodeLabels: diagram.nodeLabels
								.slice(0, 100)
								.filter((label): label is string => typeof label === "string")
								.map((label) => label.slice(0, 160)),
						},
					]
				: [],
		),
	};
	if (value.model !== undefined) {
		request.model = validateModelSelection(value.model);
	}
	if (typeof value.requestId === "string" && value.requestId.trim()) {
		request.requestId = value.requestId.slice(0, 180);
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
	if (!isRecord(value) || typeof value.query !== "string")
		throw new Error("A search query is required.");
	return {
		query: value.query.trim(),
		sourceId: typeof value.sourceId === "string" ? value.sourceId : undefined,
		limit: typeof value.limit === "number" ? Math.max(1, Math.min(100, value.limit)) : 30,
	};
}

export function validateForkDebugDumpRequest(value: unknown): ForkDebugDumpRequest {
	if (
		!isRecord(value) ||
		(value.kind !== "fork" && value.kind !== "selection-append") ||
		typeof value.timestamp !== "string" ||
		typeof value.selectedTurnId !== "string" ||
		!isRecord(value.snapshot)
	) {
		throw new Error("Invalid fork debug dump.");
	}
	return {
		kind: value.kind,
		timestamp: value.timestamp,
		selectedTurnId: value.selectedTurnId,
		snapshot: value.snapshot,
	};
}

export function validateWorkspaceDiffRequest(value: unknown): WorkspaceDiffRequest {
	if (
		!isRecord(value) ||
		typeof value.frontendSessionId !== "string" ||
		value.frontendSessionId.trim() === ""
	) {
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
		request.model = validateModelSelection(value.model);
	}
	if (typeof value.requestId === "string" && value.requestId.trim()) {
		request.requestId = value.requestId.slice(0, 180);
	}
	return request;
}

export function validateAuxiliaryRequestCancelRequest(
	value: unknown,
): AuxiliaryRequestCancelRequest {
	if (!isRecord(value) || typeof value.requestId !== "string" || !value.requestId.trim()) {
		throw new Error("An auxiliary request id is required.");
	}
	return { requestId: value.requestId.slice(0, 180) };
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
	return {
		id: value.id,
		role: value.role,
		content: value.content,
		...(images.length ? { images } : {}),
	};
}

function validatePromptImages(value: unknown): AgentPromptImage[] {
	if (!Array.isArray(value)) return [];
	const allowedMimeTypes = new Set([
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
		"image/bmp",
	]);
	return value.slice(0, 4).flatMap((image) => {
		if (!isRecord(image) || typeof image.data !== "string" || image.data.length > 6_000_000)
			return [];
		return typeof image.mimeType === "string" && allowedMimeTypes.has(image.mimeType)
			? [{ mimeType: image.mimeType as AgentPromptImage["mimeType"], data: image.data }]
			: [];
	});
}
