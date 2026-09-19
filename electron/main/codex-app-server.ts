import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type ImageContent,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

const providerId = "codex";
const appServerApi = "codex-app-server";
const requestTimeoutMs = 20_000;
const defaultContextWindow = 200_000;
const defaultMaxTokens = 100_000;

type JsonObject = Record<string, unknown>;

interface JsonRpcMessage extends JsonObject {
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export interface CodexAccount {
	type: "apiKey" | "chatgpt" | "amazonBedrock";
	email?: string | null;
	planType?: string | null;
}

export interface CodexModel {
	id: string;
	model: string;
	displayName: string;
	hidden: boolean;
	inputModalities?: string[];
	supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
	defaultReasoningEffort?: string;
	isDefault?: boolean;
}

export interface CodexSessionContext {
	cwd: string;
	writable: boolean;
}

interface RegisteredCodexSession extends CodexSessionContext {
	client?: CodexAppServerClient;
	threadId?: string;
}

export interface CodexProviderModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	cost: Model<string>["cost"];
	thinkingLevelMap?: Model<string>["thinkingLevelMap"];
}

export class CodexAppServer {
	private clientPromise: Promise<CodexAppServerClient> | undefined;
	private readonly sessionContexts = new Map<string, RegisteredCodexSession>();

	constructor(private readonly executable?: string) {}

	async account(refreshToken = false): Promise<CodexAccount | null> {
		const result = asObject(await (await this.client()).request("account/read", { refreshToken }));
		return isCodexAccount(result.account) ? result.account : null;
	}

	async login(
		onAuthUrl: (url: string) => void,
		onProgress: (message: string) => void,
	): Promise<CodexAccount> {
		const current = await this.account(false);
		if (current) return current;

		const client = await this.client();
		const response = asObject(
			await client.request("account/login/start", {
				type: "chatgpt",
				appBrand: "chatgpt",
			}),
		);
		if (response.type !== "chatgpt" || typeof response.loginId !== "string") {
			throw new Error("Codex App Server did not start a ChatGPT browser login.");
		}
		if (typeof response.authUrl === "string") onAuthUrl(response.authUrl);
		onProgress("Waiting for ChatGPT authorization in your browser…");

		await client.waitForNotification(
			"account/login/completed",
			(params) => asObject(params).loginId === response.loginId,
			10 * 60_000,
		);
		const account = await this.account(false);
		if (!account) throw new Error("ChatGPT authorization finished, but Codex is still signed out.");
		return account;
	}

	async logout(): Promise<void> {
		await (await this.client()).request("account/logout", undefined);
	}

	async models(): Promise<CodexModel[]> {
		const client = await this.client();
		const models: CodexModel[] = [];
		let cursor: string | null | undefined;
		do {
			const result = asObject(
				await client.request("model/list", {
					limit: 100,
					includeHidden: false,
					...(cursor ? { cursor } : {}),
				}),
			);
			if (Array.isArray(result.data)) {
				for (const value of result.data) {
					if (isCodexModel(value) && !value.hidden) models.push(value);
				}
			}
			cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
		} while (cursor);
		return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
	}

	toProviderModels(models: CodexModel[], fallback: readonly Model<string>[]): CodexProviderModel[] {
		return models.map((model) => {
			const existing = fallback.find((candidate) => candidate.id === model.id);
			const efforts = new Set(
				model.supportedReasoningEfforts
					?.map((option) => option.reasoningEffort)
					.filter((value): value is string => typeof value === "string") ?? [],
			);
			return {
				id: model.id,
				name: model.displayName || model.model || model.id,
				reasoning: efforts.size > 0 || existing?.reasoning === true,
				input: normalizeModalities(model.inputModalities, existing?.input),
				contextWindow: existing?.contextWindow ?? defaultContextWindow,
				maxTokens: existing?.maxTokens ?? defaultMaxTokens,
				cost: existing?.cost ?? {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				thinkingLevelMap: existing?.thinkingLevelMap,
			};
		});
	}

	registerSession(sessionId: string, context: CodexSessionContext): void {
		const existing = this.sessionContexts.get(sessionId);
		const canReuse = existing?.cwd === context.cwd && existing.writable === context.writable;
		this.sessionContexts.set(sessionId, {
			...context,
			client: canReuse ? existing.client : undefined,
			threadId: canReuse ? existing.threadId : undefined,
		});
	}

	unregisterSession(sessionId: string): void {
		this.sessionContexts.delete(sessionId);
	}

	streamSimple(
		model: Model<string>,
		context: Context,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream {
		const stream = createAssistantMessageEventStream();
		void this.runStream(stream, model, context, options);
		return stream;
	}

	async dispose(): Promise<void> {
		const client = await this.clientPromise?.catch(() => undefined);
		client?.dispose();
		this.clientPromise = undefined;
	}

	private async client(): Promise<CodexAppServerClient> {
		const existingPromise = this.clientPromise;
		if (existingPromise) {
			const existing = await existingPromise;
			if (!existing.isClosed()) return existing;
			if (this.clientPromise === existingPromise) this.clientPromise = undefined;
			return this.client();
		}
		this.clientPromise = CodexAppServerClient.start(this.executable).catch((error) => {
			this.clientPromise = undefined;
			throw error;
		});
		return this.clientPromise;
	}

	private async runStream(
		stream: AssistantMessageEventStream,
		model: Model<string>,
		context: Context,
		options?: SimpleStreamOptions,
	): Promise<void> {
		const output = emptyAssistantMessage(model);
		let textIndex: number | undefined;
		let thinkingIndex: number | undefined;
		let threadId: string | undefined;
		let turnId: string | undefined;
		let unsubscribe = () => {};
		let unsubscribeClose = () => {};
		let latestUsage: UsageSnapshot | undefined;
		const startedAt = Date.now();
		let threadReadyAt: number | undefined;
		let firstOutputAt: number | undefined;
		let outcome = "error";
		let reusedThread = false;
		try {
			if (options?.signal?.aborted) throw new Error("Request was aborted.");
			const client = await this.client();
			const sessionContext = options?.sessionId
				? this.sessionContexts.get(options.sessionId)
				: undefined;
			if (sessionContext?.client === client && sessionContext.threadId) {
				threadId = sessionContext.threadId;
				reusedThread = true;
			} else {
				const threadResult = asObject(
					await client.request("thread/start", {
						model: model.id,
						cwd: sessionContext?.cwd ?? process.cwd(),
						approvalPolicy: "never",
						sandbox: sessionContext?.writable ? "workspace-write" : "read-only",
						ephemeral: true,
						serviceName: "rhyza",
						developerInstructions: buildDeveloperInstructions(context.systemPrompt),
					}),
				);
				threadId = asString(asObject(threadResult.thread).id);
				if (!threadId) throw new Error("Codex App Server did not return a thread id.");
				if (sessionContext) {
					sessionContext.client = client;
					sessionContext.threadId = threadId;
				}
			}
			threadReadyAt = Date.now();

			stream.push({ type: "start", partial: output });
			const completion = deferred<void>();
			unsubscribeClose = client.onClose((error) => completion.reject(error));
			unsubscribe = client.onNotification((message) => {
				const params = asObject(message.params);
				if (params.threadId !== threadId) return;
				if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
					firstOutputAt ??= Date.now();
					if (textIndex === undefined) {
						textIndex = output.content.length;
						output.content.push({ type: "text", text: "" });
						stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
					}
					const content = output.content[textIndex];
					if (content?.type === "text") content.text += params.delta;
					stream.push({
						type: "text_delta",
						contentIndex: textIndex,
						delta: params.delta,
						partial: output,
					});
				}
				if (
					message.method === "item/reasoning/summaryTextDelta" &&
					typeof params.delta === "string"
				) {
					firstOutputAt ??= Date.now();
					if (thinkingIndex === undefined) {
						thinkingIndex = output.content.length;
						output.content.push({ type: "thinking", thinking: "" });
						stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
					}
					const content = output.content[thinkingIndex];
					if (content?.type === "thinking") content.thinking += params.delta;
					stream.push({
						type: "thinking_delta",
						contentIndex: thinkingIndex,
						delta: params.delta,
						partial: output,
					});
				}
				if (message.method === "thread/tokenUsage/updated") {
					latestUsage = readUsage(params.tokenUsage);
				}
				if (message.method === "turn/completed") {
					const turn = asObject(params.turn);
					if (turnId && turn.id !== turnId) return;
					if (turn.status === "completed") completion.resolve();
					else {
						completion.reject(
							new Error(
								asString(asObject(turn.error).message) ??
									`Codex turn ${String(turn.status ?? "failed")}.`,
							),
						);
					}
				}
			});

			const abort = () => {
				if (threadId && turnId) {
					void client.request("turn/interrupt", { threadId, turnId }).catch(() => {});
				}
			};
			options?.signal?.addEventListener("abort", abort, { once: true });
			try {
				const turnResult = asObject(
					await client.request("turn/start", {
						threadId,
						input: contextToInput(context, !reusedThread),
						model: model.id,
						...(options?.reasoning ? { effort: options.reasoning } : {}),
					}),
				);
				turnId = asString(asObject(turnResult.turn).id);
				if (!turnId) throw new Error("Codex App Server did not return a turn id.");
				if (options?.signal?.aborted) abort();
				await completion.promise;
			} finally {
				options?.signal?.removeEventListener("abort", abort);
			}

			if (textIndex !== undefined) {
				const text = output.content[textIndex];
				stream.push({
					type: "text_end",
					contentIndex: textIndex,
					content: text?.type === "text" ? text.text : "",
					partial: output,
				});
			}
			if (thinkingIndex !== undefined) {
				const thinking = output.content[thinkingIndex];
				stream.push({
					type: "thinking_end",
					contentIndex: thinkingIndex,
					content: thinking?.type === "thinking" ? thinking.thinking : "",
					partial: output,
				});
			}
			if (latestUsage) applyUsage(output, latestUsage);
			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
			outcome = "completed";
		} catch (error) {
			outcome = options?.signal?.aborted ? "aborted" : "error";
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = errorToMessage(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		} finally {
			unsubscribe();
			unsubscribeClose();
			console.info("CODEX_APP_SERVER_TIMING", {
				outcome,
				reusedThread,
				threadStartMs: threadReadyAt ? threadReadyAt - startedAt : undefined,
				firstOutputMs: firstOutputAt ? firstOutputAt - startedAt : undefined,
				totalMs: Date.now() - startedAt,
			});
		}
	}
}

class CodexAppServerClient {
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly notificationListeners = new Set<(message: JsonRpcMessage) => void>();
	private readonly closeListeners = new Set<(error: Error) => void>();
	private readonly stderrLines: string[] = [];
	private disposed = false;

	private constructor(private readonly process: ChildProcessWithoutNullStreams) {
		const stdout = readline.createInterface({ input: process.stdout });
		stdout.on("line", (line) => this.handleLine(line));
		const stderr = readline.createInterface({ input: process.stderr });
		stderr.on("line", (line) => {
			this.stderrLines.push(line);
			if (this.stderrLines.length > 20) this.stderrLines.shift();
		});
		process.once("error", (error) => this.failAll(error));
		process.once("exit", (code, signal) => {
			this.failAll(
				new Error(
					`Codex App Server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.${this.stderrSuffix()}`,
				),
			);
		});
	}

	static async start(executable?: string): Promise<CodexAppServerClient> {
		const command = executable ?? (await resolveCodexExecutable());
		const child = spawn(command, ["app-server", "--stdio"], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			env: process.env,
		});
		const client = new CodexAppServerClient(child);
		await client.request("initialize", {
			clientInfo: { name: "rhyza", title: "Rhyza", version: "1.0.0" },
		});
		client.notify("initialized", {});
		return client;
	}

	request(method: string, params: unknown, timeoutMs = requestTimeoutMs): Promise<unknown> {
		if (this.disposed) return Promise.reject(new Error("Codex App Server is not running."));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex App Server request timed out: ${method}.${this.stderrSuffix()}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ method, id, ...(params === undefined ? {} : { params }) });
		});
	}

	notify(method: string, params: unknown): void {
		this.write({ method, ...(params === undefined ? {} : { params }) });
	}

	onNotification(listener: (message: JsonRpcMessage) => void): () => void {
		this.notificationListeners.add(listener);
		return () => this.notificationListeners.delete(listener);
	}

	onClose(listener: (error: Error) => void): () => void {
		if (this.disposed) {
			listener(new Error("Codex App Server is not running."));
			return () => {};
		}
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	isClosed(): boolean {
		return this.disposed;
	}

	waitForNotification(
		method: string,
		predicate: (params: unknown) => boolean,
		timeoutMs: number,
	): Promise<unknown> {
		if (this.disposed) return Promise.reject(new Error("Codex App Server is not running."));
		return new Promise((resolve, reject) => {
			let unsubscribe = () => {};
			let unsubscribeClose = () => {};
			const timer = setTimeout(() => {
				unsubscribe();
				unsubscribeClose();
				reject(new Error(`Timed out waiting for Codex notification: ${method}.`));
			}, timeoutMs);
			unsubscribe = this.onNotification((message) => {
				if (message.method !== method || !predicate(message.params)) return;
				clearTimeout(timer);
				unsubscribe();
				unsubscribeClose();
				const params = asObject(message.params);
				if (params.success === false) {
					reject(new Error(asString(params.error) ?? "Codex authentication failed."));
				} else resolve(message.params);
			});
			unsubscribeClose = this.onClose((error) => {
				clearTimeout(timer);
				unsubscribe();
				reject(error);
			});
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.process.kill();
		this.failAll(new Error("Codex App Server was stopped."));
	}

	private write(message: JsonRpcMessage): void {
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (typeof message.id === "number" && !message.method) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) pending.reject(jsonRpcError(message.error));
			else pending.resolve(message.result);
			return;
		}
		if (typeof message.method === "string" && message.id !== undefined) {
			this.write({
				id: message.id,
				error: { code: -32601, message: `Rhyza does not handle ${message.method}.` },
			});
			return;
		}
		if (typeof message.method === "string") {
			for (const listener of this.notificationListeners) listener(message);
		}
	}

	private failAll(error: Error): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		for (const listener of this.closeListeners) listener(error);
		this.closeListeners.clear();
	}

	private stderrSuffix(): string {
		return this.stderrLines.length ? ` ${this.stderrLines.at(-1)}` : "";
	}
}

async function resolveCodexExecutable(): Promise<string> {
	const configured = process.env.RHYZA_CODEX_EXECUTABLE?.trim();
	if (configured) {
		await access(configured, fsConstants.X_OK);
		return configured;
	}

	const localAppData = process.env.LOCALAPPDATA;
	if (localAppData) {
		const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
		try {
			const entries = await readdir(binRoot, { withFileTypes: true });
			const candidates = await Promise.all(
				entries
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const executable = path.join(binRoot, entry.name, "codex.exe");
						try {
							return { executable, modified: (await stat(executable)).mtimeMs };
						} catch {
							return undefined;
						}
					}),
			);
			const newest = candidates
				.filter((value): value is { executable: string; modified: number } => value !== undefined)
				.sort((left, right) => right.modified - left.modified)[0];
			if (newest) return newest.executable;
		} catch {
			// Fall through to PATH lookup performed by spawn.
		}
	}
	return process.platform === "win32" ? "codex.exe" : "codex";
}

export function contextToInput(context: Context, includeTranscript = true): JsonObject[] {
	const latestUser = [...context.messages].reverse().find((message) => message.role === "user");
	const transcript = context.messages
		.slice(0, latestUser ? context.messages.lastIndexOf(latestUser) : context.messages.length)
		.map(formatMessage)
		.filter(Boolean)
		.join("\n\n");
	const latestText = latestUser ? messageText(latestUser.content) : "Continue.";
	const text =
		includeTranscript && transcript
			? `<conversation_history>\n${transcript}\n</conversation_history>\n\n<current_user_request>\n${latestText}\n</current_user_request>`
			: latestText;
	const input: JsonObject[] = [{ type: "text", text, text_elements: [] }];
	if (latestUser && Array.isArray(latestUser.content)) {
		for (const content of latestUser.content) {
			if (content.type === "image") input.push(imageToInput(content));
		}
	}
	return input;
}

function formatMessage(message: Context["messages"][number]): string {
	if (message.role === "user") return `<user>\n${messageText(message.content)}\n</user>`;
	if (message.role === "assistant") {
		const text = message.content
			.map((content) => {
				if (content.type === "text") return content.text;
				if (content.type === "thinking") return content.thinking;
				return `[tool call: ${content.name} ${JSON.stringify(content.arguments)}]`;
			})
			.join("\n");
		return `<assistant>\n${text}\n</assistant>`;
	}
	return `<tool_result name="${escapeAttribute(message.toolName)}">\n${messageText(message.content)}\n</tool_result>`;
}

function messageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.map((item) => (item.type === "text" ? (item.text ?? "") : "[image attached]"))
		.filter(Boolean)
		.join("\n");
}

function imageToInput(image: ImageContent): JsonObject {
	return { type: "image", url: `data:${image.mimeType};base64,${image.data}` };
}

function buildDeveloperInstructions(systemPrompt?: string): string {
	return [
		"You are the Codex model provider embedded in Rhyza. Complete the current user request in the supplied working directory. Use Codex tools when useful. Return a clear final response for the user; do not describe this integration layer.",
		systemPrompt,
	]
		.filter(Boolean)
		.join("\n\n");
}

function emptyAssistantMessage(model: Model<string>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

interface UsageSnapshot {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

function readUsage(value: unknown): UsageSnapshot | undefined {
	const last = asObject(asObject(value).last);
	if (typeof last.totalTokens !== "number") return undefined;
	return {
		input: numberOrZero(last.inputTokens),
		output: numberOrZero(last.outputTokens),
		cacheRead: numberOrZero(last.cachedInputTokens),
		cacheWrite: numberOrZero(last.cacheWriteInputTokens),
		total: numberOrZero(last.totalTokens),
	};
}

function applyUsage(message: AssistantMessage, usage: UsageSnapshot): void {
	message.usage.input = usage.input;
	message.usage.output = usage.output;
	message.usage.cacheRead = usage.cacheRead;
	message.usage.cacheWrite = usage.cacheWrite;
	message.usage.totalTokens = usage.total;
}

function normalizeModalities(
	modalities: string[] | undefined,
	fallback: readonly ("text" | "image")[] | undefined,
): ("text" | "image")[] {
	const result = modalities?.filter(
		(modality): modality is "text" | "image" => modality === "text" || modality === "image",
	);
	return result?.length ? result : fallback ? [...fallback] : ["text", "image"];
}

function isCodexAccount(value: unknown): value is CodexAccount {
	if (!isObject(value)) return false;
	return value.type === "apiKey" || value.type === "chatgpt" || value.type === "amazonBedrock";
}

function isCodexModel(value: unknown): value is CodexModel {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		typeof value.model === "string" &&
		typeof value.displayName === "string" &&
		typeof value.hidden === "boolean"
	);
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
	return isObject(value) ? value : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function jsonRpcError(error: NonNullable<JsonRpcMessage["error"]>): Error {
	const suffix = error.code === undefined ? "" : ` (${error.code})`;
	return new Error(`${error.message ?? "Codex App Server request failed"}${suffix}`);
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

export const codexAppServerProviderId = providerId;
export const codexAppServerApi = appServerApi;
