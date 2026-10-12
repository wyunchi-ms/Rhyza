import path from "node:path";
import { homedir, tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import {
	createAgentSession,
	createMcpExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionAPI,
	type ExtensionFactory,
	type McpTransportFactory,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	McpAuthRequiredError,
	StdioTransport,
	StreamableHttpTransport,
	type JsonRpcMessage,
	type McpTransport,
} from "@earendil-works/pi-mcp";
import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import { isRecord, errorToMessage } from "../../src/shared/value.js";
import {
	effectiveMcpExposure,
	validateMcpSave,
	type McpActionRequest,
	type McpEvent,
	type McpOverview,
	type McpResourceRequest,
	type McpSaveRequest,
	type McpServerInfo,
	type McpTarget,
} from "../../src/shared/mcp.js";
import { McpConfigStore, type McpEntry } from "./mcp-config-store.js";

const resourceTools = new Set([
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
]);

export class McpService {
	readonly config: McpConfigStore;
	private readonly runtimes = new Set<McpRuntime>();
	private readonly managers = new Map<
		string,
		Promise<{ session: AgentSession; runtime: McpRuntime }>
	>();
	private readonly revisions = new Map<string, number>();
	private readonly signatures = new Map<string, string>();
	private disposed = false;

	constructor(
		agentDir: string,
		dataRoot: string,
		private readonly emit: (event: McpEvent) => void = () => {},
		private readonly openUrl: (url: string) => void | Promise<void> = () => {},
	) {
		this.config = new McpConfigStore(agentDir, dataRoot);
	}

	revision(workspace: string): number {
		return this.revisions.get(workspace) ?? 0;
	}

	createRuntime(workspace: string, writable: () => boolean): McpRuntime {
		if (!this.signatures.has(workspace)) this.signatures.set(workspace, this.signature(workspace));
		const runtime = new McpRuntime(this, workspace, writable, this.openUrl);
		this.runtimes.add(runtime);
		return runtime;
	}

	private signature(workspace: string): string {
		return JSON.stringify(this.config.snapshot(workspace));
	}

	async refresh(workspace: string): Promise<void> {
		const signature = this.signature(workspace);
		const previous = this.signatures.get(workspace);
		if (previous !== undefined && previous !== signature) await this.invalidate(workspace);
		this.signatures.set(workspace, signature);
	}

	release(runtime: McpRuntime): void {
		this.runtimes.delete(runtime);
	}

	changed(workspace: string): void {
		if (!this.disposed) this.emit({ workspacePath: workspace, type: "changed" });
	}

	auth(workspace: string, name: string, url: string): void {
		this.emit({ workspacePath: workspace, type: "auth", name, url });
	}

	async overview(workspace: string | null): Promise<McpOverview> {
		if (!workspace)
			return {
				workspacePath: null,
				projectTrusted: false,
				projectConfigExists: false,
				servers: [],
				errors: [],
			};
		await this.refresh(workspace);
		await this.manager(workspace);
		const snapshot = this.config.snapshot(workspace);
		const runtimes = [...this.runtimes].filter(
			(runtime) => runtime.workspace === workspace && !runtime.invalidated,
		);
		const servers = snapshot.servers.map((entry): McpServerInfo => {
			const states = runtimes
				.map((runtime) => runtime.states.get(entry.name))
				.filter((state) => state !== undefined);
			const attention = states.find(
				(state) =>
					state.state === "failed" ||
					state.state === "needs-auth" ||
					state.state === "disconnected",
			);
			const current = attention ?? states.find((state) => state.state === "connected") ?? states[0];
			const tools = new Map(
				states.flatMap((state) => state.tools).map((tool) => [tool.name, tool]),
			);
			return {
				name: entry.name,
				scope: entry.scope,
				source: entry.source,
				transport: "url" in entry.config ? "http" : "stdio",
				enabled: entry.config.enabled !== false,
				exposure: effectiveMcpExposure(entry.config, ""),
				state: entry.config.enabled === false ? "disabled" : (current?.state ?? "connecting"),
				error: current?.error,
				oauth:
					"url" in entry.config &&
					!Object.keys(entry.config.headers ?? {}).some(
						(key) => key.toLowerCase() === "authorization",
					),
				connections: states.filter((state) => state.state === "connected").length,
				tools: [...tools.values()].map((tool) => ({
					...tool,
					exposure: effectiveMcpExposure(entry.config, tool.name),
					permission: Object.hasOwn(entry.policy.tools, tool.name)
						? entry.policy.tools[tool.name]
						: "blocked",
				})),
			};
		});
		return {
			workspacePath: workspace,
			projectTrusted: snapshot.trusted,
			projectConfigExists: snapshot.projectConfigExists,
			servers,
			errors: [
				...snapshot.errors,
				...runtimes.flatMap((runtime) =>
					[...runtime.states.entries()]
						.filter(([name]) => !snapshot.servers.some((entry) => entry.name === name))
						.flatMap(([, state]) => (state.error ? [state.error] : [])),
				),
			],
		};
	}

	async edit(workspace: string, target: McpTarget): Promise<McpSaveRequest> {
		const entry = this.config.get(workspace, target);
		const config = structuredClone(entry.config);
		if ("url" in config) {
			config.headers = this.maskValues(config.headers);
			if (config.oauth?.clientSecret) config.oauth.clientSecret = "${RHYZA_STORED_SECRET}";
		} else {
			config.env = this.maskValues(config.env);
		}
		return { ...target, config, policy: entry.policy };
	}

	private maskValues(values?: Record<string, string>): Record<string, string> | undefined {
		return (
			values &&
			Object.fromEntries(
				Object.entries(values).map(([key, value]) => [
					key,
					/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ? value : "${RHYZA_STORED_SECRET}",
				]),
			)
		);
	}

	async save(workspace: string, request: McpSaveRequest): Promise<void> {
		request = validateMcpSave(request);
		const existing = this.config
			.snapshot(workspace)
			.servers.find((entry) => entry.scope === request.scope && entry.name === request.name);
		const destination = (config: McpSaveRequest["config"]) =>
			"url" in config
				? JSON.stringify([config.url, config.oauth?.clientId, config.oauth?.authServerMetadataUrl])
				: JSON.stringify([config.command, config.args ?? [], config.cwd ?? "."]);
		const destinationChanged =
			existing && destination(existing.config) !== destination(request.config);
		const preserve = (
			values: Record<string, string> | undefined,
			previous: Record<string, string> | undefined,
		) => {
			if (!values) return;
			for (const [key, value] of Object.entries(values)) {
				if (value === "${RHYZA_STORED_SECRET}") {
					if (destinationChanged)
						throw new Error(
							"Replace or remove stored secrets before changing this server's command, arguments, working directory, URL or OAuth client.",
						);
					if (!previous?.[key])
						throw new Error("A stored secret cannot be copied to a new field or server.");
					values[key] = previous[key];
				}
			}
		};
		if ("url" in request.config) {
			const previous = existing && "url" in existing.config ? existing.config : undefined;
			preserve(request.config.headers, previous?.headers);
			if (request.config.oauth?.clientSecret === "${RHYZA_STORED_SECRET}") {
				if (destinationChanged)
					throw new Error(
						"Replace or remove the stored OAuth secret before changing the server URL or client.",
					);
				if (!previous?.oauth?.clientSecret) throw new Error("No stored OAuth secret exists.");
				request.config.oauth.clientSecret = previous.oauth.clientSecret;
			}
		} else {
			preserve(
				request.config.env,
				existing && "command" in existing.config ? existing.config.env : undefined,
			);
		}
		try {
			await this.config.save(workspace, request);
		} finally {
			await this.invalidate(request.scope === "user" ? undefined : workspace);
		}
	}

	async remove(workspace: string, target: McpTarget): Promise<void> {
		try {
			await this.config.remove(workspace, target);
		} finally {
			await this.invalidate(target.scope === "user" ? undefined : workspace);
		}
	}

	async trust(workspace: string, trusted: boolean): Promise<void> {
		await this.config.trust(workspace, trusted);
		await this.invalidate(workspace);
	}

	async action(workspace: string, request: McpActionRequest): Promise<void> {
		if (request.action !== "cancel-login") await this.refresh(workspace);
		const entry = this.config.get(workspace, request);
		if (request.action === "cancel-login") {
			for (const runtime of this.runtimes) {
				if (runtime.workspace === workspace) runtime.cancelLogin();
			}
			return;
		}
		if (entry.config.enabled === false) throw new Error("Enable this MCP server first.");
		const { runtime } = await this.manager(workspace);
		await runtime.command(request.action, request.name);
		if (
			request.action === "login" ||
			request.action === "logout" ||
			request.action === "reconnect"
		) {
			for (const other of this.runtimes) {
				if (other !== runtime && !other.invalidated && other.workspace === workspace)
					await other.command(request.action === "logout" ? "logout" : "reconnect", request.name);
			}
		}
		this.changed(workspace);
	}

	async resources(workspace: string, request: McpResourceRequest): Promise<string> {
		await this.refresh(workspace);
		const entry = this.config.get(workspace, request);
		if (entry.config.enabled === false || effectiveMcpExposure(entry.config, "") === "hidden")
			throw new Error("This MCP server's resources are unavailable.");
		const { session } = await this.manager(workspace);
		// The SDK command waits for background connection/discovery without making a model request.
		await session.extensionRunner
			.getCommand("mcp")
			?.handler("", session.extensionRunner.createCommandContext());
		const name =
			request.action === "list"
				? "list_mcp_resources"
				: request.action === "templates"
					? "list_mcp_resource_templates"
					: "read_mcp_resource";
		const definition = session.getToolDefinition(name);
		if (!definition) throw new Error("This MCP server offers no resources.");
		const result = await definition.execute(
			"mcp-resource-inspector",
			{
				server: request.name,
				...(request.uri ? { uri: request.uri } : {}),
				...(request.cursor ? { cursor: request.cursor } : {}),
			},
			undefined,
			undefined,
			session.extensionRunner.createToolContext("mcp-resource-inspector", undefined),
		);
		let content = result.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const payload = "structuredContent" in result ? result.structuredContent : undefined;
		if (isRecord(payload)) {
			if (request.action === "read" && Array.isArray(payload.contents)) {
				content = payload.contents
					.filter(isRecord)
					.filter((item) => typeof item.text === "string")
					.map((item) => String(item.text))
					.join("\n");
			} else if (request.action !== "read") content = JSON.stringify(payload, null, 2);
		}
		const output = isRecord(result.details) ? result.details.fullOutputPath : undefined;
		if (
			typeof output === "string" &&
			path.resolve(path.dirname(output)) === path.resolve(tmpdir()) &&
			/^pi-mcp-[a-f0-9]+\.txt$/.test(path.basename(output))
		) {
			try {
				await unlink(output);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		if (Buffer.byteLength(content, "utf8") > 128 * 1024)
			throw new Error("Resource preview exceeds 128 KB. Read it through an agent instead.");
		return content || "This resource has no text preview.";
	}

	private async manager(
		workspace: string,
	): Promise<{ session: AgentSession; runtime: McpRuntime }> {
		if (this.disposed) throw new Error("MCP service is closed.");
		let pending = this.managers.get(workspace);
		if (!pending) {
			pending = this.createManager(workspace);
			this.managers.set(workspace, pending);
		}
		try {
			return await pending;
		} catch (error) {
			if (this.managers.get(workspace) === pending) this.managers.delete(workspace);
			throw error;
		}
	}

	private async createManager(
		workspace: string,
	): Promise<{ session: AgentSession; runtime: McpRuntime }> {
		const runtime = this.createRuntime(workspace, () => false);
		const settingsManager = SettingsManager.inMemory({
			cacheWarming: "off",
			extensions: [],
			skills: [],
		});
		const loader = new DefaultResourceLoader({
			cwd: workspace,
			agentDir: this.config.agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			extensionFactories: [createToolSearchExtension(), runtime.extension],
		});
		try {
			await loader.reload();
			const { session } = await createAgentSession({
				cwd: workspace,
				agentDir: this.config.agentDir,
				settingsManager,
				sessionManager: SessionManager.inMemory(workspace),
				resourceLoader: loader,
				noTools: "builtin",
			});
			runtime.session = session;
			if (runtime.invalidated) return { session, runtime };
			await session.bindExtensions({});
			return { session, runtime };
		} catch (error) {
			runtime.session?.dispose();
			await runtime.close();
			throw error;
		}
	}

	private async invalidate(workspace?: string): Promise<void> {
		const affected = new Set(
			[...this.runtimes]
				.filter((runtime) => workspace === undefined || runtime.workspace === workspace)
				.map((runtime) => runtime.workspace),
		);
		if (workspace) affected.add(workspace);
		for (const item of affected) this.revisions.set(item, this.revision(item) + 1);
		const managers = [...affected]
			.map((item) => this.managers.get(item))
			.filter((manager) => manager !== undefined);
		for (const item of affected) {
			this.managers.delete(item);
			this.signatures.delete(item);
		}
		await Promise.all(
			[...this.runtimes]
				.filter((runtime) => affected.has(runtime.workspace))
				.map((runtime) => runtime.close()),
		);
		for (const item of affected) {
			this.changed(item);
		}
		for (const manager of managers) (await manager).session.dispose();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.invalidate();
	}
}

interface RuntimeState {
	state: Exclude<McpServerInfo["state"], "disabled">;
	error?: string;
	tools: McpServerInfo["tools"];
}

export class McpRuntime {
	readonly states = new Map<string, RuntimeState>();
	readonly extension: ExtensionFactory;
	session?: AgentSession;
	invalidated = false;
	private readonly transports = new Set<McpTransport>();
	private readonly entries = new Map<string, McpEntry>();
	private readonly definitions = new Map<string, { entry: McpEntry; tool: string }>();
	private cancelAuth?: () => void;
	private commandBusy = false;
	private readonly restoredTools = new Set<string>();
	private loginCancelled = false;

	constructor(
		private readonly host: McpService,
		readonly workspace: string,
		private readonly writable: () => boolean,
		openUrl: (url: string) => void | Promise<void>,
	) {
		this.extension = (pi) => {
			const factory = createMcpExtension({
				loadConfig: () => {
					const loaded = host.config.snapshot(workspace);
					for (const entry of loaded.servers) {
						this.entries.set(entry.name, entry);
						this.states.set(entry.name, { state: "connecting", tools: [] });
					}
					return {
						servers: loaded.servers.map((entry) => ({
							name: entry.name,
							scope: entry.scope === "user" ? "global" : "project",
							source: entry.source,
							config: entry.config,
						})),
						errors: loaded.errors,
						autoEnableCodemode: false,
					};
				},
				createTransport: (entry, cwd, auth) => this.transport(entry, cwd, auth),
				openUrl: (url) => {
					host.auth(workspace, this.loginName ?? "", url);
					return openUrl(url);
				},
			});
			const adapter: ExtensionAPI = {
				...pi,
				registerTool: (definition) => {
					const owned = this.owner(definition);
					if (owned) this.definitions.set(definition.name, owned);
					pi.registerTool({
						...definition,
						...(resourceTools.has(definition.name)
							? {
									description: `${definition.description}\nRhyza requires an explicit server argument for resource access.`,
								}
							: {}),
						execute: async (...args) => {
							this.assertAllowed(definition, args[1]);
							return definition.execute(...args);
						},
					});
					if (this.restoredTools.has(definition.name) && definition.exposure !== "hidden") {
						pi.setActiveTools([...new Set([...pi.getActiveTools(), definition.name])]);
					}
				},
			};
			factory(adapter);
			pi.on("session_start", (_event, ctx) => {
				const entry = ctx.sessionManager
					.getBranch()
					.slice()
					.reverse()
					.find((item) => item.type === "custom" && item.customType === "rhyza.mcp-loadout");
				if (entry?.type === "custom" && isRecord(entry.data) && Array.isArray(entry.data.tools)) {
					for (const name of entry.data.tools)
						if (typeof name === "string" && name.startsWith("mcp__")) this.restoredTools.add(name);
				}
			});
			pi.on("before_agent_start", async () => {
				if (!this.restoredTools.size) return;
				const started = Date.now();
				while (!this.invalidated && Date.now() - started < 10_000) {
					const registered = new Set(
						[...this.definitions.values()].map(({ entry, tool }) => `${entry.name}/${tool}`),
					);
					const waiting = [...this.entries.values()].some((entry) => {
						if (entry.config.enabled === false) return false;
						const state = this.states.get(entry.name);
						if (state?.state === "connecting") return true;
						if (state?.state !== "connected") return false;
						return state.tools.some(
							(tool) =>
								effectiveMcpExposure(entry.config, tool.name) !== "hidden" &&
								!registered.has(`${entry.name}/${tool.name}`),
						);
					});
					if (!waiting) break;
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				if (this.invalidated) return;
				const available = new Set(
					pi
						.getAllTools()
						.filter((tool) => tool.exposure !== "hidden")
						.map((tool) => tool.name),
				);
				const restored = [...this.restoredTools].filter((name) => available.has(name));
				if (restored.length) pi.setActiveTools([...new Set([...pi.getActiveTools(), ...restored])]);
			});
			pi.on("session_shutdown", () => this.close());
		};
	}

	private loginName?: string;

	private owner(
		definition: Pick<ToolDefinition, "name" | "label">,
	): { entry: McpEntry; tool: string } | undefined {
		for (const entry of this.entries.values()) {
			const tools = this.states.get(entry.name)?.tools ?? [];
			const tool = tools.find((item) => definition.label === `${entry.name}/${item.name}`);
			if (tool) return { entry, tool: tool.name };
		}
		return undefined;
	}

	private assertAllowed(definition: Pick<ToolDefinition, "name">, params: unknown): void {
		if (this.invalidated) throw new Error("MCP configuration changed. Retry on the next turn.");
		if (resourceTools.has(definition.name)) {
			const name =
				isRecord(params) && typeof params.server === "string" ? params.server : undefined;
			const entries = this.host.config.snapshot(this.workspace).servers;
			if (!name) throw new Error("Specify an enabled, visible MCP server for resource access.");
			const original = this.entries.get(name);
			const current = entries.find((entry) => entry.name === name);
			if (
				!original ||
				!current ||
				original.fingerprint !== current.fingerprint ||
				current.config.enabled === false ||
				effectiveMcpExposure(current.config, "") === "hidden"
			)
				throw new Error("MCP resource access was revoked.");
			return;
		}
		const owner = this.definitions.get(definition.name);
		if (!owner) throw new Error("This MCP tool has no host-approved identity and is blocked.");
		const current = this.host.config.get(this.workspace, owner.entry);
		if (
			current.fingerprint !== owner.entry.fingerprint ||
			current.config.enabled === false ||
			effectiveMcpExposure(current.config, owner.tool) === "hidden"
		)
			throw new Error("MCP tool access was revoked or its server configuration changed.");
		const permission = Object.hasOwn(current.policy.tools, owner.tool)
			? current.policy.tools[owner.tool]
			: "blocked";
		if (permission === "blocked")
			throw new Error(
				`Permission blocked for MCP ${current.name}/${owner.tool}. Approve this exact tool in Settings > MCP servers.`,
			);
		if (permission === "write" && !this.writable())
			throw new Error(`MCP ${current.name}/${owner.tool} requires a writable, isolated session.`);
	}

	private transport(...args: Parameters<McpTransportFactory>): McpTransport {
		const [entry, cwd, authProvider] = args;
		const approved = this.entries.get(entry.name);
		if (
			this.invalidated ||
			!approved ||
			entry.scope !== (approved.scope === "user" ? "global" : "project") ||
			this.host.config.fingerprint(entry.config) !== approved.fingerprint
		) {
			const message = `MCP server "${entry.name}" is not configured or its identity changed. Configure it in Settings before connecting; extension-only servers are not loaded.`;
			this.state(entry.name, "failed", message);
			throw new Error(message);
		}
		const expandHome = (value: string) =>
			value === "~"
				? homedir()
				: /^~[\\/]/.test(value)
					? path.join(homedir(), value.slice(2))
					: value;
		const resolveValue = (value: string): string =>
			value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
				const resolved = process.env[key];
				if (resolved === undefined) throw new Error(`Missing MCP environment variable: ${key}.`);
				return resolved;
			});
		const config = entry.config;
		let transport: McpTransport;
		try {
			transport =
				"url" in config
					? new StreamableHttpTransport({
							url: resolveValue(config.url),
							headers: Object.fromEntries(
								Object.entries(config.headers ?? {}).map(([key, value]) => [
									key,
									resolveValue(value),
								]),
							),
							authProvider,
						})
					: new StdioTransport({
							command: expandHome(resolveValue(config.command)),
							args: config.args?.map((value) => expandHome(resolveValue(value))),
							cwd: path.resolve(cwd, expandHome(resolveValue(config.cwd ?? "."))),
							env: Object.fromEntries(
								Object.entries(config.env ?? {}).map(([key, value]) => [key, resolveValue(value)]),
							),
							stderr: "pipe",
						});
		} catch (error) {
			this.state(entry.name, "failed", this.safeError(error));
			throw error;
		}
		this.transports.add(transport);
		const pending = new Map<string | number, string>();
		transport.onMessage((message) => {
			if (!("id" in message) || message.id === null) return;
			const method = pending.get(message.id);
			pending.delete(message.id);
			if ("result" in message && isRecord(message.result)) {
				if (method === "tools/list" && Array.isArray(message.result.tools)) {
					const state = this.states.get(entry.name);
					if (state)
						state.tools = message.result.tools
							.filter(isRecord)
							.filter((tool) => typeof tool.name === "string")
							.map((tool) => ({
								name: String(tool.name),
								description:
									typeof tool.description === "string" ? tool.description.slice(0, 4096) : "",
								exposure: effectiveMcpExposure(config, String(tool.name)),
								permission: "blocked",
								...(isRecord(tool.annotations) && typeof tool.annotations.readOnlyHint === "boolean"
									? { readOnlyHint: tool.annotations.readOnlyHint }
									: {}),
								...(isRecord(tool.annotations) &&
								typeof tool.annotations.destructiveHint === "boolean"
									? { destructiveHint: tool.annotations.destructiveHint }
									: {}),
							}));
					this.state(entry.name, "connected");
				}
				if (
					method === "initialize" &&
					(!isRecord(message.result.capabilities) || !message.result.capabilities.tools)
				)
					this.state(entry.name, "connected");
			}
			if ("error" in message && (method === "initialize" || method === "tools/list"))
				this.state(entry.name, "failed", "MCP server rejected initialization or tool discovery.");
		});
		transport.onError((error) =>
			this.state(
				entry.name,
				this.needsAuth(error) ? "needs-auth" : "failed",
				this.safeError(error),
			),
		);
		transport.onClose(() => {
			this.transports.delete(transport);
			const current = this.states.get(entry.name);
			if (!this.invalidated && current?.state === "connected")
				this.state(
					entry.name,
					"disconnected",
					"MCP connection closed. Reconnect or retry the next call.",
				);
			else if (!this.invalidated && current?.state === "connecting")
				this.state(
					entry.name,
					"failed",
					"MCP initialization failed or timed out. Check the server command, endpoint and timeout.",
				);
		});
		this.state(entry.name, "connecting");
		const fail = (error: unknown) => {
			this.state(
				entry.name,
				this.needsAuth(error) ? "needs-auth" : "failed",
				this.safeError(error),
			);
			throw error;
		};
		return {
			start: () => transport.start().catch(fail),
			send: (message: JsonRpcMessage) => {
				if ("method" in message && "id" in message) pending.set(message.id, message.method);
				return transport.send(message).catch(fail);
			},
			close: () => transport.close(),
			onMessage: (listener) => transport.onMessage(listener),
			onError: (listener) => transport.onError(listener),
			onClose: (listener) => transport.onClose(listener),
			setProtocolVersion: (version) => transport.setProtocolVersion?.(version),
		};
	}

	private needsAuth(error: unknown): boolean {
		return (
			error instanceof McpAuthRequiredError || error instanceof McpOAuthAuthorizationRequiredError
		);
	}

	private safeError(error: unknown): string {
		let message = errorToMessage(error).slice(0, 2000);
		for (const entry of this.entries.values()) {
			const values =
				"url" in entry.config
					? [...Object.values(entry.config.headers ?? {}), entry.config.oauth?.clientSecret]
					: Object.values(entry.config.env ?? {});
			for (const value of values) {
				if (!value) continue;
				const resolved = value.replace(
					/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
					(_match, name: string) => process.env[name] ?? "",
				);
				for (const secret of [value, resolved])
					if (secret.length >= 4) message = message.split(secret).join("[redacted]");
			}
		}
		return message;
	}

	private state(name: string, state: RuntimeState["state"], error?: string): void {
		const previous = this.states.get(name);
		this.states.set(name, { state, tools: previous?.tools ?? [], error });
		this.host.changed(this.workspace);
	}

	async command(action: "login" | "logout" | "reconnect", name: string): Promise<void> {
		if (!this.session || this.invalidated) throw new Error("MCP runtime is unavailable.");
		if (this.commandBusy) throw new Error("Wait for the current MCP operation to finish.");
		this.commandBusy = true;
		this.loginCancelled = false;
		this.loginName = name;
		let failure: string | undefined;
		try {
			const runner = this.session.extensionRunner;
			const command = runner.getCommand("mcp");
			if (!command) throw new Error("The MCP manager was replaced by an installed extension.");
			const context = runner.createCommandContext();
			await command.handler(`${action} ${name}`, {
				...context,
				hasUI: true,
				mode: "rpc",
				ui: {
					...context.ui,
					notify: (message, level) => {
						if (level === "error" || message === "Sign-in cancelled.")
							failure = this.safeError(new Error(message));
					},
					input: (_title, _placeholder, options) =>
						new Promise<string | undefined>((resolve) => {
							const finish = () => {
								options?.signal?.removeEventListener("abort", finish);
								this.cancelAuth = undefined;
								resolve(undefined);
							};
							this.cancelAuth = finish;
							if (this.loginCancelled || options?.signal?.aborted) finish();
							else options?.signal?.addEventListener("abort", finish, { once: true });
						}),
				},
			});
			if (failure) throw new Error(failure);
			if (action === "logout") this.state(name, "needs-auth", "Sign in to use this MCP server.");
		} finally {
			this.commandBusy = false;
			this.loginName = undefined;
		}
	}

	cancelLogin(): void {
		this.loginCancelled = true;
		this.cancelAuth?.();
	}

	async close(): Promise<void> {
		if (this.invalidated) return;
		this.invalidated = true;
		this.cancelLogin();
		await Promise.all([...this.transports].map((transport) => transport.close()));
		this.transports.clear();
		this.host.release(this);
	}
}
