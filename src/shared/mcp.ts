import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./value.js";

export type McpScope = "user" | "project";
export type McpExposure = "deferred" | "direct" | "hidden";
export type McpPermission = "blocked" | "read" | "write";

export interface McpPolicy {
	tools: Record<string, McpPermission>;
}

export interface McpServerInfo {
	name: string;
	scope: McpScope | "extension";
	source: string;
	transport: "stdio" | "http";
	enabled: boolean;
	exposure: McpExposure;
	state: "disabled" | "connecting" | "connected" | "disconnected" | "needs-auth" | "failed";
	error?: string;
	oauth: boolean;
	authenticated: boolean;
	connections: number;
	tools: {
		name: string;
		description: string;
		exposure: McpExposure;
		permission: McpPermission;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
	}[];
}

export interface McpOverview {
	workspacePath: string | null;
	projectTrusted: boolean;
	projectConfigExists: boolean;
	servers: McpServerInfo[];
	errors: string[];
}

export interface McpSaveRequest {
	scope: McpScope;
	name: string;
	config: McpServerConfig;
	policy: McpPolicy;
}

export interface McpTarget {
	scope: McpScope;
	name: string;
}

export interface McpActionRequest extends McpTarget {
	action: "reconnect" | "login" | "logout" | "cancel-login";
}

export interface McpResourceRequest extends McpTarget {
	action: "list" | "templates" | "read";
	cursor?: string;
	uri?: string;
}

export interface McpEvent {
	workspacePath: string;
	type: "changed" | "auth";
	name?: string;
	url?: string;
}

export function validateMcpTarget(value: unknown): McpTarget {
	if (!isRecord(value) || !["user", "project"].includes(String(value.scope))) {
		throw new Error("Choose a user or project MCP configuration.");
	}
	if (typeof value.name !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.name)) {
		throw new Error("Use letters, numbers, underscores or hyphens for the server name.");
	}
	return { scope: value.scope as McpScope, name: value.name };
}

function requireText(value: unknown, label: string, max = 4096): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > max ||
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		throw new Error(`Invalid MCP ${label}.`);
	}
	return value;
}

function stringMap(value: unknown, label: string): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || Object.keys(value).length > 100) throw new Error(`Invalid MCP ${label}.`);
	const result: Record<string, string> = Object.create(null);
	for (const [key, item] of Object.entries(value)) {
		requireText(key, label, 200);
		const text = requireText(item, label, 8192);
		if (text.startsWith("!")) {
			throw new Error(
				"MCP command-valued secrets are not supported. Use ${ENVIRONMENT_VARIABLE} instead.",
			);
		}
		result[key] = text;
	}
	return result;
}

function requireUrl(value: unknown, label: string, callback = false): string {
	const text = requireText(value, label);
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw new Error(`Invalid MCP ${label} URL.`);
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		url.username ||
		url.password ||
		url.hash ||
		(callback
			? url.protocol !== "http:" || !loopback
			: url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
	) {
		throw new Error(
			`MCP ${label} requires HTTPS, or HTTP on a loopback address without embedded credentials.`,
		);
	}
	return text;
}

export function validateMcpConfig(value: unknown): McpServerConfig {
	if (!isRecord(value)) throw new Error("MCP configuration must be an object.");
	const allowed = new Set([
		"type",
		"command",
		"args",
		"env",
		"cwd",
		"url",
		"headers",
		"oauth",
		"description",
		"enabled",
		"timeout",
		"exposure",
		"toolExposure",
	]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new Error(`Unsupported MCP field: ${key}.`);
	}
	const exposure = value.exposure ?? "deferred";
	if (!["deferred", "direct", "hidden"].includes(String(exposure))) {
		throw new Error(
			"Choose deferred, direct or hidden tool exposure. Codemode is not enabled in Rhyza.",
		);
	}
	if (value.enabled !== undefined && typeof value.enabled !== "boolean")
		throw new Error("Invalid MCP enabled state.");
	if (
		value.timeout !== undefined &&
		(typeof value.timeout !== "number" ||
			!Number.isFinite(value.timeout) ||
			value.timeout < 1 ||
			value.timeout > 600)
	) {
		throw new Error("MCP timeout must be between 1 and 600 seconds.");
	}
	const toolExposure: Record<string, McpExposure> = Object.create(null);
	if (value.toolExposure !== undefined) {
		if (!isRecord(value.toolExposure) || Object.keys(value.toolExposure).length > 500)
			throw new Error("Invalid tool exposure overrides.");
		for (const [tool, setting] of Object.entries(value.toolExposure)) {
			requireText(tool, "tool name", 200);
			if (!["deferred", "direct", "hidden"].includes(String(setting)))
				throw new Error("Invalid tool exposure.");
			toolExposure[tool] = setting as McpExposure;
		}
	}
	const base = {
		exposure: exposure as McpExposure,
		...(value.description !== undefined
			? { description: requireText(value.description, "description", 2048) }
			: {}),
		...(value.enabled !== undefined ? { enabled: value.enabled as boolean } : {}),
		...(value.timeout !== undefined ? { timeout: value.timeout as number } : {}),
		...(Object.keys(toolExposure).length ? { toolExposure } : {}),
	};
	if (value.url !== undefined) {
		if (
			value.command !== undefined ||
			value.args !== undefined ||
			value.env !== undefined ||
			value.cwd !== undefined ||
			(value.type !== undefined && !["http", "streamable-http"].includes(String(value.type)))
		) {
			throw new Error("Do not mix HTTP and stdio MCP fields.");
		}
		let oauth: Extract<McpServerConfig, { url: string }>["oauth"];
		if (value.oauth !== undefined) {
			if (!isRecord(value.oauth)) throw new Error("Invalid MCP OAuth settings.");
			const fields = new Set([
				"clientId",
				"clientSecret",
				"callbackPort",
				"callbackUrl",
				"scope",
				"clientName",
				"authServerMetadataUrl",
			]);
			for (const key of Object.keys(value.oauth)) {
				if (!fields.has(key)) throw new Error(`Unsupported OAuth field: ${key}.`);
			}
			oauth = {};
			for (const key of ["clientId", "clientSecret", "scope", "clientName"] as const) {
				if (value.oauth[key] !== undefined) {
					oauth[key] = requireText(value.oauth[key], `OAuth ${key}`);
					if (oauth[key]?.startsWith("!"))
						throw new Error("Use an environment variable for OAuth secrets.");
				}
			}
			if (value.oauth.callbackPort !== undefined) {
				const port = value.oauth.callbackPort;
				if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
					throw new Error("Invalid OAuth callback port.");
				oauth.callbackPort = port;
			}
			if (value.oauth.callbackUrl !== undefined)
				oauth.callbackUrl = requireUrl(value.oauth.callbackUrl, "callback", true);
			if (value.oauth.authServerMetadataUrl !== undefined)
				oauth.authServerMetadataUrl = requireUrl(
					value.oauth.authServerMetadataUrl,
					"OAuth metadata",
				);
		}
		return {
			...base,
			type: "http",
			url: requireUrl(value.url, "server"),
			headers: stringMap(value.headers, "headers"),
			...(oauth ? { oauth } : {}),
		};
	}
	if (
		value.headers !== undefined ||
		value.oauth !== undefined ||
		(value.type !== undefined && value.type !== "stdio")
	) {
		throw new Error("Do not mix stdio and HTTP MCP fields. Legacy SSE is not supported.");
	}
	if (
		value.args !== undefined &&
		(!Array.isArray(value.args) ||
			value.args.length > 100 ||
			value.args.some(
				(arg) => typeof arg !== "string" || arg.length > 4096 || /[\u0000-\u001f\u007f]/.test(arg),
			))
	) {
		throw new Error("MCP arguments must be an array of strings.");
	}
	return {
		...base,
		type: "stdio",
		command: requireText(value.command, "command"),
		...(value.args !== undefined ? { args: value.args as string[] } : {}),
		...(value.cwd !== undefined ? { cwd: requireText(value.cwd, "working directory") } : {}),
		env: stringMap(value.env, "environment"),
	};
}

export function validateMcpPolicy(value: unknown): McpPolicy {
	if (!isRecord(value) || !isRecord(value.tools) || Object.keys(value.tools).length > 500) {
		throw new Error("Invalid MCP tool permissions.");
	}
	const tools: Record<string, McpPermission> = Object.create(null);
	for (const [tool, permission] of Object.entries(value.tools)) {
		requireText(tool, "tool name", 200);
		if (!["blocked", "read", "write"].includes(String(permission)) || tool.includes("*")) {
			throw new Error("Permissions must name exact tools and use blocked, read or write.");
		}
		tools[tool] = permission as McpPermission;
	}
	return { tools };
}

export function validateMcpSave(value: unknown): McpSaveRequest {
	const target = validateMcpTarget(value);
	if (!isRecord(value)) throw new Error("Invalid MCP server.");
	return {
		...target,
		config: validateMcpConfig(value.config),
		policy: validateMcpPolicy(value.policy),
	};
}

export function validateMcpAction(value: unknown): McpActionRequest {
	const target = validateMcpTarget(value);
	if (
		!isRecord(value) ||
		!["reconnect", "login", "logout", "cancel-login"].includes(String(value.action))
	)
		throw new Error("Invalid MCP action.");
	return { ...target, action: value.action as McpActionRequest["action"] };
}

export function validateMcpResource(value: unknown): McpResourceRequest {
	const target = validateMcpTarget(value);
	if (!isRecord(value) || !["list", "templates", "read"].includes(String(value.action)))
		throw new Error("Invalid MCP resource action.");
	return {
		...target,
		action: value.action as McpResourceRequest["action"],
		...(value.cursor !== undefined
			? { cursor: requireText(value.cursor, "resource cursor", 8192) }
			: {}),
		...(value.action === "read" ? { uri: requireText(value.uri, "resource URI", 8192) } : {}),
	};
}

export function effectiveMcpExposure(config: McpServerConfig, tool: string): McpExposure {
	const exact = config.toolExposure?.[tool];
	if (exact) return exact === "codemode" ? "deferred" : exact;
	for (const [pattern, exposure] of Object.entries(config.toolExposure ?? {})) {
		const regex = pattern
			.split("*")
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*");
		if (new RegExp(`^${regex}$`).test(tool)) return exposure === "codemode" ? "deferred" : exposure;
	}
	return config.exposure === "direct" || config.exposure === "hidden"
		? config.exposure
		: "deferred";
}
