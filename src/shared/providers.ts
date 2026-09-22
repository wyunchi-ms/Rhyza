import { validateAzureOpenAIConfig, type AzureOpenAIConfig, type ProviderId } from "./ipc";

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	runtimeLabel: string;
	externalAuth: boolean;
	setupInstructions?: string;
}

export const providers: readonly ProviderInfo[] = [
	{
		id: "github-copilot",
		label: "GitHub Copilot",
		runtimeLabel: "Pi SDK / GitHub Copilot",
		externalAuth: false,
	},
	{
		id: "codex",
		label: "Codex",
		runtimeLabel: "ChatGPT desktop / Codex",
		externalAuth: false,
	},
	{
		id: "azure-openai",
		label: "Azure OpenAI",
		runtimeLabel: "Azure OpenAI / Azure CLI",
		externalAuth: true,
		setupInstructions:
			"Install Azure CLI and run az login in a terminal with an account that can use your Azure OpenAI resource. Save the resource details below, then check sign-in. Deployment access is checked on your first request.",
	},
	{
		id: "claude-code",
		label: "Claude Code",
		runtimeLabel: "Claude Code",
		externalAuth: true,
		setupInstructions:
			"Install Claude Code and sign in with claude auth login in a terminal, then check the connection. Rhyza uses your local CLI credentials.",
	},
];

function knownProviderId(value: unknown): ProviderId | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return providers.find(
		(provider) => provider.id === normalized || provider.label.toLowerCase() === normalized,
	)?.id;
}

export function normalizeProviderId(value: unknown): ProviderId {
	return knownProviderId(value) ?? "github-copilot";
}

export function getProviderInfo(value: unknown): ProviderInfo {
	return providers.find((provider) => provider.id === normalizeProviderId(value))!;
}

export type AzureOpenAISettingsInput = {
	endpoint: string;
	deployment: string;
	subscriptionId: string;
	contextWindow: string;
	maxTokens: string;
};

export const azureOpenAIDefaultBudgets = { contextWindow: 32_768, maxTokens: 4_096 };

export function parseAzureOpenAISettings(input: AzureOpenAISettingsInput): AzureOpenAIConfig {
	return validateAzureOpenAIConfig({
		...input,
		contextWindow: Number(input.contextWindow),
		maxTokens: Number(input.maxTokens),
	});
}

type ProviderSettingsInput = { provider?: unknown; defaultModel?: unknown };
export type ProviderSettings = { provider: ProviderId; defaultModel: string };

export function normalizeProviderSettings(settings: ProviderSettingsInput): ProviderSettings {
	const provider = normalizeProviderId(settings.provider);
	const unsupportedProvider =
		settings.provider != null && settings.provider !== "" && !knownProviderId(settings.provider);
	return {
		provider,
		defaultModel:
			!unsupportedProvider && typeof settings.defaultModel === "string"
				? settings.defaultModel.trim()
				: "",
	};
}

export function updateProviderSettings(
	current: ProviderSettingsInput,
	patch: ProviderSettingsInput,
): ProviderSettings {
	const previous = normalizeProviderSettings(current);
	const next = normalizeProviderSettings({ ...previous, ...patch });
	return { ...next, defaultModel: next.provider === previous.provider ? next.defaultModel : "" };
}

export function providerModelSelection(settings: ProviderSettingsInput): {
	providerId: ProviderId;
	modelId: string;
} {
	const { provider, defaultModel } = normalizeProviderSettings(settings);
	// An empty model ID still routes the request to the selected provider.
	return { providerId: provider, modelId: defaultModel };
}
