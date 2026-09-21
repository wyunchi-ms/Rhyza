import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import type { AzureOpenAIConfig } from "../shared/ipc";
import {
	azureOpenAIDefaultBudgets,
	parseAzureOpenAISettings,
	type AzureOpenAISettingsInput,
} from "../shared/providers";
import { errorToMessage } from "../shared/value";
import { useAppStore } from "../store";

function selectDeployment(config: AzureOpenAIConfig | null) {
	const { settings, updateSettings } = useAppStore.getState();
	if (settings.provider === "azure-openai") {
		updateSettings({ defaultModel: config?.deployment ?? "" });
	}
}

export function AzureOpenAISettings({
	onSaved,
	connectionBusy,
}: {
	onSaved: () => Promise<void> | undefined;
	connectionBusy: boolean;
}) {
	const bridge = getRhyzaBridge();
	const selectedModel = useAppStore((state) => state.settings.defaultModel);
	const available =
		bridge?.isElectron === true &&
		typeof bridge.azureOpenAIConfigGet === "function" &&
		typeof bridge.azureOpenAIConfigSet === "function";
	const [draft, setDraft] = useState<AzureOpenAISettingsInput>({
		endpoint: "",
		deployment: "",
		subscriptionId: "",
		contextWindow: String(azureOpenAIDefaultBudgets.contextWindow),
		maxTokens: String(azureOpenAIDefaultBudgets.maxTokens),
	});
	const [deployment, setDeployment] = useState("");
	const [loading, setLoading] = useState(available);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [readError, setReadError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [readAttempt, setReadAttempt] = useState(0);
	const mounted = useRef(false);
	const savePending = useRef(false);
	const edited = useRef(false);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (!available || !bridge) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		void bridge.azureOpenAIConfigGet().then(
			(config) => {
				if (cancelled) return;
				if (config && !edited.current) {
					setDraft({
						...config,
						contextWindow: String(config.contextWindow),
						maxTokens: String(config.maxTokens),
					});
				}
				setDeployment(config?.deployment ?? "");
				selectDeployment(config);
				setLoaded(true);
				setReadError(null);
				setLoading(false);
			},
			(reason: unknown) => {
				if (cancelled) return;
				setReadError(errorToMessage(reason));
				setLoading(false);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [available, bridge, readAttempt]);

	useEffect(() => {
		if (loaded && selectedModel !== deployment) {
			const { settings, updateSettings } = useAppStore.getState();
			if (settings.provider === "azure-openai") updateSettings({ defaultModel: deployment });
		}
	}, [loaded, selectedModel, deployment]);

	const updateDraft = (key: keyof AzureOpenAISettingsInput, value: string) => {
		edited.current = true;
		setDraft((current) => ({ ...current, [key]: value }));
		setSaved(false);
		setError(null);
	};

	const save = async () => {
		if (!available || !bridge || loading || connectionBusy || savePending.current) return;
		setError(null);
		setSaved(false);
		let config: AzureOpenAIConfig;
		try {
			config = parseAzureOpenAISettings(draft);
		} catch (reason) {
			setError(errorToMessage(reason));
			return;
		}
		savePending.current = true;
		setSaving(true);
		try {
			const result = await bridge.azureOpenAIConfigSet(config);
			if (!mounted.current) return;
			setDraft({
				...result,
				contextWindow: String(result.contextWindow),
				maxTokens: String(result.maxTokens),
			});
			edited.current = false;
			setLoaded(true);
			setReadError(null);
			setDeployment(result.deployment);
			selectDeployment(result);
			setSaved(true);
			await onSaved();
		} catch (reason) {
			if (mounted.current) setError(errorToMessage(reason));
		} finally {
			savePending.current = false;
			if (mounted.current) setSaving(false);
		}
	};

	const disabled = !available || loading || saving;
	return (
		<div aria-label="Azure OpenAI configuration" aria-busy={loading || saving}>
			{!available && (
				<p className="settings-help settings-inset">
					Azure OpenAI setup requires the Electron desktop app.
				</p>
			)}
			{(
				[
					[
						"endpoint",
						"Azure endpoint",
						"https://your-resource.openai.azure.com",
						"Use the public Azure resource address, optionally ending in /openai/v1/.",
					],
					[
						"deployment",
						"Deployment name",
						"your-deployment",
						"Choose an Azure OpenAI v1 Responses-compatible deployment.",
					],
					[
						"subscriptionId",
						"Subscription ID",
						"your-subscription-id",
						"Use the subscription that contains your Azure resource.",
					],
				] as const
			).map(([key, label, placeholder, help]) => (
				<div key={key} className="settings-row settings-row--field">
					<div className="settings-row-copy">
						<label htmlFor={`azure-${key}`} className="settings-label">
							{label}
						</label>
						<p id={`azure-${key}-help`} className="settings-help">
							{help}
						</p>
					</div>
					<input
						id={`azure-${key}`}
						type="text"
						required
						value={draft[key]}
						onChange={(event) => updateDraft(key, event.target.value)}
						placeholder={placeholder}
						aria-describedby={`azure-${key}-help`}
						disabled={disabled}
						className="field settings-input"
					/>
				</div>
			))}
			<details className="settings-inset">
				<summary>Advanced</summary>
				<p className="settings-help">
					Local operating limits, not detected model capabilities. Keep these within your
					deployment’s supported limits.
				</p>
				{(
					[
						["contextWindow", "Context budget", 1_024, 2_000_000],
						["maxTokens", "Response token limit", 16, 200_000],
					] as const
				).map(([key, label, min, max]) => (
					<div key={key} className="settings-row settings-row--field">
						<label htmlFor={`azure-${key}`} className="settings-label">
							{label}
						</label>
						<input
							id={`azure-${key}`}
							type="number"
							min={min}
							max={max}
							step={1}
							required
							value={draft[key]}
							onChange={(event) => updateDraft(key, event.target.value)}
							disabled={disabled}
							className="field settings-input"
						/>
					</div>
				))}
			</details>
			<div className="settings-row">
				<div className="settings-row-copy">
					<p className="settings-help" role="status">
						{loading
							? "Loading configuration…"
							: saved
								? "Configuration saved. Deployment access is checked on your first request."
								: "Changes take effect after saving."}
					</p>
					{readError && (
						<p role="alert" className="settings-error">
							Could not load configuration. Enter the resource details to replace it, or retry
							loading. {readError}
						</p>
					)}
					{error && (
						<p role="alert" className="settings-error">
							{error}
						</p>
					)}
				</div>
				<div className="settings-actions">
					{available && !loaded && !loading && (
						<button
							type="button"
							className="secondary-button"
							disabled={saving}
							onClick={() => setReadAttempt((attempt) => attempt + 1)}
						>
							Retry loading
						</button>
					)}
					<button
						type="button"
						className="secondary-button"
						disabled={disabled || connectionBusy}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save configuration"}
					</button>
				</div>
			</div>
			<div className="settings-row settings-row--field">
				<div className="settings-row-copy">
					<h3>Default model</h3>
					<p className="settings-help">
						Your saved deployment is used for chat, titles, and knowledge extraction.
					</p>
				</div>
				<span className="settings-status">{deployment || "Save a deployment first"}</span>
			</div>
			<p className="settings-help settings-inset">
				Text and tools only; image input and reasoning controls are not supported. Azure usage is
				billed separately from Copilot. Your account needs the Cognitive Services OpenAI User role
				or equivalent access. Rhyza never stores your Azure credentials.
			</p>
		</div>
	);
}
