import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	type AgentSession,
	type AgentSessionEvent,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	AgentBridgeEvent,
	AgentPromptRequest,
	AgentPromptResponse,
	AgentTranscriptTurn,
	AuthBridgeEvent,
	ModelCatalogRequest,
	ModelCatalogResponse,
	ModelInfo,
	KnowledgeCandidate,
	KnowledgeDiagramCandidate,
	KnowledgeRelationCandidate,
	KnowledgeExtractionRequest,
	KnowledgeExtractionResponse,
	ProviderActionResponse,
	ProviderId,
	ProviderStatusResponse,
	SummaryRequest,
	SummaryResponse,
	WorkspaceDiffResponse,
} from "../../src/shared/ipc.js";
import { WorktreeService } from "./worktree-service.js";

const defaultProviderId: ProviderId = "github-copilot";
type PiModel = Model<Api>;

interface ActiveSession {
	session: AgentSession;
	sourceWorkspacePath: string;
	workspacePath: string;
	isolated: boolean;
	frontendSessionId: string;
	modelKey?: string;
	unsubscribe: () => void;
}

export class PiService {
	private readonly agentDir: string;
	private modelRuntimePromise: Promise<ModelRuntime> | undefined;
	private readonly activeSessions = new Map<string, ActiveSession>();
	private readonly worktreeService: WorktreeService;

	constructor(
		userDataPath: string,
		private readonly emitAuthEvent: (event: AuthBridgeEvent) => void = () => {},
		private readonly emitAgentEvent: (event: AgentBridgeEvent) => void = () => {},
		agentDir: string = getAgentDir(),
	) {
		this.agentDir = agentDir;
		this.worktreeService = new WorktreeService(userDataPath);
	}

	async getProviderStatus(
		providerId: ProviderId = defaultProviderId,
	): Promise<ProviderStatusResponse> {
		try {
			const runtime = await this.getModelRuntime();
			const status = runtime.getProviderAuthStatus(providerId);
			return {
				providerId,
				configured: status.configured,
				source: status.source,
				label: status.label,
			};
		} catch (error) {
			return {
				providerId,
				configured: false,
				error: errorToMessage(error),
			};
		}
	}

	async loginProvider(providerId: ProviderId): Promise<ProviderActionResponse> {
		try {
			const runtime = await this.getModelRuntime();
			await runtime.login(providerId, "oauth", {
				prompt: async (prompt) => {
					if (/enterprise.*(?:url|domain)|(?:url|domain).*enterprise/i.test(prompt.message)) {
						this.emitAuthEvent({
							type: "progress",
							message: "Using github.com for GitHub Copilot authentication.",
						});
						return "";
					}
					this.emitAuthEvent({
						type: "progress",
						message: `Authentication prompt required: ${prompt.message}`,
					});
					throw new Error(
						"Authentication requires an unsupported secret text prompt.",
					);
				},
				notify: (event) => this.emitAuthEvent(toAuthBridgeEvent(event)),
			});
			return {
				ok: true,
				status: await this.getProviderStatus(providerId),
			};
		} catch (error) {
			return {
				ok: false,
				status: await this.getProviderStatus(providerId),
				error: errorToMessage(error),
			};
		}
	}

	async logoutProvider(providerId: ProviderId): Promise<ProviderActionResponse> {
		try {
			const runtime = await this.getModelRuntime();
			await runtime.logout(providerId);
			this.disposeAllSessions();
			return {
				ok: true,
				status: await this.getProviderStatus(providerId),
			};
		} catch (error) {
			return {
				ok: false,
				status: await this.getProviderStatus(providerId),
				error: errorToMessage(error),
			};
		}
	}

	async getModelCatalog(
		request: ModelCatalogRequest = {},
	): Promise<ModelCatalogResponse> {
		const providerId = request.providerId ?? defaultProviderId;
		try {
			const runtime = await this.getModelRuntime();
			const status = runtime.getProviderAuthStatus(providerId);
			if (request.refresh && status.configured) {
				await runtime.refresh({ allowNetwork: true, force: true });
			}
			const models = status.configured
				? await runtime.getAvailable(providerId)
				: runtime.getModels(providerId);
			return {
				models: models.map(toModelInfo),
				configured: status.configured,
			};
		} catch (error) {
			return {
				models: [],
				configured: false,
				error: errorToMessage(error),
			};
		}
	}

	async promptAgent(
		request: AgentPromptRequest,
		workspacePath: string,
	): Promise<AgentPromptResponse> {
		try {
			const runtime = await this.getModelRuntime();
			let model: PiModel | undefined;
			if (request.model) {
				model = runtime.getModel(request.model.providerId, request.model.modelId);
				if (!model) {
					throw new Error(
						`Unknown model: ${request.model.providerId}/${request.model.modelId}`,
					);
				}
			}
			const active = await this.getSession(workspacePath, request, model);
			const session = active.session;
			this.emitAgentEvent({
				type: "prompt_start",
				sessionId: session.sessionId,
				message: request.prompt,
			});
			await session.sendUserMessage(
				request.knowledgeContext
					? `<knowledge_context>\n${request.knowledgeContext}\n</knowledge_context>\n\n<user_question>\n${request.prompt}\n</user_question>`
					: request.prompt,
			);
			return {
				ok: true,
				sessionId: session.sessionId,
				assistantText: getLastAssistantText(session),
				reasoningText: getLastAssistantReasoning(session),
				workspacePath: active.workspacePath,
				isolated: active.isolated,
			};
		} catch (error) {
			return { ok: false, error: errorToMessage(error) };
		}
	}

	async getWorkspaceDiff(frontendSessionId: string): Promise<WorkspaceDiffResponse> {
		return this.worktreeService.diff(frontendSessionId);
	}

	async generateSummary(
		request: SummaryRequest,
		workspacePath: string,
	): Promise<SummaryResponse> {
		try {
			const runtime = await this.getModelRuntime();
			const model = request.model
				? runtime.getModel(request.model.providerId, request.model.modelId)
				: (await runtime.getAvailable(defaultProviderId))[0];
			if (!model) throw new Error("No configured model is available for summary generation.");
			const { session } = await createAgentSession({
				cwd: workspacePath,
				agentDir: this.agentDir,
				modelRuntime: runtime,
				model,
				sessionManager: SessionManager.inMemory(workspacePath, {
					id: `kb-summary-${crypto.randomUUID()}`,
				}),
				tools: [],
			});
			try {
				await session.sendUserMessage(
					`Create a concise semantic title for this user question. Return only the title, no quotes or explanation. Use 8-20 Chinese characters for Chinese input, otherwise at most 8 words.\n\n${request.text}`,
				);
				const summary = getLastAssistantText(session)?.replace(/^["'“”]+|["'“”]+$/g, "").trim();
				return summary ? { summary: summary.slice(0, 80) } : { error: "The model returned an empty title." };
			} finally {
				session.dispose();
			}
		} catch (error) {
			return { error: errorToMessage(error) };
		}
	}

	async extractKnowledge(
		request: KnowledgeExtractionRequest,
		workspacePath: string,
	): Promise<KnowledgeExtractionResponse> {
		try {
			const runtime = await this.getModelRuntime();
			const model = request.model
				? runtime.getModel(request.model.providerId, request.model.modelId)
				: (await runtime.getAvailable(defaultProviderId))[0];
			if (!model) throw new Error("No configured model is available for knowledge extraction.");
			const { session } = await createAgentSession({
				cwd: workspacePath,
				agentDir: this.agentDir,
				modelRuntime: runtime,
				model,
				thinkingLevel: "low",
				sessionManager: SessionManager.inMemory(workspacePath, {
					id: `kb-extract-${crypto.randomUUID()}`,
				}),
				tools: [],
			});
			try {
				await session.sendUserMessage(buildKnowledgeExtractionPrompt(request));
				const output = getLastAssistantText(session);
				if (!output) throw new Error("The model returned an empty extraction result.");
				return parseKnowledgeExtraction(output, request);
			} finally {
				session.dispose();
			}
		} catch (error) {
			return { entities: [], relations: [], diagrams: [], error: errorToMessage(error) };
		}
	}

	private async getModelRuntime(): Promise<ModelRuntime> {
		this.modelRuntimePromise ??= this.createModelRuntime();
		return this.modelRuntimePromise;
	}

	private async createModelRuntime(): Promise<ModelRuntime> {
		await mkdir(this.agentDir, { recursive: true });
		return ModelRuntime.create({
			authPath: path.join(this.agentDir, "auth.json"),
			modelsPath: path.join(this.agentDir, "models.json"),
			modelsStorePath: path.join(this.agentDir, "models-store.json"),
			allowModelNetwork: false,
		});
	}

	private async getSession(
		workspacePath: string,
		request: AgentPromptRequest,
		model: PiModel | undefined,
	): Promise<ActiveSession> {
		const modelKey = model ? `${model.provider}/${model.id}` : undefined;
		const activeSession = this.activeSessions.get(request.frontendSessionId);
		if (activeSession?.sourceWorkspacePath === workspacePath) {
			if (model && activeSession.modelKey !== modelKey) {
				await activeSession.session.setModel(model);
				activeSession.modelKey = modelKey;
			}
			activeSession.session.setThinkingLevel(request.thinkingLevel ?? "medium");
			return activeSession;
		}
		this.disposeSession(request.frontendSessionId);
		const sessionWorkspace = await this.worktreeService.resolveSessionWorkspace(
			workspacePath,
			request.frontendSessionId,
			request.writable === true,
		);
		const resourceLoader = new DefaultResourceLoader({
			cwd: sessionWorkspace.path,
			agentDir: this.agentDir,
			appendSystemPromptOverride: (base) => [
				...base,
				workspaceExplorationGuidance,
				responsePresentationGuidance,
			],
		});
		await resourceLoader.reload();
		const sessionManager = this.createBranchSessionManager(sessionWorkspace.path, request);
		const { session } = await createAgentSession({
			cwd: sessionWorkspace.path,
			agentDir: this.agentDir,
			modelRuntime: await this.getModelRuntime(),
			model,
			thinkingLevel: request.thinkingLevel ?? "medium",
			sessionManager,
			resourceLoader,
			tools: request.writable && sessionWorkspace.isolated
				? ["read", "grep", "find", "ls", "edit", "write", "bash"]
				: ["read", "grep", "find", "ls"],
		});
		const unsubscribe = session.subscribe((event) =>
			this.emitAgentEvent(toAgentBridgeEvent(session.sessionId, request.frontendSessionId, event)),
		);
		const created: ActiveSession = {
			session,
			sourceWorkspacePath: workspacePath,
			workspacePath: sessionWorkspace.path,
			isolated: sessionWorkspace.isolated,
			frontendSessionId: request.frontendSessionId,
			modelKey,
			unsubscribe,
		};
		this.activeSessions.set(request.frontendSessionId, created);
		return created;
	}

	private createBranchSessionManager(
		workspacePath: string,
		request: AgentPromptRequest,
	): SessionManager {
		const sessionManager = SessionManager.create(
			workspacePath,
			path.join(this.agentDir, "knowbranch-sessions"),
			{
				id: safeSessionId(request.frontendSessionId),
				parentSession: request.parentFrontendSessionId,
			},
		);
		const replayTranscript = request.forkedFromTurnId
			? throughTurn(request.transcript, request.forkedFromTurnId)
			: request.transcript;
		for (const turn of replayTranscript) {
			appendTranscriptTurn(sessionManager, turn);
		}
		if (request.parentFrontendSessionId || request.forkedFromTurnId) {
			sessionManager.appendCustomEntry("knowbranch.branch", {
				frontendSessionId: request.frontendSessionId,
				parentFrontendSessionId: request.parentFrontendSessionId,
				forkedFromTurnId: request.forkedFromTurnId,
				replayStrategy:
					"distinct persisted AgentSession seeded by replaying frontend transcript through fork point",
			});
		}
		return sessionManager;
	}

	private disposeSession(frontendSessionId: string): void {
		const activeSession = this.activeSessions.get(frontendSessionId);
		if (!activeSession) {
			return;
		}
		activeSession.unsubscribe();
		activeSession.session.dispose();
		this.activeSessions.delete(frontendSessionId);
	}

	private disposeAllSessions(): void {
		for (const frontendSessionId of this.activeSessions.keys()) {
			this.disposeSession(frontendSessionId);
		}
	}
}

function appendTranscriptTurn(
	sessionManager: SessionManager,
	turn: AgentTranscriptTurn,
): void {
	if (turn.role === "user") {
		sessionManager.appendMessage({
			role: "user",
			content: turn.content,
			timestamp: Date.now(),
		});
		return;
	}
	sessionManager.appendCustomMessageEntry(
		"knowbranch.replayed-assistant",
		`Assistant said earlier: ${turn.content}`,
		false,
		{ sourceTurnId: turn.id },
	);
}

function throughTurn(
	transcript: AgentTranscriptTurn[],
	forkedFromTurnId: string,
): AgentTranscriptTurn[] {
	const index = transcript.findIndex((turn) => turn.id === forkedFromTurnId);
	return index === -1 ? transcript : transcript.slice(0, index + 1);
}

function safeSessionId(frontendSessionId: string): string {
	return `kb-${frontendSessionId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function toModelInfo(model: PiModel): ModelInfo {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		api: model.api,
		reasoning: model.reasoning,
		input: [...model.input],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

type PiAuthEvent = Parameters<Parameters<ModelRuntime["login"]>[2]["notify"]>[0];

function toAuthBridgeEvent(event: PiAuthEvent): AuthBridgeEvent {
	if (event.type === "info") {
		return { ...event, links: event.links ? [...event.links] : undefined };
	}
	return { ...event };
}

function toAgentBridgeEvent(
	sessionId: string,
	frontendSessionId: string,
	event: AgentSessionEvent,
): AgentBridgeEvent {
	const stream = extractStreamDelta(event);
	return {
		type: event.type,
		sessionId,
		frontendSessionId,
		message: stream?.message ?? extractEventMessage(event),
		streamKind: stream?.kind,
		payload: sanitizeForRenderer(event),
	};
}

const workspaceExplorationGuidance = `## Workspace exploration
- The current working directory is the workspace selected by the user.
- For questions about code in the workspace, inspect it autonomously with ls, find, grep, and read before answering.
- Start with directory discovery when the user does not provide exact file paths. Do not claim that file paths are required unless workspace discovery tools have actually failed.
- Read-only tools may be used freely for analysis. Modify files only when edit, write, or bash tools are available and the user requested a change.`;

const responsePresentationGuidance = `## Response presentation
- When the answer explains a process, call chain, sequence, architecture, state transition, decision path, or relationship graph, prefer a concise Mermaid diagram over an ASCII diagram or arrow-filled code block.
- Use a fenced \`\`\`mermaid block with valid Mermaid syntax. Choose the diagram type that best matches the information, such as flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, or erDiagram.
- Add only the prose needed to explain the diagram. Do not add a diagram when plain text or executable source code is clearer.
- Keep node labels short. Quote labels that contain punctuation, parentheses, or other syntax-sensitive characters.`;

function extractStreamDelta(
	event: AgentSessionEvent,
): { message: string; kind: "text" | "reasoning" } | undefined {
	if (event.type !== "message_update" || !("assistantMessageEvent" in event)) return undefined;
	const update = event.assistantMessageEvent;
	if (update.type === "text_delta") return { message: update.delta, kind: "text" };
	if (update.type === "thinking_delta") return { message: update.delta, kind: "reasoning" };
	return undefined;
}

function extractEventMessage(event: AgentSessionEvent): string | undefined {
	if ("delta" in event && typeof event.delta === "string") {
		return event.delta;
	}
	if ("message" in event && typeof event.message === "string") {
		return event.message;
	}
	return undefined;
}

function getLastAssistantText(session: AgentSession): string | undefined {
	return getLastAssistantContent(session, "text");
}

function getLastAssistantReasoning(session: AgentSession): string | undefined {
	return getLastAssistantContent(session, "thinking");
}

function getLastAssistantContent(
	session: AgentSession,
	kind: "text" | "thinking",
): string | undefined {
	const messages = [...session.messages].reverse();
	const assistant = messages.find(
		(message) =>
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			(message as { role?: unknown }).role === "assistant",
	) as { content?: unknown } | undefined;
	if (!assistant) {
		return undefined;
	}
	if (typeof assistant.content === "string" && kind === "text") {
		return assistant.content;
	}
	if (Array.isArray(assistant.content)) {
		return assistant.content
			.map((part) => {
				if (
					typeof part === "object" &&
					part !== null &&
					kind in part &&
					typeof part[kind] === "string"
				) {
					return part[kind];
				}
				return "";
			})
			.join("")
			.trim();
	}
	return undefined;
}

function buildKnowledgeExtractionPrompt(request: KnowledgeExtractionRequest): string {
	const mermaidBlocks = [...request.answer.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)].map((match, sourceIndex) => ({
		sourceIndex,
		source: match[1].trim(),
	}));
	return `You are a conservative learning-gap detector for a personal knowledge workspace.

Decide whether the USER'S QUESTION demonstrates that the user does not understand a concept. Create knowledge entities only for those learning gaps.

Rules:
- Return zero entities for broad project summaries, status requests, task commands, or questions that merely mention technologies the user already appears to know.
- Do not create entities just because a term appears in the answer.
- A direct "what is X / explain X" question is explicit evidence. Infer uncertainty only when the wording strongly indicates confusion or a prerequisite is essential to understand the requested answer.
- Prefer zero entities when uncertain. Return at most 3.
- Return a new entity only when the question demonstrates a learning gap. When the answer materially corrects or extends an existing entity, return it with existingEntityId and a complete updated summary/content. Otherwise do not return it.
- Never overwrite an existing entity with a generic restatement. Preserve useful existing details and user-authored specificity.
- summary and content must describe the entity itself as standalone knowledge. Never quote, paraphrase, or refer to "the answer", "the project", "the user", or the conversation.
- summary is one concise sentence. content is a focused 2-4 sentence explanation of the entity: what it is, its purpose, and the key distinction needed for understanding.
- Extract only meaningful relations supported by the answer between returned or existing entities. Prefer stable existing IDs when available.
- Also extract every Mermaid block listed in MERMAID_BLOCKS as a structured diagram. Do not invent diagrams when MERMAID_BLOCKS is empty.
- For each diagram, choose existingDiagramId only when it represents the same subject as an EXISTING_DIAGRAM. Never choose the reserved "workspace-knowledge-map". Otherwise omit existingDiagramId to create a new diagram.
- Diagram node keys must be short stable identifiers. Every edge sourceKey and targetKey must reference a returned node key.
- Map Mermaid types to architecture, structure, flowchart, sequence, swimlane, or dependency.
- Return valid JSON only, with this exact shape:
{"entities":[{"existingEntityId":"optional-id","name":"...","type":"Concept|Component|Pattern|Technology|File","summary":"...","content":"...","confidence":"explicit|inferred"}],"relations":[{"sourceEntityId":"optional-id","targetEntityId":"optional-id","sourceName":"...","targetName":"...","type":"calls|depends_on|contains|implements|related_to","description":"...","confidence":"explicit|inferred"}],"diagrams":[{"sourceIndex":0,"name":"...","type":"sequence","existingDiagramId":"optional-id","nodes":[{"key":"user","label":"User","type":"actor"}],"edges":[{"sourceKey":"user","targetKey":"service","label":"request"}]}]}

EXISTING_ENTITIES:
${JSON.stringify(request.existingEntities)}

EXISTING_DIAGRAMS:
${JSON.stringify(request.existingDiagrams)}

MERMAID_BLOCKS:
${JSON.stringify(mermaidBlocks)}

USER_QUESTION:
${request.question}

ASSISTANT_ANSWER (evidence only, not a source to copy):
${request.answer}`;
}

function parseKnowledgeExtraction(
	output: string,
	request: KnowledgeExtractionRequest,
): KnowledgeExtractionResponse {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Knowledge extraction did not return JSON.");
	const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
	if (!isRecord(parsed) || !Array.isArray(parsed.entities)) {
		throw new Error("Knowledge extraction returned an invalid entity list.");
	}
	return {
		entities: parseKnowledgeCandidates(parsed.entities, request),
		relations: parseRelationCandidates(parsed.relations, request),
		diagrams: parseDiagramCandidates(parsed.diagrams, request),
	};
}

function parseKnowledgeCandidates(
	items: unknown[],
	request: KnowledgeExtractionRequest,
): KnowledgeCandidate[] {
	const existingIds = new Set(request.existingEntities.map((entity) => entity.id));
	const existingNames = new Set(request.existingEntities.flatMap((entity) => [entity.name, ...entity.aliases]).map((name) => name.trim().toLocaleLowerCase()));
	const selected = new Set<string>();
	return items.slice(0, 3).flatMap((candidate): KnowledgeCandidate[] => {
		if (!isRecord(candidate)) return [];
		const name = cleanCandidateText(candidate.name, 120);
		const type = cleanCandidateText(candidate.type, 60);
		const summary = cleanCandidateText(candidate.summary, 500);
		let content = cleanCandidateText(candidate.content, 2_000);
		if (!name || !type || !summary || !content) return [];
		const key = name.toLocaleLowerCase();
		const existingEntityId = typeof candidate.existingEntityId === "string" && existingIds.has(candidate.existingEntityId)
			? candidate.existingEntityId
			: undefined;
		if ((!existingEntityId && existingNames.has(key)) || selected.has(key)) return [];
		if (isCopiedPassage(content, request.answer)) {
			if (isCopiedPassage(summary, request.answer)) return [];
			content = summary;
		}
		selected.add(key);
		return [{
			existingEntityId,
			name,
			type,
			summary,
			content,
			confidence: candidate.confidence === "explicit" ? "explicit" : "inferred",
		}];
	});
}

function parseRelationCandidates(value: unknown, request: KnowledgeExtractionRequest): KnowledgeRelationCandidate[] {
	if (!Array.isArray(value)) return [];
	const existingIds = new Set(request.existingEntities.map((entity) => entity.id));
	return value.slice(0, 12).flatMap((candidate): KnowledgeRelationCandidate[] => {
		if (!isRecord(candidate)) return [];
		const sourceName = cleanCandidateText(candidate.sourceName, 120);
		const targetName = cleanCandidateText(candidate.targetName, 120);
		const type = cleanCandidateText(candidate.type, 80).toLocaleLowerCase().replace(/[^a-z0-9_]+/g, "_");
		const description = cleanCandidateText(candidate.description, 500);
		if (!sourceName || !targetName || !type || sourceName.toLocaleLowerCase() === targetName.toLocaleLowerCase()) return [];
		return [{
			sourceEntityId: typeof candidate.sourceEntityId === "string" && existingIds.has(candidate.sourceEntityId) ? candidate.sourceEntityId : undefined,
			targetEntityId: typeof candidate.targetEntityId === "string" && existingIds.has(candidate.targetEntityId) ? candidate.targetEntityId : undefined,
			sourceName,
			targetName,
			type,
			description,
			confidence: candidate.confidence === "explicit" ? "explicit" : "inferred",
		}];
	});
}

function parseDiagramCandidates(value: unknown, request: KnowledgeExtractionRequest): KnowledgeDiagramCandidate[] {
	if (!Array.isArray(value)) return [];
	const mermaidBlocks = [...request.answer.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)].map((match) => match[1].trim());
	const existingIds = new Set(request.existingDiagrams.map((diagram) => diagram.id));
	const diagramTypes = new Set<KnowledgeDiagramCandidate["type"]>(["architecture", "structure", "flowchart", "sequence", "swimlane", "dependency"]);
	return value.slice(0, mermaidBlocks.length).flatMap((candidate): KnowledgeDiagramCandidate[] => {
		if (!isRecord(candidate) || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return [];
		const sourceIndex = typeof candidate.sourceIndex === "number" ? Math.trunc(candidate.sourceIndex) : -1;
		const mermaidSource = mermaidBlocks[sourceIndex];
		const name = cleanCandidateText(candidate.name, 160);
		const type = diagramTypes.has(candidate.type as KnowledgeDiagramCandidate["type"])
			? candidate.type as KnowledgeDiagramCandidate["type"]
			: "flowchart";
		if (!mermaidSource || !name) return [];
		const nodes = candidate.nodes.slice(0, 100).flatMap((node) => {
			if (!isRecord(node)) return [];
			const key = cleanCandidateText(node.key, 100);
			const label = cleanCandidateText(node.label, 160);
			return key && label ? [{ key, label, type: cleanCandidateText(node.type, 60) || undefined }] : [];
		});
		const keys = new Set(nodes.map((node) => node.key));
		const edges = candidate.edges.slice(0, 200).flatMap((edge) => {
			if (!isRecord(edge)) return [];
			const sourceKey = cleanCandidateText(edge.sourceKey, 100);
			const targetKey = cleanCandidateText(edge.targetKey, 100);
			if (!keys.has(sourceKey) || !keys.has(targetKey)) return [];
			return [{ sourceKey, targetKey, label: cleanCandidateText(edge.label, 200) || undefined }];
		});
		if (nodes.length === 0) return [];
		const existingDiagramId = typeof candidate.existingDiagramId === "string" && existingIds.has(candidate.existingDiagramId) && candidate.existingDiagramId !== "workspace-knowledge-map"
			? candidate.existingDiagramId
			: undefined;
		return [{ name, type, existingDiagramId, mermaidSource, nodes, edges }];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanCandidateText(value: unknown, limit: number): string {
	return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function isCopiedPassage(value: string, answer: string): boolean {
	const normalized = value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
	return normalized.length >= 30 && answer.toLocaleLowerCase().replace(/\s+/g, " ").includes(normalized);
}

function sanitizeForRenderer(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (key, nestedValue: unknown) => {
			const lowerKey = key.toLowerCase();
			if (
				lowerKey.includes("token") ||
				lowerKey.includes("apikey") ||
				lowerKey.includes("api_key") ||
				lowerKey.includes("authorization")
			) {
				return "[redacted]";
			}
			return nestedValue;
		}),
	);
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
