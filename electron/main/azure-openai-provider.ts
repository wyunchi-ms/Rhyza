import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AzureCliCredential, type AzureCliCredentialOptions } from "@azure/identity";
import {
	createAssistantMessageEventStream,
	createProvider,
	type AssistantMessage,
	type Model,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import {
	convertResponsesMessages,
	convertResponsesTools,
	processResponsesStream,
} from "@earendil-works/pi-ai/api/openai-responses-shared";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import {
	validateAzureOpenAIConfig,
	type AzureOpenAIConfig,
	type ProviderStatusResponse,
} from "../../src/shared/ipc.js";

const scope = "https://cognitiveservices.azure.com/.default";
const refreshMarginMs = 120_000;
const authInstructions =
	"Install Azure CLI and run `az login`, then check that the configured subscription is available with `az account show --subscription <subscription-id>`. Your account needs permission to use the Azure OpenAI deployment.";
const authError =
	"Azure sign-in is unavailable. Run `az login` and check the configured subscription with `az account show --subscription <subscription-id>`.";
const staleConfigError = "Azure OpenAI settings changed. Retry with the saved deployment.";
const configReadError =
	"Azure OpenAI settings could not be read. Save valid Azure OpenAI settings and try again.";

type AccessToken = Awaited<ReturnType<AzureCliCredential["getToken"]>>;
type Credential = Pick<AzureCliCredential, "getToken">;

export interface AzureOpenAIProviderDependencies {
	credentialFactory?: (options: AzureCliCredentialOptions) => Credential;
	now?: () => number;
	fetch?: typeof globalThis.fetch;
}

interface TokenState {
	key: string;
	revision: number;
	credential?: Credential;
	token?: AccessToken;
	pending?: Promise<string>;
}

export class AzureOpenAIProvider {
	private readonly configPath: string;
	private readonly credentialFactory: (options: AzureCliCredentialOptions) => Credential;
	private readonly now: () => number;
	private readonly fetch: typeof globalThis.fetch;
	private writes: Promise<void> = Promise.resolve();
	private revision = 0;
	private tokenState?: TokenState;

	constructor(
		private readonly dataRoot: string,
		dependencies: AzureOpenAIProviderDependencies = {},
	) {
		this.configPath = join(dataRoot, "azure-openai.json");
		this.credentialFactory =
			dependencies.credentialFactory ?? ((options) => new AzureCliCredential(options));
		this.now = dependencies.now ?? Date.now;
		this.fetch = dependencies.fetch ?? globalThis.fetch;
	}

	async getConfig(): Promise<AzureOpenAIConfig | null> {
		await this.writes;
		let contents: string;
		try {
			contents = await readFile(this.configPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw new Error(configReadError);
		}
		try {
			return validateAzureOpenAIConfig(JSON.parse(contents));
		} catch {
			throw new Error(configReadError);
		}
	}

	async setConfig(config: AzureOpenAIConfig): Promise<void> {
		const snapshot = validateAzureOpenAIConfig(config);
		const write = this.writes.then(async () => {
			const stagingPath = `${this.configPath}.${randomUUID()}.write`;
			try {
				await mkdir(this.dataRoot, { recursive: true });
				await writeFile(stagingPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
					mode: 0o600,
					flag: "wx",
				});
				await rename(stagingPath, this.configPath);
				this.revision += 1;
				this.tokenState = undefined;
			} catch {
				throw new Error(
					"Azure OpenAI settings could not be saved. Check that the application data folder is writable.",
				);
			} finally {
				await rm(stagingPath, { force: true }).catch(() => undefined);
			}
		});
		this.writes = write.catch(() => undefined);
		await write;
	}

	async getStatus(): Promise<ProviderStatusResponse> {
		const base = {
			providerId: "azure-openai" as const,
			externalAuth: true,
			setupInstructions: authInstructions,
		};
		try {
			const config = await this.getConfig();
			if (!config) {
				return {
					...base,
					configured: false,
					error: "Save your Azure OpenAI endpoint, deployment, and subscription first.",
				};
			}
			await this.resolveToken(config, this.getTokenState(config));
			return {
				...base,
				configured: true,
				source: "Azure CLI",
				label: "Azure sign-in ready; deployment access has not been verified.",
			};
		} catch (error) {
			return {
				...base,
				configured: false,
				error:
					error instanceof Error && error.message === configReadError ? configReadError : authError,
			};
		}
	}

	async createProvider(): Promise<Provider | null> {
		const config = await this.getConfig();
		if (!config) {
			return null;
		}
		const snapshot = Object.freeze({ ...config });
		const state = this.getTokenState(snapshot);
		const resolveToken = () => this.resolveToken(snapshot, state);
		const model: Model<"openai-responses"> = {
			id: snapshot.deployment,
			name: snapshot.deployment,
			api: "openai-responses",
			provider: "azure-openai",
			baseUrl: snapshot.endpoint,
			reasoning: false,
			input: ["text"],
			// The SDK requires costs; zero means unknown, not a pricing estimate or free Azure usage.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: snapshot.contextWindow,
			maxTokens: snapshot.maxTokens,
		};
		const stream: ProviderStreams["stream"] = (_model, context, options) => {
			const events = createAssistantMessageEventStream();
			const output: AssistantMessage = {
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
				timestamp: this.now(),
			};
			void (async () => {
				try {
					if (
						context.messages.some(
							(message) =>
								Array.isArray(message.content) &&
								message.content.some((part) => part.type === "image"),
						)
					) {
						throw new Error("This Azure OpenAI connection supports text only.");
					}
					const token = await resolveToken();
					// pi-ai 0.82.1's standard adapter has no fetch hook. Reuse its converters and
					// stream processor, but own this client so redirects cannot forward credentials.
					const client = new OpenAI({
						apiKey: token,
						baseURL: snapshot.endpoint,
						organization: null,
						project: null,
						maxRetries: options?.maxRetries ?? 2,
						timeout: options?.timeoutMs,
						fetch: async (input, init) => {
							const url = new URL(input instanceof Request ? input.url : input.toString());
							if (
								url.origin !== new URL(snapshot.endpoint).origin ||
								url.pathname !== "/openai/v1/responses"
							) {
								throw new Error("Azure OpenAI request destination is invalid.");
							}
							const headers = new Headers(init?.headers);
							// Models.applyAuth lets explicit apiKey options win. Never forward them,
							// stored API keys, or ambient keys; only this CLI credential is accepted.
							headers.delete("api-key");
							headers.set("Authorization", `Bearer ${await resolveToken()}`);
							return this.fetch(input, { ...init, headers, redirect: "error" });
						},
					});
					let params: ResponseCreateParamsStreaming = {
						model: snapshot.deployment,
						input: convertResponsesMessages(
							model,
							context,
							new Set(["openai", "openai-codex", "opencode", "azure-openai"]),
						),
						tools: context.tools?.length
							? convertResponsesTools(context.tools, { supportsStrictMode: false })
							: undefined,
						stream: true,
						store: false,
						max_output_tokens: Math.min(
							snapshot.maxTokens,
							Math.max(16, options?.maxTokens ?? snapshot.maxTokens),
						),
					};
					const replacement = await options?.onPayload?.(params, model);
					if (replacement !== undefined) {
						if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
							throw new Error("Azure OpenAI request payload is invalid.");
						}
						params = { ...params, ...replacement };
					}
					// Payload hooks may transform messages and tools, never connection policy.
					params.model = snapshot.deployment;
					params.stream = true;
					params.store = false;
					params.max_output_tokens = Math.min(
						snapshot.maxTokens,
						Math.max(
							16,
							Number.isFinite(params.max_output_tokens)
								? Math.floor(params.max_output_tokens!)
								: snapshot.maxTokens,
						),
					);
					delete params.reasoning;
					delete params.temperature;
					const { data, response } = await client.responses
						.create(params, { signal: options?.signal })
						.withResponse();
					await options?.onResponse?.(
						{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
						model,
					);
					events.push({ type: "start", partial: output });
					await processResponsesStream(data, output, events, model);
					if (
						options?.signal?.aborted ||
						output.stopReason === "error" ||
						output.stopReason === "aborted"
					) {
						throw new Error("Azure OpenAI response did not complete.");
					}
					events.push({ type: "done", reason: output.stopReason, message: output });
				} catch (error) {
					for (const content of output.content) {
						const block = content as unknown as Record<string, unknown>;
						delete block.index;
						delete block.partialJson;
						delete block.customInput;
					}
					output.stopReason = options?.signal?.aborted ? "aborted" : "error";
					output.errorMessage = options?.signal?.aborted
						? "Azure OpenAI request was canceled."
						: this.requestError(error);
					events.push({ type: "error", reason: output.stopReason, error: output });
				} finally {
					events.end();
				}
			})();
			return events;
		};
		return createProvider({
			id: "azure-openai",
			name: "Azure OpenAI",
			baseUrl: snapshot.endpoint,
			models: [model],
			auth: {
				apiKey: {
					name: "Azure CLI",
					check: async () => ({ type: "api_key", source: "Azure OpenAI settings" }),
					resolve: async () => ({
						auth: { apiKey: await resolveToken(), baseUrl: snapshot.endpoint },
						source: "Azure CLI",
					}),
				},
			},
			api: { stream, streamSimple: stream },
		});
	}

	private getTokenState(config: AzureOpenAIConfig): TokenState {
		const key = JSON.stringify(config);
		if (!this.tokenState || this.tokenState.key !== key) {
			this.tokenState = { key, revision: this.revision };
		}
		return this.tokenState;
	}

	private async resolveToken(config: AzureOpenAIConfig, state: TokenState): Promise<string> {
		if (state.revision !== this.revision || state !== this.tokenState) {
			throw new Error(staleConfigError);
		}
		if (state.token && state.token.expiresOnTimestamp > this.now() + refreshMarginMs) {
			return state.token.token;
		}
		if (!state.pending) {
			state.token = undefined;
			state.pending = Promise.resolve().then(async () => {
				try {
					state.credential ??= this.credentialFactory({
						subscription: config.subscriptionId,
						processTimeoutInMs: 15_000,
					});
					const token = await state.credential.getToken(scope);
					if (
						!token?.token?.trim() ||
						!Number.isFinite(token.expiresOnTimestamp) ||
						token.expiresOnTimestamp <= this.now() + refreshMarginMs
					) {
						throw new Error(authError);
					}
					if (state.revision !== this.revision || state !== this.tokenState) {
						throw new Error(staleConfigError);
					}
					state.token = token;
					return token.token;
				} catch {
					state.token = undefined;
					throw new Error(authError);
				} finally {
					state.pending = undefined;
				}
			});
		}
		return state.pending;
	}

	private requestError(error: unknown): string {
		if (
			error instanceof Error &&
			[authError, staleConfigError, "This Azure OpenAI connection supports text only."].includes(
				error.message,
			)
		) {
			return error.message;
		}
		if (error instanceof OpenAI.APIError) {
			if (error.status === 401 || error.status === 403) {
				return "Azure OpenAI denied access. Run `az login`, check the subscription, and ask the resource owner to verify your deployment permissions.";
			}
			if (error.status === 404) {
				return "Azure OpenAI deployment was not found. Check the endpoint and deployment name.";
			}
			if (error.status === 429) {
				return "Azure OpenAI is currently rate limited. Check the deployment quota or try again later.";
			}
		}
		return "Azure OpenAI request failed. Check the endpoint, deployment, network connection, and deployment capabilities, then try again.";
	}
}
