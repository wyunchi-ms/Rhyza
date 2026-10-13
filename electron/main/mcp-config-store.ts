import { readFileSync, existsSync } from "node:fs";
import { mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../src/shared/value.js";
import {
	validateMcpConfig,
	validateMcpPolicy,
	validateMcpTarget,
	validateMcpSave,
	type McpPolicy,
	type McpSaveRequest,
	type McpScope,
	type McpTarget,
} from "../../src/shared/mcp.js";

export interface McpEntry {
	name: string;
	scope: McpScope;
	source: string;
	config: McpServerConfig;
	policy: McpPolicy;
	fingerprint: string;
}

interface ConfigDocument {
	value: Record<string, unknown>;
	servers: McpEntry[];
	errors: string[];
}

export class McpConfigStore {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		readonly agentDir: string,
		private readonly dataRoot: string,
	) {}

	private configPath(scope: McpScope, workspace: string): string {
		return scope === "user"
			? path.join(this.agentDir, "mcp.json")
			: path.join(workspace, ".pi", "mcp.json");
	}

	private policyPath(workspace: string): string {
		const key = createHash("sha256").update(this.canonicalKey(workspace)).digest("hex");
		return path.join(this.dataRoot, "mcp", `${key}.json`);
	}

	private canonicalKey(workspace: string): string {
		const resolved = path.resolve(workspace);
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	}

	private hostState(workspace: string): {
		trusted: boolean;
		approvals: Record<string, { fingerprint: string; policy: McpPolicy }>;
	} {
		const value = this.readDocument(this.policyPath(workspace));
		if (value.trusted !== undefined && typeof value.trusted !== "boolean")
			throw new Error("Invalid saved MCP project trust.");
		if (value.approvals !== undefined && !isRecord(value.approvals))
			throw new Error("Invalid saved MCP permissions.");
		const approvals: Record<string, { fingerprint: string; policy: McpPolicy }> = {};
		for (const [key, approval] of Object.entries(value.approvals ?? {})) {
			if (!isRecord(approval) || typeof approval.fingerprint !== "string")
				throw new Error("Invalid saved MCP approval.");
			approvals[key] = {
				fingerprint: approval.fingerprint,
				policy: validateMcpPolicy(approval.policy),
			};
		}
		return { trusted: value.trusted === true, approvals };
	}

	private readDocument(filename: string): Record<string, unknown> {
		let text: string;
		try {
			text = readFileSync(filename, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		if (Buffer.byteLength(text, "utf8") > 1_000_000)
			throw new Error("MCP configuration exceeds 1 MB.");
		const value: unknown = JSON.parse(text);
		if (!isRecord(value)) throw new Error("MCP configuration must contain an object.");
		return value;
	}

	private load(scope: McpScope, workspace: string): ConfigDocument {
		const source = this.configPath(scope, workspace);
		const value = this.readDocument(source);
		if (value.mcpServers !== undefined && !isRecord(value.mcpServers))
			throw new Error(`${scope} mcpServers must be an object.`);
		const servers: McpEntry[] = [];
		const errors: string[] = [];
		const names = new Set<string>();
		const state = this.hostState(workspace);
		for (const [name, raw] of Object.entries(value.mcpServers ?? {})) {
			try {
				validateMcpTarget({ name, scope });
				const namespace = name.replace(/-/g, "_");
				if (names.has(namespace))
					throw new Error("Server names collide after replacing hyphens with underscores.");
				names.add(namespace);
				const config = validateMcpConfig(raw);
				const fingerprint = this.fingerprint(config);
				const approval = state.approvals[`${scope}:${name}`];
				servers.push({
					name,
					scope,
					source,
					config,
					fingerprint,
					policy:
						approval?.fingerprint === fingerprint
							? approval.policy
							: { tools: Object.create(null) },
				});
			} catch (error) {
				// Do not echo raw config, which may contain credentials.
				errors.push(
					`${scope} server "${name}": ${error instanceof Error ? error.message : "Invalid configuration."}`,
				);
			}
		}
		return { value, servers, errors };
	}

	fingerprint(config: McpServerConfig): string {
		const {
			enabled: _enabled,
			exposure: _exposure,
			toolExposure: _toolExposure,
			description: _description,
			...identity
		} = config;
		const stable = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(stable);
			if (isRecord(value))
				return Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, stable(value[key])]),
				);
			return value;
		};
		return createHash("sha256")
			.update(JSON.stringify(stable(identity)))
			.digest("hex");
	}

	snapshot(workspace: string): {
		servers: McpEntry[];
		errors: string[];
		trusted: boolean;
		projectConfigExists: boolean;
	} {
		const state = this.hostState(workspace);
		const errors: string[] = [];
		const entries = new Map<string, McpEntry>();
		for (const scope of ["user", "project"] as const) {
			if (scope === "project" && !state.trusted) continue;
			try {
				const loaded = this.load(scope, workspace);
				errors.push(...loaded.errors);
				for (const entry of loaded.servers) {
					const namespace = entry.name.replace(/-/g, "_");
					const existing = entries.get(namespace);
					if (existing && existing.name !== entry.name) {
						errors.push(
							`${scope} server "${entry.name}": its namespace collides with "${existing.name}". Use a distinct name.`,
						);
						continue;
					}
					entries.set(namespace, entry);
				}
			} catch (error) {
				errors.push(
					`${scope} MCP configuration: ${error instanceof Error ? error.message : "Could not read configuration."}`,
				);
			}
		}
		return {
			servers: [...entries.values()],
			errors,
			trusted: state.trusted,
			projectConfigExists: existsSync(this.configPath("project", workspace)),
		};
	}

	get(workspace: string, target: McpTarget): McpEntry {
		const entry = this.snapshot(workspace).servers.find(
			(item) => item.name === target.name && item.scope === target.scope,
		);
		if (!entry)
			throw new Error("This MCP server is unavailable, overridden or its project is not trusted.");
		return entry;
	}

	async trust(workspace: string, trusted: boolean): Promise<void> {
		await this.mutate(async () => {
			await realpath(workspace);
			const state = this.hostState(workspace);
			await this.write(this.policyPath(workspace), {
				...state,
				trusted,
				approvals: trusted ? state.approvals : {},
			});
		});
	}

	async save(workspace: string, request: McpSaveRequest): Promise<void> {
		request = validateMcpSave(request);
		await this.mutate(async () => {
			const state = this.hostState(workspace);
			if (request.scope === "project" && !state.trusted)
				throw new Error("Trust this project before changing its MCP configuration.");
			const loaded = this.load(request.scope, workspace);
			const definitions = isRecord(loaded.value.mcpServers) ? { ...loaded.value.mcpServers } : {};
			for (const name of Object.keys(definitions)) {
				if (name !== request.name && name.replace(/-/g, "_") === request.name.replace(/-/g, "_"))
					throw new Error("This MCP server name collides with an existing entry.");
			}
			const previous = loaded.servers.find((entry) => entry.name === request.name);
			const fingerprint = this.fingerprint(request.config);
			state.approvals[`${request.scope}:${request.name}`] = {
				fingerprint,
				policy: previous && previous.fingerprint !== fingerprint ? { tools: {} } : request.policy,
			};
			await this.write(this.configPath(request.scope, workspace), {
				...loaded.value,
				mcpServers: { ...definitions, [request.name]: request.config },
			});
			await this.write(this.policyPath(workspace), state);
		});
	}

	async remove(workspace: string, target: McpTarget): Promise<void> {
		await this.mutate(async () => {
			this.get(workspace, target);
			const loaded = this.load(target.scope, workspace);
			const definitions = { ...(isRecord(loaded.value.mcpServers) ? loaded.value.mcpServers : {}) };
			delete definitions[target.name];
			await this.write(this.configPath(target.scope, workspace), {
				...loaded.value,
				mcpServers: definitions,
			});
			const state = this.hostState(workspace);
			delete state.approvals[`${target.scope}:${target.name}`];
			await this.write(this.policyPath(workspace), state);
		});
	}

	private async write(filename: string, value: unknown): Promise<void> {
		const text = `${JSON.stringify(value, null, 2)}\n`;
		if (Buffer.byteLength(text, "utf8") > 1_000_000)
			throw new Error("MCP configuration exceeds 1 MB.");
		await mkdir(path.dirname(filename), { recursive: true });
		const temporary = `${filename}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, text, {
				encoding: "utf8",
				mode: 0o600,
			});
			await rename(temporary, filename);
		} finally {
			try {
				await unlink(temporary);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}

	private mutate<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => undefined);
		return result;
	}
}
