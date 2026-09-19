import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentBridgeEvent,
	AgentModelRequestSnapshot,
	AgentPromptRequest,
	AgentPromptResponse,
	KnowledgeExtractionRequest,
	KnowledgeExtractionResponse,
	ModelCatalogRequest,
	ModelCatalogResponse,
	ProviderActionResponse,
	ProviderId,
	ProviderStatusResponse,
	SummaryRequest,
	SummaryResponse,
	WorkspaceTodosResponse,
} from "../../src/shared/ipc.js";
import { errorToMessage, isRecord } from "../../src/shared/value.js";
import {
	PiService,
	buildKnowledgeExtractionPrompt,
	extractMermaidDiagramCandidates,
	knowledgeRetrievalGuidance,
	parseKnowledgeExtraction,
	responsePresentationGuidance,
	safeDumpPart,
	todoTrackingGuidance,
	workspaceExplorationGuidance,
	writeRequestDump,
} from "./pi-service.js";
import {
	buildNativePrompt,
	type NativeAgentRequest,
	type NativeAgentResult,
	type NativeProviderId,
} from "./native-agent.js";
import { runCodexAgent } from "./codex-agent.js";
import { runClaudeAgent } from "./claude-agent.js";
import { getNativeProviderStatus } from "./native-provider-status.js";
import { collectHtmlPreviews } from "./html-preview-service.js";
import { readWorkspaceTodos } from "./todo-service.js";

interface ProviderSessionState {
	providerId: ProviderId;
	copilotGeneration?: string;
}

export class AgentService extends PiService {
	private readonly nativeWorkspaces = new Map<string, string>();
	private readonly runningSessions = new Set<string>();
	private readonly controllers = new Set<AbortController>();

	override async getProviderStatus(
		providerId: ProviderId = "github-copilot",
	): Promise<ProviderStatusResponse> {
		return providerId === "claude-code"
			? getNativeProviderStatus(providerId)
			: super.getProviderStatus(providerId);
	}

	override async loginProvider(providerId: ProviderId): Promise<ProviderActionResponse> {
		if (providerId !== "claude-code") return super.loginProvider(providerId);
		const status = await this.getProviderStatus(providerId);
		return {
			ok: status.configured,
			status,
			error: status.configured ? undefined : (status.error ?? status.setupInstructions),
		};
	}

	override async logoutProvider(providerId: ProviderId): Promise<ProviderActionResponse> {
		if (providerId !== "claude-code") return super.logoutProvider(providerId);
		return {
			ok: false,
			status: await this.getProviderStatus(providerId),
			error:
				"Local CLI authentication is shared with other applications. Sign out in the provider's CLI, not in Rhyza.",
		};
	}

	override async getModelCatalog(request: ModelCatalogRequest = {}): Promise<ModelCatalogResponse> {
		if (!request.providerId || request.providerId !== "claude-code") {
			return super.getModelCatalog(request);
		}
		const status = await this.getProviderStatus(request.providerId);
		// Neither agent exposes a stable SDK/CLI model catalog. Defaults and custom IDs
		// are resolved by the selected agent, never by Copilot's model registry.
		return { models: [], configured: status.configured, error: status.error };
	}

	override async promptAgent(
		request: AgentPromptRequest,
		workspacePath: string,
	): Promise<AgentPromptResponse> {
		const key = `${workspacePath}\0${request.frontendSessionId}`;
		if (this.runningSessions.has(key)) {
			return { ok: false, error: "This session already has a running prompt." };
		}
		this.runningSessions.add(key);
		const providerId = request.model?.providerId ?? "github-copilot";
		try {
			const state = await this.recordSessionProvider(key, providerId);
			if (providerId !== "claude-code") {
				this.nativeWorkspaces.delete(request.frontendSessionId);
				return await super.promptAgent(
					{
						...request,
						sessionGeneration: `${state.copilotGeneration ?? "default"}-knowledge-${
							request.knowledgeTools ? "on" : "off"
						}`,
					},
					workspacePath,
				);
			}
			const workspace = await this.worktreeService.resolveSessionWorkspace(
				workspacePath,
				request.frontendSessionId,
				request.writable === true,
			);
			this.nativeWorkspaces.set(request.frontendSessionId, workspace.path);
			const writable = request.writable === true && workspace.isolated;
			const { context, sourceRefs } = await this.readAttachedContext(request, workspacePath);
			const guidance = [
				workspaceExplorationGuidance,
				writable ? todoTrackingGuidance : "This is a read-only session. Do not modify files.",
				...(request.knowledgeTools ? [knowledgeRetrievalGuidance] : []),
				responsePresentationGuidance,
			].join("\n\n");
			const parts = buildNativePrompt(
				{
					...request,
					knowledgeContext: [request.knowledgeContext, context].filter(Boolean).join("\n\n"),
				},
				guidance,
			);
			const requestId = randomUUID();
			const frontendTurnId = request.frontendTurnId ?? "unmapped";
			const dumpPath = path.join(
				this.requestDumpDir,
				safeDumpPart(request.frontendSessionId),
				safeDumpPart(frontendTurnId),
				`001-${requestId}.json`,
			);
			const snapshot: AgentModelRequestSnapshot = {
				id: requestId,
				sequence: 1,
				timestamp: new Date().toISOString(),
				provider: providerId,
				model: request.model?.modelId || "provider default",
				api: "claude-code-cli-agent-input",
				thinking: request.thinkingLevel ?? "medium",
				frontendTurnId,
				dumpPath,
				context: {
					messages: parts.map((part) =>
						part.type === "text"
							? part
							: { type: "image", mimeType: part.image.mimeType, data: "[image omitted]" },
					),
				},
			};
			const emit = (event: AgentBridgeEvent) =>
				this.emitAgentEvent({
					...event,
					frontendSessionId: request.frontendSessionId,
					requestId,
				});
			await writeRequestDump(dumpPath, snapshot);
			emit({ type: "model_request", modelRequest: snapshot });
			emit({ type: "prompt_start" });
			const nativeKnowledgeTool = request.knowledgeTools
				? await this.createNativeKnowledgeTool(request.knowledgeInventory)
				: undefined;
			let result: NativeAgentResult;
			try {
				result = await this.withNativeRequest(
					{
						providerId,
						workspacePath: workspace.path,
						parts,
						modelId: request.model?.modelId,
						thinkingLevel: request.thinkingLevel,
						writable,
						tools: true,
						knowledgeTool: nativeKnowledgeTool?.tool,
					},
					emit,
				);
			} finally {
				await nativeKnowledgeTool?.cleanup();
			}
			await writeRequestDump(dumpPath, { ...snapshot, usage: result.usage });
			emit({ type: "message_end", sessionId: result.sessionId, usage: result.usage });
			return {
				ok: true,
				...result,
				htmlPreviews: await collectHtmlPreviews(result.assistantText, workspace.path),
				workspacePath: workspace.path,
				isolated: workspace.isolated,
				sourceRefs,
			};
		} catch (error) {
			return { ok: false, error: errorToMessage(error) };
		} finally {
			this.runningSessions.delete(key);
		}
	}

	override async generateSummary(
		request: SummaryRequest,
		workspacePath: string,
	): Promise<SummaryResponse> {
		const providerId = request.model?.providerId;
		if (!providerId || providerId !== "claude-code") {
			return super.generateSummary(request, workspacePath);
		}
		try {
			const result = await this.auxiliaryRequest(
				providerId,
				workspacePath,
				`Do not use tools. Create a concise semantic title for this user question. Return only the title, no quotes or explanation. Use 8-20 Chinese characters for Chinese input, otherwise at most 8 words.\n\n${request.text}`,
				request.model?.modelId,
				request.requestId,
			);
			const summary = result.assistantText
				.replace(/^["'“”]+|["'“”]+$/g, "")
				.trim()
				.slice(0, 80);
			return summary
				? { summary, usage: result.usage }
				: { error: "The model returned an empty title.", usage: result.usage };
		} catch (error) {
			return { error: errorToMessage(error) };
		}
	}

	override async extractKnowledge(
		request: KnowledgeExtractionRequest,
		workspacePath: string,
	): Promise<KnowledgeExtractionResponse> {
		const providerId = request.model?.providerId;
		if (!providerId || providerId !== "claude-code") {
			return super.extractKnowledge(request, workspacePath);
		}
		try {
			const result = await this.auxiliaryRequest(
				providerId,
				workspacePath,
				buildKnowledgeExtractionPrompt(request),
				request.model?.modelId,
				request.requestId,
				{
					existingEntities: request.existingEntities,
					existingDiagrams: request.existingDiagrams,
				},
			);
			return { ...parseKnowledgeExtraction(result.assistantText, request), usage: result.usage };
		} catch (error) {
			return {
				entities: [],
				relations: [],
				diagrams: extractMermaidDiagramCandidates(request),
				error: errorToMessage(error),
			};
		}
	}

	override async getWorkspaceTodos(
		frontendSessionId: string | undefined,
		workspacePath: string,
	): Promise<WorkspaceTodosResponse> {
		const nativeWorkspace = frontendSessionId && this.nativeWorkspaces.get(frontendSessionId);
		return nativeWorkspace
			? readWorkspaceTodos(nativeWorkspace)
			: super.getWorkspaceTodos(frontendSessionId, workspacePath);
	}

	protected runNative(
		request: NativeAgentRequest,
		emit: (event: AgentBridgeEvent) => void,
	): Promise<NativeAgentResult> {
		return request.providerId === "codex"
			? runCodexAgent(request, emit)
			: runClaudeAgent(request, emit);
	}

	private async withNativeRequest(
		request: Omit<NativeAgentRequest, "signal">,
		emit: (event: AgentBridgeEvent) => void,
		timeoutMs?: number,
		requestId?: string,
	): Promise<NativeAgentResult> {
		const controller = new AbortController();
		this.controllers.add(controller);
		const timeout = timeoutMs
			? setTimeout(() => controller.abort(new Error("Provider request timed out.")), timeoutMs)
			: undefined;
		try {
			return await this.runCancellableAuxiliary(
				requestId,
				() => controller.abort(new Error("Auxiliary request canceled.")),
				() => this.runNative({ ...request, signal: controller.signal }, emit),
			);
		} finally {
			if (timeout) clearTimeout(timeout);
			this.controllers.delete(controller);
		}
	}

	private auxiliaryRequest(
		providerId: NativeProviderId,
		workspacePath: string,
		prompt: string,
		modelId?: string,
		requestId?: string,
		knowledgeInventory?: Pick<KnowledgeExtractionRequest, "existingEntities" | "existingDiagrams">,
	): Promise<NativeAgentResult> {
		return this.withOptionalNativeKnowledgeTool(knowledgeInventory, (knowledgeTool) =>
			this.withNativeRequest(
				{
					providerId,
					workspacePath,
					parts: [{ type: "text", text: prompt }],
					modelId,
					thinkingLevel: "low",
					writable: false,
					tools: false,
					knowledgeTool,
				},
				() => {},
				25_000,
				requestId,
			),
		);
	}

	private async withOptionalNativeKnowledgeTool<T>(
		inventory:
			Pick<KnowledgeExtractionRequest, "existingEntities" | "existingDiagrams"> | undefined,
		operation: (tool: NativeAgentRequest["knowledgeTool"]) => Promise<T>,
	): Promise<T> {
		const knowledgeTool = inventory ? await this.createNativeKnowledgeTool(inventory) : undefined;
		try {
			return await operation(knowledgeTool?.tool);
		} finally {
			await knowledgeTool?.cleanup();
		}
	}

	private async createNativeKnowledgeTool(
		inventory:
			Pick<KnowledgeExtractionRequest, "existingEntities" | "existingDiagrams"> | undefined,
	) {
		const directory = await mkdtemp(path.join(tmpdir(), "rhyza-knowledge-"));
		const inventoryPath = path.join(directory, "inventory.json");
		await writeFile(
			inventoryPath,
			JSON.stringify(inventory ?? { existingEntities: [], existingDiagrams: [] }),
			{ encoding: "utf8", mode: 0o600 },
		);
		return {
			tool: {
				serverPath: fileURLToPath(new URL("./knowledge-mcp-server.js", import.meta.url)),
				inventoryPath,
			},
			cleanup: () => rm(directory, { recursive: true, force: true }),
		};
	}

	private async recordSessionProvider(
		key: string,
		providerId: ProviderId,
	): Promise<ProviderSessionState> {
		const directory = path.join(this.requestDumpDir, "..", "provider-sessions");
		const filename = path.join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
		let previous: ProviderSessionState | undefined;
		try {
			const parsed: unknown = JSON.parse(await readFile(filename, "utf8"));
			if (
				!isRecord(parsed) ||
				!["github-copilot", "codex", "claude-code"].includes(String(parsed.providerId)) ||
				(parsed.copilotGeneration !== undefined && typeof parsed.copilotGeneration !== "string")
			) {
				throw new Error("Invalid provider session metadata.");
			}
			previous = {
				providerId: parsed.providerId as ProviderId,
				copilotGeneration: parsed.copilotGeneration as string | undefined,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const state: ProviderSessionState = {
			providerId,
			copilotGeneration:
				providerId !== "claude-code" && previous && previous.providerId !== providerId
					? randomUUID()
					: previous?.copilotGeneration,
		};
		await mkdir(directory, { recursive: true });
		await writeFile(filename, JSON.stringify(state), "utf8");
		return state;
	}

	private async readAttachedContext(request: AgentPromptRequest, workspacePath: string) {
		const sourceRefs: NonNullable<AgentPromptResponse["sourceRefs"]> = [];
		if (!this.sourceService) return { context: "", sourceRefs };
		const hits = await this.sourceService.search(
			{ query: request.prompt, limit: 8 },
			workspacePath,
		);
		const sections: string[] = [];
		for (const hit of hits) {
			const result = await this.sourceService.read(
				hit.sourceId,
				hit.path,
				Math.max(1, hit.line - 10),
				hit.line + 30,
				workspacePath,
			);
			sections.push(
				`[${result.sourceId}] ${result.path}:${result.lineStart}-${result.lineEnd}\n${result.content}`,
			);
			sourceRefs.push({
				sourceId: result.sourceId,
				path: result.path,
				revision: result.revision,
				lineStart: result.lineStart,
				lineEnd: result.lineEnd,
			});
		}
		return { context: sections.join("\n\n"), sourceRefs };
	}

	override dispose(): void {
		for (const controller of this.controllers) controller.abort(new Error("Rhyza is closing."));
		super.dispose();
	}
}
