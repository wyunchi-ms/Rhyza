import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type {
	AuthBridgeEvent,
	KnowbranchBridge,
	ModelCatalogResponse,
	ProviderActionResponse,
	ProviderId,
	ProviderStatusResponse,
} from "../src/shared/ipc.js";
import {
	getProviderInfo,
	normalizeProviderId,
	normalizeProviderSettings,
	providerModelSelection,
	providers,
	updateProviderSettings,
} from "../src/shared/providers.js";
import { loadWorkspaceState, useAppStore } from "../src/store/index.js";
import {
	createProviderConnection,
	type ProviderConnectionState,
} from "../src/utils/providerConnection.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function mockBridge() {
	const calls: string[] = [];
	const listeners = new Set<(event: AuthBridgeEvent) => void>();
	const status = (providerId: ProviderId): ProviderStatusResponse => ({
		providerId,
		configured: true,
		externalAuth: getProviderInfo(providerId).externalAuth,
	});
	const bridge: Pick<
		KnowbranchBridge,
		"providerStatus" | "providerLogin" | "providerLogout" | "modelCatalog" | "onAuthEvent"
	> = {
		providerStatus: async ({ providerId }) => {
			calls.push(`status:${providerId}`);
			return status(providerId);
		},
		modelCatalog: async (request) => {
			calls.push(`models:${request?.providerId}:${request?.refresh}`);
			return { models: [], configured: true };
		},
		providerLogin: async ({ providerId }) => {
			calls.push(`login:${providerId}`);
			return { ok: true, status: status(providerId) };
		},
		providerLogout: async ({ providerId }) => {
			calls.push(`logout:${providerId}`);
			return { ok: true, status: { ...status(providerId), configured: false } };
		},
		onAuthEvent: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		bridge,
		calls,
		listeners,
		emitAuth: (event: AuthBridgeEvent) => listeners.forEach((listener) => listener(event)),
	};
}

test("provider metadata uses canonical IDs and migrates legacy labels safely", () => {
	assert.deepEqual(
		providers.map(({ id, label }) => [id, label]),
		[
			["github-copilot", "GitHub Copilot"],
			["codex", "Codex"],
			["claude-code", "Claude Code"],
		],
	);
	assert.equal(normalizeProviderId(" GitHub Copilot "), "github-copilot");
	assert.equal(normalizeProviderId("Claude Code"), "claude-code");
	assert.deepEqual(
		normalizeProviderSettings({ provider: "GitHub Copilot", defaultModel: "gpt-4o" }),
		{
			provider: "github-copilot",
			defaultModel: "gpt-4o",
		},
	);
	assert.deepEqual(normalizeProviderSettings({ defaultModel: "legacy-model" }), {
		provider: "github-copilot",
		defaultModel: "legacy-model",
	});
	assert.deepEqual(
		normalizeProviderSettings({ provider: "removed-provider", defaultModel: "foreign-model" }),
		{
			provider: "github-copilot",
			defaultModel: "",
		},
	);
	assert.deepEqual(normalizeProviderSettings({ provider: null, defaultModel: 42 }), {
		provider: "github-copilot",
		defaultModel: "",
	});
});

test("provider switches clear models, while same-provider updates preserve custom aliases", () => {
	assert.deepEqual(
		updateProviderSettings(
			{ provider: "GitHub Copilot", defaultModel: "gpt-4o" },
			{ provider: "github-copilot" },
		),
		{ provider: "github-copilot", defaultModel: "gpt-4o" },
	);
	for (const provider of providers) {
		const nextProvider = provider.id === "codex" ? "claude-code" : "codex";
		assert.deepEqual(
			updateProviderSettings(
				{ provider: provider.id, defaultModel: "previous-model" },
				{ provider: nextProvider, defaultModel: "do-not-carry-across-providers" },
			),
			{ provider: nextProvider, defaultModel: "" },
		);
		assert.deepEqual(
			updateProviderSettings(
				{ provider: provider.id, defaultModel: "" },
				{ defaultModel: " sonnet " },
			),
			{ provider: provider.id, defaultModel: "sonnet" },
		);
	}
});

test("every provider sends an explicit model selection even when using its default", () => {
	for (const { id } of providers) {
		assert.deepEqual(providerModelSelection({ provider: id, defaultModel: "" }), {
			providerId: id,
			modelId: "",
		});
		assert.deepEqual(providerModelSelection({ provider: id, defaultModel: " custom-alias " }), {
			providerId: id,
			modelId: "custom-alias",
		});
	}
	assert.deepEqual(providerModelSelection({ provider: "GitHub Copilot" }), {
		providerId: "github-copilot",
		modelId: "",
	});
});

test("workspace loading and hydration migrate and persist canonical provider settings", async () => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalState = useAppStore.getState();
	let saved: string | null = null;
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: () => saved,
				setItem: (_name: string, value: string) => {
					saved = value;
				},
				removeItem: () => {
					saved = null;
				},
			},
		},
	});
	try {
		loadWorkspaceState(
			JSON.stringify({
				state: { settings: { provider: "GitHub Copilot", defaultModel: "gpt-4o" } },
			}),
		);
		assert.equal(useAppStore.getState().settings.provider, "github-copilot");
		assert.equal(useAppStore.getState().settings.defaultModel, "gpt-4o");
		useAppStore.getState().updateSettings({ provider: "codex" });
		assert.equal(useAppStore.getState().settings.defaultModel, "");
		useAppStore.getState().updateSettings({ defaultModel: "gpt-custom" });
		assert.equal(JSON.parse(saved!).state.settings.provider, "codex");
		assert.equal(JSON.parse(saved!).state.settings.defaultModel, "gpt-custom");
		loadWorkspaceState(saved);
		assert.equal(useAppStore.getState().settings.provider, "codex");
		assert.equal(useAppStore.getState().settings.defaultModel, "gpt-custom");
		useAppStore.getState().updateSettings({ provider: "claude-code" });
		assert.equal(useAppStore.getState().settings.defaultModel, "");
		saved = JSON.stringify({
			version: 2,
			state: { settings: { provider: "GitHub Copilot", defaultModel: "legacy-model" } },
		});
		await useAppStore.persist.rehydrate();
		assert.equal(useAppStore.getState().settings.provider, "github-copilot");
		assert.equal(useAppStore.getState().settings.defaultModel, "legacy-model");
		useAppStore.getState().updateSettings({ theme: "dark" });
		assert.equal(JSON.parse(saved).state.settings.provider, "github-copilot");
		assert.equal(useAppStore.getState().settings.defaultModel, "legacy-model");
	} finally {
		useAppStore.setState(originalState, true);
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});

test("external providers refresh local status with empty catalogs and never invoke login or logout", async () => {
	for (const providerId of ["codex", "claude-code"] as const) {
		const { bridge, calls, listeners, emitAuth } = mockBridge();
		const states: ProviderConnectionState[] = [];
		const connection = createProviderConnection(bridge, providerId, (state) => states.push(state));
		assert.match(
			getProviderInfo(providerId).setupInstructions ?? "",
			providerId === "codex" ? /codex login/ : /claude auth login/,
		);
		try {
			await connection.refresh();
			assert.deepEqual(calls, [`status:${providerId}`, `models:${providerId}:true`]);
			assert.equal(states.at(-1)?.providerStatus?.configured, true);
			assert.deepEqual(states.at(-1)?.models, []);
			assert.equal(states.at(-1)?.error, null);
			assert.equal(states.at(-1)?.loading, false);
			assert.equal(listeners.size, 0);
			emitAuth({ type: "progress", message: "Unrelated Copilot login" });
			assert.deepEqual(states.at(-1)?.authEvents, []);
			await connection.login();
			await connection.logout();
			assert.equal(calls.length, 2);
			assert.match(states.at(-1)?.error ?? "", /local CLI/);
		} finally {
			connection.dispose();
		}
	}
});

test("Copilot auth actions are serialized and late events/results cannot cross a provider switch", async () => {
	const { bridge, calls, emitAuth, listeners } = mockBridge();
	const login = deferred<ProviderActionResponse>();
	bridge.providerLogin = ({ providerId }) => {
		calls.push(`login:${providerId}`);
		return login.promise;
	};
	const states: ProviderConnectionState[] = [];
	const connection = createProviderConnection(bridge, "github-copilot", (state) =>
		states.push(state),
	);
	emitAuth({ type: "progress", message: "Not part of this login" });
	assert.equal(states.length, 0);
	const pending = connection.login();
	assert.equal(states.at(-1)?.loading, true);
	assert.equal(states.at(-1)?.action, "login");
	emitAuth({
		type: "device_code",
		userCode: "TEST",
		verificationUri: "https://github.com/login/device",
	});
	assert.equal(states.at(-1)?.authEvents.length, 1);
	await Promise.all([connection.login(), connection.logout(), connection.refresh()]);
	assert.deepEqual(calls, ["login:github-copilot"]);
	connection.dispose();
	assert.equal(listeners.size, 0);
	const oldStateCount = states.length;
	const nextStates: ProviderConnectionState[] = [];
	const next = createProviderConnection(bridge, "claude-code", (state) => nextStates.push(state));
	try {
		await next.refresh();
		emitAuth({ type: "progress", message: "Old Copilot login finishing" });
		login.resolve({ ok: true, status: { providerId: "github-copilot", configured: true } });
		await pending;
		assert.equal(states.length, oldStateCount);
		assert.equal(nextStates.at(-1)?.providerStatus?.providerId, "claude-code");
		assert.deepEqual(nextStates.at(-1)?.authEvents, []);
		assert.ok(!calls.includes("models:github-copilot:true"));
	} finally {
		next.dispose();
	}
});

test("stale status and catalog responses are discarded on provider changes", async () => {
	const { bridge } = mockBridge();
	const status = deferred<ProviderStatusResponse>();
	const catalog = deferred<ModelCatalogResponse>();
	bridge.providerStatus = () => status.promise;
	bridge.modelCatalog = () => catalog.promise;
	const states: ProviderConnectionState[] = [];
	const connection = createProviderConnection(bridge, "codex", (state) => states.push(state));
	const pending = connection.refresh(false);
	assert.equal(states.length, 1);
	connection.dispose();
	status.resolve({ providerId: "codex", configured: true });
	catalog.resolve({ models: [], configured: true });
	await pending;
	assert.equal(states.length, 1);
});

test("Copilot sign-in refreshes models, sign-out clears them, and failed actions show errors", async () => {
	const { bridge, calls } = mockBridge();
	const states: ProviderConnectionState[] = [];
	const connection = createProviderConnection(bridge, "github-copilot", (state) =>
		states.push(state),
	);
	try {
		await connection.login();
		assert.deepEqual(calls, ["login:github-copilot", "models:github-copilot:true"]);
		assert.equal(states.at(-1)?.error, null);
		await connection.logout();
		assert.equal(states.at(-1)?.providerStatus?.configured, false);
		assert.deepEqual(states.at(-1)?.models, []);
		bridge.providerLogin = async () => {
			throw new Error("Sign-in transport failed");
		};
		await connection.login();
		assert.equal(states.at(-1)?.error, "Sign-in transport failed");
		assert.equal(states.at(-1)?.loading, false);
		bridge.providerLogout = async () => ({
			ok: false,
			status: { providerId: "github-copilot", configured: true },
		});
		await connection.logout();
		assert.equal(states.at(-1)?.error, "GitHub Copilot sign-out failed.");
		assert.equal(states.at(-1)?.loading, false);
	} finally {
		connection.dispose();
	}
});

test("catalog failures retain provider setup instructions and allow a later refresh", async () => {
	const { bridge } = mockBridge();
	bridge.providerStatus = async () => ({
		providerId: "codex",
		configured: false,
		externalAuth: true,
		setupInstructions: "Install the local CLI and log in.",
	});
	bridge.modelCatalog = async () => {
		throw new Error("Catalog unavailable");
	};
	const states: ProviderConnectionState[] = [];
	const connection = createProviderConnection(bridge, "codex", (state) => states.push(state));
	try {
		await connection.refresh();
		assert.equal(
			states.at(-1)?.providerStatus?.setupInstructions,
			"Install the local CLI and log in.",
		);
		assert.equal(states.at(-1)?.error, "Catalog unavailable");
		assert.equal(states.at(-1)?.loading, false);
		bridge.modelCatalog = async () => ({ configured: true, models: [] });
		await connection.refresh();
		assert.equal(states.at(-1)?.error, null);
	} finally {
		connection.dispose();
	}
});

test("all renderer prompt, title, and extraction call sites use explicit provider model selection", () => {
	let calls = 0;
	for (const relativePath of [
		path.join("components", "ChatPane.tsx"),
		path.join("components", "SessionTree.tsx"),
		path.join("pages", "Knowledge.tsx"),
	]) {
		const filename = path.join(process.cwd(), "src", relativePath);
		const source = readFileSync(filename, "utf8");
		const selections = new Set(
			[...source.matchAll(/const\s+(\w+)\s*=\s*providerModelSelection\(/g)].map(
				(match) => match[1],
			),
		);
		for (const request of source.matchAll(
			/bridge\.(agentPrompt|generateSummary|extractKnowledge)\(\{([\s\S]*?)\}\)/g,
		)) {
			calls++;
			const selection =
				/\bmodel:\s*(\w+)\b/.exec(request[2])?.[1] ??
				(/(?:^|,)\s*model\s*(?:,|$)/.test(request[2]) ? "model" : "");
			assert.ok(
				selections.has(selection),
				`${relativePath}: ${request[1]} must always use providerModelSelection`,
			);
		}
	}
	assert.equal(calls, 7);
});
