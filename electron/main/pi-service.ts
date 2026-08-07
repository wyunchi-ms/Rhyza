import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	createAgentSession,
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
	ProviderActionResponse,
	ProviderId,
	ProviderStatusResponse,
} from "../../src/shared/ipc.js";

const defaultProviderId: ProviderId = "github-copilot";
type PiModel = Model<Api>;

interface ActiveSession {
	session: AgentSession;
	workspacePath: string;
	frontendSessionId: string;
	modelKey?: string;
	unsubscribe: () => void;
}

export class PiService {
	private readonly agentDir: string;
	private modelRuntimePromise: Promise<ModelRuntime> | undefined;
	private readonly activeSessions = new Map<string, ActiveSession>();

	constructor(
		userDataPath: string,
		private readonly emitAuthEvent: (event: AuthBridgeEvent) => void = () => {},
		private readonly emitAgentEvent: (event: AgentBridgeEvent) => void = () => {},
	) {
		this.agentDir = path.join(userDataPath, "pi-agent");
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
					this.emitAuthEvent({
						type: "progress",
						message: `Authentication prompt required: ${prompt.message}`,
					});
					throw new Error(
						"This Electron milestone supports OAuth/device flow notifications but not secret text prompts.",
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
			const session = await this.getSession(workspacePath, request, model);
			this.emitAgentEvent({
				type: "prompt_start",
				sessionId: session.sessionId,
				message: request.prompt,
			});
			await session.sendUserMessage(request.prompt);
			return {
				ok: true,
				sessionId: session.sessionId,
				assistantText: getLastAssistantText(session),
			};
		} catch (error) {
			return { ok: false, error: errorToMessage(error) };
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
	): Promise<AgentSession> {
		const modelKey = model ? `${model.provider}/${model.id}` : undefined;
		const activeSession = this.activeSessions.get(request.frontendSessionId);
		if (activeSession?.workspacePath === workspacePath) {
			if (model && activeSession.modelKey !== modelKey) {
				await activeSession.session.setModel(model);
				activeSession.modelKey = modelKey;
			}
			return activeSession.session;
		}
		this.disposeSession(request.frontendSessionId);
		const sessionManager = this.createBranchSessionManager(workspacePath, request);
		const { session } = await createAgentSession({
			cwd: workspacePath,
			agentDir: this.agentDir,
			modelRuntime: await this.getModelRuntime(),
			model,
			sessionManager,
			tools: ["read"],
		});
		const unsubscribe = session.subscribe((event) =>
			this.emitAgentEvent(toAgentBridgeEvent(session.sessionId, event)),
		);
		this.activeSessions.set(request.frontendSessionId, {
			session,
			workspacePath,
			frontendSessionId: request.frontendSessionId,
			modelKey,
			unsubscribe,
		});
		return session;
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
	event: AgentSessionEvent,
): AgentBridgeEvent {
	return {
		type: event.type,
		sessionId,
		message: extractEventMessage(event),
		payload: sanitizeForRenderer(event),
	};
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
	if (typeof assistant.content === "string") {
		return assistant.content;
	}
	if (Array.isArray(assistant.content)) {
		return assistant.content
			.map((part) => {
				if (
					typeof part === "object" &&
					part !== null &&
					"text" in part &&
					typeof part.text === "string"
				) {
					return part.text;
				}
				return "";
			})
			.join("")
			.trim();
	}
	return undefined;
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
