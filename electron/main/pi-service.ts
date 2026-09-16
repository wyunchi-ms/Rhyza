import { collectHtmlPreviews } from "./html-preview-service.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	type AgentSession,
	type AgentSessionEvent,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type {
	AgentBridgeEvent,
	AgentUsage,
	AgentModelRequestSnapshot,
	AgentPromptRequest,
	AgentPromptResponse,
	AuthBridgeEvent,
	ModelCatalogRequest,
	ModelCatalogResponse,
	ModelInfo,
	ModelRequestHistoryResponse,
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
	WorkspaceTodosResponse,
} from "../../src/shared/ipc.js";
import { WorktreeService } from "./worktree-service.js";
import type { SourceService } from "./source-service.js";
import { openOrCreatePiSession } from "./pi-session-lineage.js";
import { errorToMessage, isRecord } from "../../src/shared/value.js";
import { readWorkspaceTodos } from "./todo-service.js";
import { responseCacheEvidence } from "../../src/shared/cacheEvidence.js";

const defaultProviderId: ProviderId = "github-copilot";
type PiModel = Model<Api>;

interface ActiveSession {
	session: AgentSession;
	sourceWorkspacePath: string;
	workspacePath: string;
	isolated: boolean;
	frontendSessionId: string;
	frontendTurnId?: string;
	modelKey?: string;

	unsubscribe: () => void;
	sourceRefs: Map<string, SourceReference>;
}

type SourceReference = NonNullable<AgentPromptResponse["sourceRefs"]>[number];

export class PiService {
	private readonly agentDir: string;
	private readonly requestDumpDir: string;
	private modelRuntimePromise: Promise<ModelRuntime> | undefined;
	private readonly activeSessions = new Map<string, ActiveSession>();
	private readonly worktreeService: WorktreeService;

	constructor(
		userDataPath: string,
		private readonly emitAuthEvent: (event: AuthBridgeEvent) => void = () => {},
		private readonly emitAgentEvent: (event: AgentBridgeEvent) => void = () => {},
		agentDir: string = getAgentDir(),
		private readonly sourceService?: SourceService,
	) {
		this.agentDir = agentDir;
		this.requestDumpDir = path.join(userDataPath, "model-request-dumps");
		this.worktreeService = new WorktreeService(userDataPath);
	}

	async getModelRequestHistory(frontendSessionId: string): Promise<ModelRequestHistoryResponse> {
		const sessionDirectory = path.join(this.requestDumpDir, safeDumpPart(frontendSessionId));
		const turns: ModelRequestHistoryResponse["turns"] = {};
		try {
			const turnDirectories = await readdir(sessionDirectory, { withFileTypes: true });
			for (const turnDirectory of turnDirectories) {
				if (!turnDirectory.isDirectory()) continue;
				const turnId = turnDirectory.name;
				const directoryPath = path.join(sessionDirectory, turnId);
				const filenames = (await readdir(directoryPath)).filter((filename) =>
					filename.endsWith(".json"),
				);
				for (const filename of filenames) {
					try {
						const parsed = JSON.parse(await readFile(path.join(directoryPath, filename), "utf8"));
						if (!isModelRequestSnapshot(parsed) || safeDumpPart(parsed.frontendTurnId) !== turnId)
							continue;
						(turns[parsed.frontendTurnId] ??= []).push(parsed);
					} catch (error) {
						console.warn(`Could not read model request dump ${filename}: ${errorToMessage(error)}`);
					}
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.warn(`Could not read model request history: ${errorToMessage(error)}`);
			}
		}
		for (const snapshots of Object.values(turns)) {
			snapshots.sort(
				(left, right) =>
					left.sequence - right.sequence || left.timestamp.localeCompare(right.timestamp),
			);
		}
		return { turns };
	}

	async getWorkspaceTodos(
		frontendSessionId: string | undefined,
		workspacePath: string,
	): Promise<WorkspaceTodosResponse> {
		const effectiveWorkspacePath = frontendSessionId
			? (this.activeSessions.get(frontendSessionId)?.workspacePath ?? workspacePath)
			: workspacePath;
		return readWorkspaceTodos(effectiveWorkspacePath);
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
					throw new Error("Authentication requires an unsupported secret text prompt.");
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

	async getModelCatalog(request: ModelCatalogRequest = {}): Promise<ModelCatalogResponse> {
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
		const promptUsage = emptyAgentUsage();
		try {
			const runtime = await this.getModelRuntime();
			let model: PiModel | undefined;
			if (request.model) {
				model = runtime.getModel(request.model.providerId, request.model.modelId);
				if (!model) {
					throw new Error(`Unknown model: ${request.model.providerId}/${request.model.modelId}`);
				}
			}
			const active = await this.getSession(workspacePath, request, model);
			active.sourceRefs.clear();
			const session = active.session;
			this.emitAgentEvent({
				type: "prompt_start",
				sessionId: session.sessionId,
				message: request.prompt,
			});
			const unsubscribeUsage = session.subscribe((event) => {
				const usage = getEventUsage(event);
				if (usage) addUsage(promptUsage, usage);
			});
			try {
				const promptText = request.knowledgeContext
					? `<knowledge_context>\n${request.knowledgeContext}\n</knowledge_context>\n\n<user_question>\n${request.prompt}\n</user_question>`
					: request.prompt;
				const promptContent: string | Array<{ type: "text"; text: string } | ImageContent> = request
					.images?.length
					? [
							{ type: "text", text: promptText },
							...request.images.map((image): ImageContent => ({
								type: "image",
								data: image.data,
								mimeType: image.mimeType,
							})),
						]
					: promptText;
				await session.sendUserMessage(promptContent);
			} finally {
				unsubscribeUsage();
			}
			return {
				ok: true,
				sessionId: session.sessionId,
				assistantText: getLastAssistantText(session),
				htmlPreviews: await collectHtmlPreviews(
					getLastAssistantText(session) ?? "",
					active.workspacePath,
				),
				reasoningText: getLastAssistantReasoning(session),
				usage: hasUsage(promptUsage) ? promptUsage : undefined,
				workspacePath: active.workspacePath,
				isolated: active.isolated,
				sourceRefs: [...active.sourceRefs.values()],
			};
		} catch (error) {
			return {
				ok: false,
				error: errorToMessage(error),
				usage: hasUsage(promptUsage) ? promptUsage : undefined,
			};
		}
	}

	async getWorkspaceDiff(frontendSessionId: string): Promise<WorkspaceDiffResponse> {
		return this.worktreeService.diff(frontendSessionId);
	}

	async generateSummary(request: SummaryRequest, workspacePath: string): Promise<SummaryResponse> {
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
				const summary = getLastAssistantText(session)
					?.replace(/^["'“”]+|["'“”]+$/g, "")
					.trim();
				const usage = getSessionUsage(session);
				return summary
					? { summary: summary.slice(0, 80), usage }
					: { error: "The model returned an empty title.", usage };
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
				return { ...parseKnowledgeExtraction(output, request), usage: getSessionUsage(session) };
			} finally {
				session.dispose();
			}
		} catch (error) {
			return {
				entities: [],
				relations: [],
				diagrams: extractDiagramCandidates(request),
				error: errorToMessage(error),
			};
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
			activeSession.frontendTurnId = request.frontendTurnId;
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
				todoTrackingGuidance,
				...(this.sourceService ? [sourceRetrievalGuidance] : []),
				responsePresentationGuidance,
			],
		});
		await resourceLoader.reload();
		const extensionToolNames = resourceLoader
			.getExtensions()
			.extensions.flatMap((extension) => [...extension.tools.keys()]);
		const { sessionManager } = await openOrCreatePiSession({
			workspacePath: sessionWorkspace.path,
			sessionDir: path.join(this.agentDir, "knowbranch-sessions"),
			frontendSessionId: request.frontendSessionId,
			parentFrontendSessionId: request.parentFrontendSessionId,
			forkedFromTurnId: request.forkedFromTurnId,
			transcript: request.transcript,
		});
		const sourceRefs = new Map<string, SourceReference>();
		const customTools = this.createSourceTools(sourceRefs, workspacePath);
		const builtInTools =
			request.writable && sessionWorkspace.isolated
				? ["read", "grep", "find", "ls", "edit", "write", "bash"]
				: ["read", "grep", "find", "ls"];
		const { session } = await createAgentSession({
			cwd: sessionWorkspace.path,
			agentDir: this.agentDir,
			modelRuntime: await this.getModelRuntime(),
			model,
			thinkingLevel: request.thinkingLevel ?? "medium",
			sessionManager,
			resourceLoader,
			tools: [
				...new Set([
					...builtInTools,
					...customTools.map((tool) => tool.name),
					...extensionToolNames,
				]),
			],
			customTools,
		});
		let requestSequence = 0;
		let activeRequestId: string | undefined;
		let activeSnapshot: AgentModelRequestSnapshot | undefined;
		const originalStream = session.agent.streamFunction;
		session.agent.streamFunction = async (requestModel, context, options) => {
			activeRequestId = crypto.randomUUID();
			const frontendTurnId = created.frontendTurnId ?? "unmapped";
			const dumpPath = path.join(
				this.requestDumpDir,
				safeDumpPart(request.frontendSessionId),
				safeDumpPart(frontendTurnId),
				`${String(requestSequence + 1).padStart(3, "0")}-${activeRequestId}.json`,
			);
			const snapshot: AgentModelRequestSnapshot = {
				id: activeRequestId,
				sequence: ++requestSequence,
				timestamp: new Date().toISOString(),
				model: requestModel.id,
				provider: requestModel.provider,
				api: requestModel.api,
				thinking: options?.reasoning ?? "off",
				frontendTurnId,
				contextWindow: requestModel.contextWindow,
				dumpPath,
				context: sanitizeForRenderer(context) as AgentModelRequestSnapshot["context"],
			};
			activeSnapshot = snapshot;
			await writeRequestDump(dumpPath, snapshot);
			this.emitAgentEvent({
				type: "model_request",
				sessionId: session.sessionId,
				frontendSessionId: request.frontendSessionId,
				requestId: activeRequestId,
				modelRequest: snapshot,
			});
			return originalStream(requestModel, context, options);
		};
		const originalOnPayload = session.agent.onPayload;
		session.agent.onPayload = async (payload, payloadModel) => {
			const transformed = originalOnPayload
				? await originalOnPayload(payload, payloadModel)
				: payload;
			const finalPayload = transformed === undefined ? payload : transformed;
			const sanitizedPayload = sanitizeForRenderer(finalPayload);
			if (activeSnapshot) {
				activeSnapshot = { ...activeSnapshot, wirePayload: sanitizedPayload };
				if (activeSnapshot.dumpPath)
					await writeRequestDump(activeSnapshot.dumpPath, activeSnapshot);
			}
			this.emitAgentEvent({
				type: "wire_request",
				sessionId: session.sessionId,
				frontendSessionId: request.frontendSessionId,
				requestId: activeRequestId,
				wirePayload: sanitizedPayload,
			});
			return transformed;
		};
		const unsubscribe = session.subscribe((event) => {
			this.emitAgentEvent(
				toAgentBridgeEvent(session.sessionId, request.frontendSessionId, event, activeRequestId),
			);
			if (
				event.type === "message_end" &&
				"message" in event &&
				typeof event.message === "object" &&
				event.message !== null &&
				"role" in event.message &&
				event.message.role === "assistant"
			) {
				const usage = getEventUsage(event);
				if (activeSnapshot && usage) {
					activeSnapshot = {
						...activeSnapshot,
						usage,
						cache: responseCacheEvidence(event.message),
					};
					if (activeSnapshot.dumpPath)
						void writeRequestDump(activeSnapshot.dumpPath, activeSnapshot);
				}
				activeRequestId = undefined;
				activeSnapshot = undefined;
			}
		});
		const created: ActiveSession = {
			session,
			sourceWorkspacePath: workspacePath,
			workspacePath: sessionWorkspace.path,
			isolated: sessionWorkspace.isolated,
			frontendSessionId: request.frontendSessionId,
			frontendTurnId: request.frontendTurnId,
			modelKey,
			unsubscribe,
			sourceRefs,
		};
		this.activeSessions.set(request.frontendSessionId, created);
		return created;
	}

	private createSourceTools(sourceRefs: Map<string, SourceReference>, workspacePath: string) {
		if (!this.sourceService) return [];
		const searchSources = defineTool({
			name: "search_sources",
			label: "Search sources",
			description:
				"Search repositories and documentation attached to this workspace, including material outside the current working directory.",
			parameters: Type.Object({
				query: Type.String({ description: "Terms, symbol names, or concepts to search for" }),
				sourceId: Type.Optional(
					Type.String({ description: "Optional source id to restrict the search" }),
				),
				limit: Type.Optional(
					Type.Integer({ minimum: 1, maximum: 30, description: "Maximum number of matches" }),
				),
			}),
			execute: async (_toolCallId, params) => {
				const hits = await this.sourceService!.search(
					{
						query: params.query,
						sourceId: params.sourceId,
						limit: params.limit ?? 12,
					},
					workspacePath,
				);
				const sources = new Map(
					(await this.sourceService!.list(workspacePath)).map((source) => [source.id, source]),
				);
				const references: SourceReference[] = hits.map((hit) => ({
					sourceId: hit.sourceId,
					path: hit.path,
					revision: sources.get(hit.sourceId)?.revision,
					lineStart: hit.line,
					lineEnd: hit.line,
				}));
				for (const reference of references) recordSourceReference(sourceRefs, reference);
				const text = hits.length
					? hits
							.map(
								(hit, index) =>
									`${index + 1}. [${hit.sourceId}] ${hit.path}:${hit.line}\n${hit.preview}`,
							)
							.join("\n\n")
					: "No source matches found.";
				return { content: [{ type: "text" as const, text }], details: { references } };
			},
		});
		const readSource = defineTool({
			name: "read_source",
			label: "Read source",
			description:
				"Read a line range from a file returned by search_sources. Paths are relative to the selected source.",
			parameters: Type.Object({
				sourceId: Type.String({ description: "Source id returned by search_sources" }),
				path: Type.String({ description: "Relative file path returned by search_sources" }),
				lineStart: Type.Optional(Type.Integer({ minimum: 1, description: "First line to read" })),
				lineEnd: Type.Optional(
					Type.Integer({ minimum: 1, description: "Last line to read, capped to 200 lines" }),
				),
			}),
			execute: async (_toolCallId, params) => {
				const result = await this.sourceService!.read(
					params.sourceId,
					params.path,
					params.lineStart,
					params.lineEnd,
					workspacePath,
				);
				const reference: SourceReference = {
					sourceId: result.sourceId,
					path: result.path,
					revision: result.revision,
					lineStart: result.lineStart,
					lineEnd: result.lineEnd,
				};
				recordSourceReference(sourceRefs, reference);
				return {
					content: [
						{
							type: "text" as const,
							text: `[${result.sourceId}] ${result.path}:${result.lineStart}-${result.lineEnd}\n${result.content}`,
						},
					],
					details: { references: [reference] },
				};
			},
		});
		return [searchSources, readSource];
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

	reloadInstalledPlugins(): void {
		this.disposeAllSessions();
	}
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
	requestId?: string,
): AgentBridgeEvent {
	const stream = extractStreamDelta(event);
	const usage = getEventUsage(event);
	return {
		type: event.type,
		cache:
			event.type === "message_end" && "message" in event
				? responseCacheEvidence(event.message)
				: undefined,
		sessionId,
		frontendSessionId,
		message: stream?.message ?? extractEventMessage(event),
		streamKind: stream?.kind,
		payload: sanitizeForRenderer(event),
		usage:
			usage && hasUsage(usage)
				? {
						input: usage.input,
						output: usage.output,
						cacheRead: usage.cacheRead,
						cacheWrite: usage.cacheWrite,
						cacheWrite1h: usage.cacheWrite1h,
						cost: usage.cost,
					}
				: undefined,
		requestId,
	};
}

function getEventUsage(event: AgentSessionEvent): AgentUsage | undefined {
	if (
		event.type !== "message_end" ||
		!("message" in event) ||
		typeof event.message !== "object" ||
		event.message === null ||
		!("role" in event.message) ||
		event.message.role !== "assistant" ||
		!("usage" in event.message)
	)
		return undefined;
	return {
		input: event.message.usage.input,
		output: event.message.usage.output,
		cacheRead: event.message.usage.cacheRead,
		cacheWrite: event.message.usage.cacheWrite,
		cacheWrite1h: event.message.usage.cacheWrite1h,
		cost: event.message.usage.cost.total,
	};
}

function emptyAgentUsage(): AgentUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(total: AgentUsage, usage: AgentUsage): void {
	total.input += usage.input;
	total.output += usage.output;
	total.cacheRead += usage.cacheRead;
	total.cacheWrite += usage.cacheWrite;
	total.cost += usage.cost;
}

function hasUsage(usage: AgentUsage): boolean {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0 || usage.cost > 0;
}

const workspaceExplorationGuidance = `## Workspace exploration
- The current working directory is the workspace selected by the user.
- For questions about code in the workspace, inspect it autonomously with ls, find, grep, and read before answering.
- Prioritize implementation source files, symbol definitions and call sites, nearby tests, runtime configuration, and project documentation that directly explain the code in question.
- Treat agent skill files, CI/workflow definitions, generated output, vendored dependencies, and repository administration files as secondary. Read or cite them only when the question is specifically about those files or they materially affect the implementation being explained.
- Start with directory discovery when the user does not provide exact file paths. Do not claim that file paths are required unless workspace discovery tools have actually failed.
- Read-only tools may be used freely for analysis. Modify files only when edit, write, or bash tools are available and the user requested a change.`;

const todoTrackingGuidance = `## Work tracking
- For implementation or investigation with more than one meaningful step, treat the workspace TODO checklist as a high-priority working artifact.
- Read an existing TODO.md before starting so its structure and user-authored items are preserved.
- Create or update TODO.md near the start of multi-step work. Use nested Markdown checkboxes (- [ ] and - [x]) that reflect the real plan.
- Mark items complete immediately after verification, add newly discovered work, and leave unfinished or blocked work unchecked.
- Keep the checklist concise and operational. Do not create one for a trivial one-step answer.`;

const sourceRetrievalGuidance = `## Attached sources
- search_sources and read_source access repositories and documentation attached to this workspace but outside the current working directory.
- Use them when the question refers to an attached source, when supplied source matches are insufficient, or when comparing the workspace with external implementations.
- Search with discriminative symbol names, exact identifiers, and relevant paths. Prefer implementation code and project documentation over incidental matches in skill instructions, CI files, generated files, or repository metadata.
- A search hit is only a candidate, not evidence. Read the relevant range and verify that it directly supports the claim before relying on or citing it.
- Read relevant ranges before making source-backed claims. Mention file paths and line ranges when they materially support a conclusion.`;

const responsePresentationGuidance = `## Response presentation
- Installed extensions may supply other visualization tools and formats; follow their presentation instructions when available. The Mermaid rules below are the default when no extension overrides them.
- To embed an existing self-contained HTML file, return a fenced html-preview JSON block: {"version":1,"path":"relative/path.html","title":"Preview title"}. The file must be inside the current session workspace. Do not return its full HTML as prose. HTML previews are sandboxed and cannot fetch network resources.
- When visualizing a process, call chain, sequence, architecture, state transition, decision path, or relationship graph, use a concise Mermaid diagram. Never use an ASCII-art tree, arrow-filled plain-text diagram, or a \`\`\`text block as a substitute for a diagram.
- Every diagram MUST use a fenced \`\`\`mermaid block with valid Mermaid syntax and the exact \`mermaid\` language tag. Choose the diagram type that best matches the information, such as flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, or erDiagram.
- Before finishing, verify that every visual block begins with a supported Mermaid declaration and that no diagram was emitted as an unlabeled or plain-text code block.
- Design diagrams for a narrow reading pane. Prefer top-to-bottom flowcharts (flowchart TD or TB) and compact vertical grouping; avoid flowchart LR/RL and wide single-row chains unless horizontal order is essential.
- When a sequence would require many participants across one row, use a vertical flowchart or split it into smaller diagrams instead of producing an extremely wide sequence diagram.
- Add only the prose needed to explain the diagram. Do not add a diagram when plain text or executable source code is clearer.
- Keep node labels short. Quote labels that contain punctuation, parentheses, or other syntax-sensitive characters.`;

function recordSourceReference(
	sourceRefs: Map<string, SourceReference>,
	reference: SourceReference,
): void {
	const key = [
		reference.sourceId,
		reference.revision,
		reference.path,
		reference.lineStart,
		reference.lineEnd,
	].join(":");
	sourceRefs.set(key, reference);
}

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

function getSessionUsage(session: AgentSession) {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const message of session.messages) {
		if (
			typeof message !== "object" ||
			message === null ||
			!("role" in message) ||
			message.role !== "assistant" ||
			!("usage" in message)
		)
			continue;
		total.input += message.usage.input;
		total.output += message.usage.output;
		total.cacheRead += message.usage.cacheRead;
		total.cacheWrite += message.usage.cacheWrite;
		total.cost += message.usage.cost.total;
	}
	return total;
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
	const mermaidBlocks = [...request.answer.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)].map(
		(match, sourceIndex) => ({
			sourceIndex,
			source: match[1].trim(),
		}),
	);
	return `You are a conservative learning-gap detector for a personal knowledge workspace.

Decide whether the USER'S QUESTION demonstrates that the user does not understand a concept. Create knowledge entities only for those learning gaps.

Rules:
- Return zero entities for broad project summaries, status requests, task commands, or questions that merely mention technologies the user already appears to know.
- Do not create entities just because a term appears in the answer.
- A direct "what is X / explain X" question is evidence that the user may not know X, but it is NOT evidence that X qualifies as an entity. Apply the durable-identity test below first.
- Durable-identity test: an entity must denote one independently referenceable, stable thing whose identity survives rephrasing and future conversations. Valid examples include a named product, library, protocol, source module, class, file, established technical concept, or established design pattern.
- Do not create entities for answer sections, explanatory views, or ad-hoc composites such as "OpenCode architecture", "Core and Legacy service boundary", "request flow", "login call chain", "top-level structure", "protocol adaptation layer", "execution loop", or "how X works". Store architecture/structure/flow/call-chain/layering material as diagrams, and store supported connections as relations.
- A phrase ending in architecture, structure, flow, call chain, execution chain, boundary, layering, layout, path, overview, explanation, mechanism, or lifecycle is normally a view/topic rather than an entity. Only keep it when it is a widely established named concept independent of this project, such as Hexagonal Architecture.
- Do not turn a full question, heading, Mermaid title, or sentence fragment into an entity name. Do not combine multiple objects with "and", "与", "到", arrows, or versus into one entity.
- For a project architecture question, prefer zero entities plus diagrams/relations. If the named project itself is a genuine learning gap and is not already present, its entity name is the project name (for example "OpenCode"), never "OpenCode architecture".
- Prefer zero entities when uncertain. Return at most 3.
- Return a new entity only when the question demonstrates a learning gap. When the answer materially corrects or extends an existing entity, return it with existingEntityId and a complete updated summary/content. Otherwise do not return it.
- Never overwrite an existing entity with a generic restatement. Preserve useful existing details and user-authored specificity.
- summary and content must describe the entity itself as standalone knowledge. Never quote, paraphrase, or refer to "the answer", "the project", "the user", or the conversation.
- summary is one concise sentence. content is a focused 2-4 sentence explanation of the entity: what it is, its purpose, and the key distinction needed for understanding.
- Classify each entity's sourceScope. Use "workspace" when its identity or stated behavior is defined by this repository (files, modules, project-specific components/configuration), "general" for stable common knowledge independent of this repository (products, protocols, languages, established patterns), and "mixed" only when both are essential. General entities must not acquire workspace file citations merely because the conversation happened in this project.
- Extract only meaningful relations supported by the answer between returned or existing entities. Prefer stable existing IDs when available.
- When the question explicitly asks to rebuild relationships, return zero entities and zero diagrams, scan all supplied existing entities and diagram topology, and return every high-confidence useful relation without duplicating the existing graph.
- Also extract every Mermaid block listed in MERMAID_BLOCKS as a structured diagram. Do not invent diagrams when MERMAID_BLOCKS is empty.
- For each diagram, choose existingDiagramId only when it represents the same subject as an EXISTING_DIAGRAM. Never choose the reserved "workspace-knowledge-map". Otherwise omit existingDiagramId to create a new diagram.
- Diagram node keys must be short stable identifiers. Every edge sourceKey and targetKey must reference a returned node key.
- Map Mermaid types to architecture, structure, flowchart, sequence, swimlane, or dependency.
- Return valid JSON only, with this exact shape:
{"entities":[{"existingEntityId":"optional-id","name":"...","type":"Concept|Component|Pattern|Technology|File","summary":"...","content":"...","confidence":"explicit|inferred","sourceScope":"workspace|general|mixed"}],"relations":[{"sourceEntityId":"optional-id","targetEntityId":"optional-id","sourceName":"...","targetName":"...","type":"calls|depends_on|contains|implements|related_to","description":"...","confidence":"explicit|inferred"}],"diagrams":[{"sourceIndex":0,"name":"...","type":"sequence","existingDiagramId":"optional-id","nodes":[{"key":"user","label":"User","type":"actor"}],"edges":[{"sourceKey":"user","targetKey":"service","label":"request"}]}]}

EXISTING_ENTITIES:
${JSON.stringify(request.existingEntities)}

EXISTING_DIAGRAMS:
${JSON.stringify(request.existingDiagrams)}

MERMAID_BLOCKS:
${JSON.stringify(mermaidBlocks)}

USER_QUESTION:
${request.question}

ASSISTANT_ANSWER (diagram code removed; evidence only, not a source to copy):
${stripDiagramCode(request.answer)}`;
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
	const existingNames = new Set(
		request.existingEntities
			.flatMap((entity) => [entity.name, ...entity.aliases])
			.map((name) => name.trim().toLocaleLowerCase()),
	);
	const selected = new Set<string>();
	return items.slice(0, 3).flatMap((candidate): KnowledgeCandidate[] => {
		if (!isRecord(candidate)) return [];
		const name = cleanCandidateText(candidate.name, 120);
		const type = cleanCandidateText(candidate.type, 60);
		const summary = cleanCandidateText(candidate.summary, 500);
		let content = cleanCandidateText(candidate.content, 2_000);
		if (!name || !type || !summary || !content) return [];
		const key = name.toLocaleLowerCase();
		if (!isDurableKnowledgeEntityCandidate(name, type)) return [];
		const existingEntityId =
			typeof candidate.existingEntityId === "string" && existingIds.has(candidate.existingEntityId)
				? candidate.existingEntityId
				: undefined;
		if ((!existingEntityId && existingNames.has(key)) || selected.has(key)) return [];
		if (isCopiedPassage(content, request.answer)) {
			if (isCopiedPassage(summary, request.answer)) return [];
			content = summary;
		}
		selected.add(key);
		return [
			{
				existingEntityId,
				name,
				type,
				summary,
				content,
				confidence: candidate.confidence === "explicit" ? "explicit" : "inferred",
				sourceScope: parseKnowledgeSourceScope(candidate.sourceScope, type),
			},
		];
	});
}

function parseKnowledgeSourceScope(
	value: unknown,
	type: string,
): KnowledgeCandidate["sourceScope"] {
	if (value === "workspace" || value === "general" || value === "mixed") return value;
	return /^(?:component|file)$/i.test(type) ? "workspace" : "general";
}

export function isDurableKnowledgeEntityCandidate(name: string, type: string): boolean {
	const normalizedName = name.trim().replace(/\s+/g, " ");
	const normalizedType = type.trim().toLocaleLowerCase();
	if (!normalizedName || normalizedName.length > 80) return false;
	if (!/^(?:concept|component|pattern|technology|file)$/i.test(normalizedType)) return false;
	if (
		/[?？。!！:]$/.test(normalizedName) ||
		/(?:是什么|怎么工作|如何工作|how\s+.+\s+works?)$/i.test(normalizedName)
	)
		return false;
	if (/(?:\s|^)(?:vs\.?|versus)(?:\s|$)|(?:与|和|到|至|→|->)/i.test(normalizedName)) return false;
	const establishedArchitecture =
		/^(?:hexagonal architecture|clean architecture|onion architecture|event-driven architecture|microservices?|六边形架构|整洁架构|洋葱架构|事件驱动架构|微服务架构)$/i.test(
			normalizedName,
		);
	const viewOrTopicSuffix =
		/(?:架构|结构|流程|调用链|执行链|服务边界|边界|适配层|分层|布局|路径|概述|总览|说明|机制|生命周期|architecture|structure|flow|call chain|execution chain|boundary|layering|layout|path|overview|mechanism|lifecycle)$/i;
	if (!establishedArchitecture && viewOrTopicSuffix.test(normalizedName)) return false;
	const genericViewNames =
		/^(?:架构|系统架构|整体架构|顶层结构|总体流程|执行流程|调用流程|实现方式|工作原理|architecture|system architecture|request flow|execution flow|implementation|overview)$/i;
	return !genericViewNames.test(normalizedName);
}

function parseRelationCandidates(
	value: unknown,
	request: KnowledgeExtractionRequest,
): KnowledgeRelationCandidate[] {
	if (!Array.isArray(value)) return [];
	const existingIds = new Set(request.existingEntities.map((entity) => entity.id));
	return value.slice(0, 100).flatMap((candidate): KnowledgeRelationCandidate[] => {
		if (!isRecord(candidate)) return [];
		const sourceName = cleanCandidateText(candidate.sourceName, 120);
		const targetName = cleanCandidateText(candidate.targetName, 120);
		const type = cleanCandidateText(candidate.type, 80)
			.toLocaleLowerCase()
			.replace(/[^a-z0-9_]+/g, "_");
		const description = cleanCandidateText(candidate.description, 500);
		if (
			!sourceName ||
			!targetName ||
			!type ||
			sourceName.toLocaleLowerCase() === targetName.toLocaleLowerCase()
		)
			return [];
		return [
			{
				sourceEntityId:
					typeof candidate.sourceEntityId === "string" && existingIds.has(candidate.sourceEntityId)
						? candidate.sourceEntityId
						: undefined,
				targetEntityId:
					typeof candidate.targetEntityId === "string" && existingIds.has(candidate.targetEntityId)
						? candidate.targetEntityId
						: undefined,
				sourceName,
				targetName,
				type,
				description,
				confidence: candidate.confidence === "explicit" ? "explicit" : "inferred",
			},
		];
	});
}

function parseDiagramCandidates(
	value: unknown,
	request: KnowledgeExtractionRequest,
): KnowledgeDiagramCandidate[] {
	const mermaidBlocks = [...request.answer.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)].map(
		(match) => match[1].trim(),
	);
	const existingIds = new Set(request.existingDiagrams.map((diagram) => diagram.id));
	const diagramTypes = new Set<KnowledgeDiagramCandidate["type"]>([
		"architecture",
		"structure",
		"flowchart",
		"sequence",
		"swimlane",
		"dependency",
		"workflow",
		"dataflow",
		"lifecycle",
	]);
	const parsed = (Array.isArray(value) ? value : [])
		.slice(0, mermaidBlocks.length)
		.flatMap((candidate): KnowledgeDiagramCandidate[] => {
			if (
				!isRecord(candidate) ||
				!Array.isArray(candidate.nodes) ||
				!Array.isArray(candidate.edges)
			)
				return [];
			const sourceIndex =
				typeof candidate.sourceIndex === "number" ? Math.trunc(candidate.sourceIndex) : -1;
			const mermaidSource = mermaidBlocks[sourceIndex];
			const name = cleanCandidateText(candidate.name, 160);
			const type = diagramTypes.has(candidate.type as KnowledgeDiagramCandidate["type"])
				? (candidate.type as KnowledgeDiagramCandidate["type"])
				: "flowchart";
			if (!mermaidSource || !name) return [];
			const nodes = candidate.nodes.slice(0, 100).flatMap((node) => {
				if (!isRecord(node)) return [];
				const key = cleanCandidateText(node.key, 100);
				const label = cleanCandidateText(node.label, 160);
				return key && label
					? [{ key, label, type: cleanCandidateText(node.type, 60) || undefined }]
					: [];
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
			const existingDiagramId =
				typeof candidate.existingDiagramId === "string" &&
				existingIds.has(candidate.existingDiagramId) &&
				candidate.existingDiagramId !== "workspace-knowledge-map"
					? candidate.existingDiagramId
					: undefined;
			return [{ name, type, existingDiagramId, mermaidSource, nodes, edges }];
		});
	const parsedSources = new Set(parsed.map((candidate) => candidate.mermaidSource.trim()));
	return [
		...parsed,
		...extractMermaidDiagramCandidates(request).filter(
			(candidate) => !parsedSources.has(candidate.mermaidSource.trim()),
		),
	];
}

export function extractMermaidDiagramCandidates(
	request: KnowledgeExtractionRequest,
): KnowledgeDiagramCandidate[] {
	const matches = [...request.answer.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)];
	return matches.flatMap((match, index) => {
		const mermaidSource = match[1].trim();
		if (!mermaidSource) return [];
		const parsed = parseMermaidStructure(mermaidSource);
		if (parsed.nodes.length === 0) return [];
		const heading = nearestMarkdownHeading(request.answer, match.index ?? 0);
		return [
			{
				name: heading || `Diagram ${index + 1}`,
				type: parsed.type,
				mermaidSource,
				nodes: parsed.nodes,
				edges: parsed.edges,
			},
		];
	});
}

function extractDiagramCandidates(
	request: KnowledgeExtractionRequest,
): KnowledgeDiagramCandidate[] {
	return extractMermaidDiagramCandidates(request);
}

function stripDiagramCode(answer: string): string {
	return answer.replace(
		/```(?:mermaid|html-preview|html)\s*\r?\n[\s\S]*?```/gi,
		"[diagram omitted]",
	);
}

function parseMermaidStructure(
	source: string,
): Pick<KnowledgeDiagramCandidate, "type" | "nodes" | "edges"> {
	const firstLine =
		source
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("%%")) ?? "";
	const type: KnowledgeDiagramCandidate["type"] = /^sequenceDiagram\b/i.test(firstLine)
		? "sequence"
		: /^(?:classDiagram|erDiagram)\b/i.test(firstLine)
			? "dependency"
			: /^architecture\b/i.test(firstLine)
				? "architecture"
				: "flowchart";
	const labels = new Map<string, string>();
	const edgeCandidates: Array<{ sourceKey: string; targetKey: string; label?: string }> = [];
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("%%")) continue;
		const participant = line.match(/^(?:participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i);
		if (participant) {
			labels.set(participant[1], cleanMermaidLabel(participant[2] ?? participant[1]));
			continue;
		}
		const sequenceEdge = line.match(
			/^([\w.-]+)\s*(?:--?>>?|--?x|--?\)|-\)|x--?>|\)--)\s*([\w.-]+)\s*:\s*(.+)$/,
		);
		if (sequenceEdge) {
			labels.set(sequenceEdge[1], labels.get(sequenceEdge[1]) ?? sequenceEdge[1]);
			labels.set(sequenceEdge[2], labels.get(sequenceEdge[2]) ?? sequenceEdge[2]);
			edgeCandidates.push({
				sourceKey: sequenceEdge[1],
				targetKey: sequenceEdge[2],
				label: cleanMermaidLabel(sequenceEdge[3]),
			});
			continue;
		}
		let normalized = line.replace(
			/([A-Za-z_][\w.-]*)\s*(\[\[[^\]]*\]\]|\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{\{[^}]*\}\}|\{[^}]*\}|>[^\]]*\])/g,
			(_whole, key: string, shape: string) => {
				labels.set(key, cleanMermaidLabel(shape));
				return key;
			},
		);
		normalized = normalized.replace(/\|([^|]+)\|/g, "|$1|");
		const graphEdge = normalized.match(
			/([A-Za-z_][\w.-]*)\s*(?:-->|---|-.->|==>|--x|--o|o--|x--)\s*(?:\|([^|]+)\|\s*)?([A-Za-z_][\w.-]*)/,
		);
		if (graphEdge) {
			labels.set(graphEdge[1], labels.get(graphEdge[1]) ?? graphEdge[1]);
			labels.set(graphEdge[3], labels.get(graphEdge[3]) ?? graphEdge[3]);
			edgeCandidates.push({
				sourceKey: graphEdge[1],
				targetKey: graphEdge[3],
				label: cleanMermaidLabel(graphEdge[2] ?? "") || undefined,
			});
		}
		const classDeclaration = line.match(/^class\s+([A-Za-z_][\w.-]*)/i);
		if (classDeclaration)
			labels.set(classDeclaration[1], labels.get(classDeclaration[1]) ?? classDeclaration[1]);
	}
	const nodes = [...labels].slice(0, 100).map(([key, label]) => ({ key, label }));
	const keys = new Set(nodes.map((node) => node.key));
	const edges = edgeCandidates
		.filter((edge) => keys.has(edge.sourceKey) && keys.has(edge.targetKey))
		.slice(0, 200);
	return { type, nodes, edges };
}

function nearestMarkdownHeading(markdown: string, end: number): string {
	const headings = [...markdown.slice(0, end).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
	return cleanCandidateText(headings.at(-1)?.[1], 160);
}

function cleanMermaidLabel(value: string): string {
	return value
		.replace(/^[\[({>{]+|[\])}>}]+$/g, "")
		.replace(/^['"]|['"]$/g, "")
		.replace(/<br\s*\/?\s*>/gi, " ")
		.trim()
		.slice(0, 160);
}

function cleanCandidateText(value: unknown, limit: number): string {
	return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function isCopiedPassage(value: string, answer: string): boolean {
	const normalized = value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
	return (
		normalized.length >= 30 && answer.toLocaleLowerCase().replace(/\s+/g, " ").includes(normalized)
	);
}

function sanitizeForRenderer(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (key, nestedValue: unknown) => {
			const lowerKey = key.toLowerCase();
			if (
				/^(?:token|access_token|refresh_token|id_token|apikey|api_key|authorization|password|secret|credential)$/.test(
					lowerKey,
				)
			) {
				return "[redacted]";
			}
			if (lowerKey === "data" && typeof nestedValue === "string" && nestedValue.length > 1024) {
				return `[binary data omitted: ${nestedValue.length.toLocaleString()} characters]`;
			}
			return nestedValue;
		}),
	);
}

function isModelRequestSnapshot(
	value: unknown,
): value is AgentModelRequestSnapshot & { frontendTurnId: string } {
	if (!isRecord(value) || !isRecord(value.context) || !Array.isArray(value.context.messages))
		return false;
	return (
		typeof value.id === "string" &&
		typeof value.sequence === "number" &&
		Number.isFinite(value.sequence) &&
		typeof value.timestamp === "string" &&
		typeof value.model === "string" &&
		typeof value.provider === "string" &&
		typeof value.api === "string" &&
		typeof value.thinking === "string" &&
		typeof value.frontendTurnId === "string"
	);
}

async function writeRequestDump(
	dumpPath: string,
	snapshot: AgentModelRequestSnapshot,
): Promise<void> {
	try {
		await mkdir(path.dirname(dumpPath), { recursive: true });
		await writeFile(dumpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
	} catch (error) {
		console.warn(`Could not write model request dump: ${errorToMessage(error)}`);
	}
}

function safeDumpPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "session";
}
