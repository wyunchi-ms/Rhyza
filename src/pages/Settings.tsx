import type { PiPluginInfo } from "../shared/ipc";
import { AzureOpenAISettings } from "../components/AzureOpenAISettings";
import clsx from "clsx";
import {
	Accessibility,
	Brain,
	Cloud,
	Copy,
	ExternalLink,
	LoaderCircle,
	Moon,
	Package,
	Palette,
	Settings2,
	ShieldAlert,
	Sun,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { getRhyzaBridge, useElectronProviderState } from "../hooks/useRhyzaBridge";
import { loadWorkspaceState, setWorkspacePersistencePath, useAppStore } from "../store";
import type { AuthBridgeEvent } from "../shared/ipc";
import { errorToMessage } from "../shared/value";
import { getProviderInfo, normalizeProviderId, providers } from "../shared/providers";
import { useTranslation } from "../i18n";
import { isLanguage, languageOptions } from "../i18n/language";

const Settings: React.FC = () => {
	const { settings, updateSettings } = useAppStore();
	const { t } = useTranslation();
	const provider = getProviderInfo(settings.provider);
	const electron = useElectronProviderState(provider.id);
	const externalAuth = provider.externalAuth || electron.providerStatus?.externalAuth === true;
	const setupInstructions =
		electron.providerStatus?.setupInstructions ?? provider.setupInstructions;
	const selectedModel = settings.defaultModel;
	const customModel = selectedModel && !electron.models.some((model) => model.id === selectedModel);

	const handleSelectWorkspace = async () => {
		const bridge = getRhyzaBridge();
		if (!bridge) return;
		electron.setWorkspaceError(null);
		try {
			const workspace = await bridge.selectWorkspace();
			setWorkspacePersistencePath(workspace.path);
			electron.setWorkspace(workspace);
			loadWorkspaceState(bridge.appStateLoad());
		} catch (error) {
			electron.setWorkspaceError(errorToMessage(error));
		}
	};

	return (
		<div className="settings-page page-scroll">
			<div className="page-header">
				<h1 className="page-title">{t("Settings")}</h1>
				<p className="page-subtitle">
					{t("Configure providers, models, and workspace preferences.")}
				</p>
			</div>

			<div className="settings-sections">
				<section className="settings-section" aria-labelledby="language-heading">
					<header className="settings-section-header">
						<h2 id="language-heading">{t("Language")}</h2>
						<p>{t("Choose the language used throughout Rhyza.")}</p>
					</header>
					<div className="settings-panel">
						<div className="settings-row settings-row--field">
							<label htmlFor="language-select" className="settings-label">
								{t("Language")}
							</label>
							<select
								id="language-select"
								className="field settings-input"
								value={settings.language}
								onChange={(event) => {
									const language = event.target.value;
									if (isLanguage(language)) updateSettings({ language });
								}}
							>
								{languageOptions.map((option) => (
									<option key={option.code} value={option.code}>
										{option.label}
									</option>
								))}
							</select>
						</div>
					</div>
				</section>
				<section className="settings-section" aria-labelledby="plugins-heading">
					<header className="settings-section-header">
						<h2 id="plugins-heading">
							<Package size={17} aria-hidden="true" /> {t("Pi plugins")}
						</h2>
						<p>{t("These plugins are supported only with GitHub Copilot through Pi.")}</p>
					</header>
					<PluginSettings />
				</section>

				<section className="settings-section" aria-labelledby="appearance-heading">
					<header className="settings-section-header">
						<h2 id="appearance-heading">
							<Palette size={17} aria-hidden="true" /> {t("Appearance")}
						</h2>
						<p>{t("Choose a comfortable environment for your workspace.")}</p>
					</header>
					<fieldset className="settings-panel theme-settings">
						<legend className="sr-only">{t("App theme")}</legend>
						<div className="theme-options">
							<label className={clsx(settings.theme === "light" && "is-selected")}>
								<input
									type="radio"
									name="app-theme"
									value="light"
									checked={settings.theme === "light"}
									onChange={() => updateSettings({ theme: "light" })}
								/>
								<Sun size={18} aria-hidden="true" />
								<span>
									<strong>{t("Light")}</strong>
									<small>{t("Bright surfaces and dark text")}</small>
								</span>
							</label>
							<label className={clsx(settings.theme === "dark" && "is-selected")}>
								<input
									type="radio"
									name="app-theme"
									value="dark"
									checked={settings.theme === "dark"}
									onChange={() => updateSettings({ theme: "dark" })}
								/>
								<Moon size={18} aria-hidden="true" />
								<span>
									<strong>{t("Dark")}</strong>
									<small>{t("Dim surfaces for low-light use")}</small>
								</span>
							</label>
						</div>
						<p className="settings-help settings-theme-note">
							{t("Interactive diagrams follow the app theme automatically.")}
						</p>
					</fieldset>
				</section>

				<section className="settings-section" aria-labelledby="provider-heading">
					<header className="settings-section-header">
						<h2 id="provider-heading">
							<Cloud size={17} aria-hidden="true" /> {t("AI provider")}
						</h2>
						<p>{t("Manage your connection and the model used for new requests.")}</p>
					</header>
					<div className="settings-panel">
						<div className="settings-row settings-row--field">
							<div className="settings-row-copy">
								<label htmlFor="provider-select" className="settings-label">
									{t("Provider")}
								</label>
								<p id="provider-help" className="settings-help">
									Used for new messages, titles, and knowledge extraction. Changing provider resets
									the model to its default.
								</p>
							</div>
							<select
								id="provider-select"
								value={provider.id}
								onChange={(event) =>
									updateSettings({ provider: normalizeProviderId(event.target.value) })
								}
								aria-describedby="provider-help"
								className="field settings-input"
							>
								{providers.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</div>
						<div className="settings-row settings-provider-connection" aria-busy={electron.loading}>
							<div className="settings-row-copy">
								<h3>{provider.label}</h3>
								<p className="settings-help" role="status">
									{electron.isElectron
										? electron.loading
											? "Checking connection…"
											: electron.providerStatus?.configured
												? provider.id === "azure-openai"
													? "Azure CLI sign-in is ready. Deployment access is checked on your first request."
													: (electron.providerStatus.label ??
														`Connected via ${electron.providerStatus.source ?? provider.runtimeLabel}.`)
												: externalAuth
													? provider.id === "azure-openai"
														? "Save your resource details and sign in with Azure CLI, then check sign-in."
														: "Local CLI sign-in is required. Follow the setup instructions below."
													: "Not signed in. OAuth/device flow progress appears below."
										: "Provider controls require the Electron desktop runtime."}
								</p>
								{electron.error && (
									<p role="alert" className="settings-error">
										{electron.error}
									</p>
								)}
							</div>
							<div className="settings-actions">
								{!externalAuth && (
									<button
										type="button"
										onClick={() =>
											void (electron.providerStatus?.configured
												? electron.logout()
												: electron.login())
										}
										disabled={!electron.isElectron || electron.loading}
										className="secondary-button"
									>
										{electron.action === "login"
											? "Signing In…"
											: electron.action === "logout"
												? "Signing Out…"
												: electron.providerStatus?.configured
													? "Sign Out"
													: "Sign In"}
									</button>
								)}
								<button
									type="button"
									onClick={() => void electron.refresh()}
									disabled={!electron.isElectron || electron.loading}
									className="secondary-button"
								>
									{electron.loading && (
										<LoaderCircle size={14} className="pi-plugin-spinner" aria-hidden="true" />
									)}
									{electron.action === "refresh"
										? "Checking…"
										: electron.providerStatus?.configured
											? "Refresh status"
											: provider.id === "azure-openai"
												? "Check sign-in"
												: "Check connection"}
								</button>
							</div>
						</div>

						{setupInstructions && (
							<div className="settings-inset settings-setup-instructions">
								<p>{setupInstructions}</p>
								{externalAuth && (
									<p>Sign-in and sign-out are managed by the local CLI, not Rhyza.</p>
								)}
							</div>
						)}

						{!externalAuth && electron.authEvents.length > 0 && (
							<div role="status" className="settings-inset settings-auth-events">
								{electron.authEvents.map((event, index) => (
									<AuthEventItem key={`${event.type}-${index}`} event={event} />
								))}
							</div>
						)}

						{provider.id === "azure-openai" ? (
							<AzureOpenAISettings onSaved={electron.refresh} connectionBusy={electron.loading} />
						) : (
							<div className="settings-row settings-row--field">
								<div className="settings-row-copy">
									<label htmlFor="model-select" className="settings-label">
										{t("Default model")}
									</label>
									<p id="model-help" className="settings-help">
										{t("Use the provider default or choose an available model.")}
									</p>
								</div>
								<select
									id="model-select"
									value={selectedModel}
									onChange={(e) => updateSettings({ defaultModel: e.target.value })}
									aria-describedby="model-help"
									className="field settings-input"
								>
									<option value="">{t("Use provider default")}</option>
									{customModel && <option value={selectedModel}>{selectedModel} (custom)</option>}
									{electron.models.map((model) => (
										<option key={model.id} value={model.id}>
											{model.name}
										</option>
									))}
								</select>
							</div>
						)}
						{provider.id === "claude-code" && (
							<div className="settings-row settings-row--field">
								<div className="settings-row-copy">
									<label htmlFor="custom-model-id" className="settings-label">
										Custom model ID or CLI alias
									</label>
									<p id="custom-model-help" className="settings-help">
										{provider.label} may not publish a model catalog. The provider default works
										without one; you can also enter a supported SDK/CLI model ID or alias.
									</p>
								</div>
								<input
									id="custom-model-id"
									type="text"
									value={selectedModel}
									onChange={(event) => updateSettings({ defaultModel: event.target.value })}
									placeholder={t("Leave blank for provider default")}
									aria-describedby="custom-model-help"
									className="field settings-input"
								/>
							</div>
						)}
					</div>
				</section>

				<section className="settings-section" aria-labelledby="workspace-heading">
					<header className="settings-section-header">
						<h2 id="workspace-heading">
							<Settings2 size={17} aria-hidden="true" /> {t("Workspace")}
						</h2>
						<p>{t("Set the working folder and how sessions use it.")}</p>
					</header>
					<div className="settings-panel">
						<div className="settings-row settings-workspace-folder">
							<div className="settings-row-copy">
								<h3>{t("Workspace folder")}</h3>
								<p className="settings-help settings-workspace-path">
									{electron.isElectron
										? (electron.workspace.path ?? t("No workspace selected."))
										: t("Workspace selection requires the Electron desktop runtime.")}
								</p>
								{electron.workspaceError && (
									<p role="alert" className="settings-error">
										{electron.workspaceError}
									</p>
								)}
							</div>
							<button
								type="button"
								onClick={handleSelectWorkspace}
								disabled={!electron.isElectron}
								className="secondary-button"
							>
								{t("Choose Folder")}
							</button>
						</div>

						<div className="settings-row">
							<div className="settings-row-copy">
								<h3 id="auto-extract-label">{t("Auto-extract knowledge")}</h3>
								<p id="auto-extract-help" className="settings-help">
									{t("Automatically propose ChangeSets after turns.")}
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={settings.autoExtract}
								aria-labelledby="auto-extract-label"
								aria-describedby="auto-extract-help"
								onClick={() => updateSettings({ autoExtract: !settings.autoExtract })}
								className="settings-switch"
							>
								<span className="settings-switch-track" aria-hidden="true" />
							</button>
						</div>

						<div className="settings-row">
							<div className="settings-row-copy">
								<h3>{t("Worktree isolation")}</h3>
								<p className="settings-help">
									{t("Run writable sessions in separate Git worktrees.")}
								</p>
							</div>
							<span className="settings-status">{t("Required for Git")}</span>
						</div>
					</div>
				</section>

				<section className="settings-section" aria-labelledby="knowledge-heading">
					<header className="settings-section-header">
						<h2 id="knowledge-heading">
							<Brain size={17} aria-hidden="true" /> {t("Knowledge policy")}
						</h2>
						<p>{t("Control knowledge updates and request behavior.")}</p>
					</header>
					<div className="settings-panel">
						<div className="settings-row settings-row--field">
							<label htmlFor="knowledge-mode" className="settings-label">
								{t("Write mode")}
							</label>
							<select
								id="knowledge-mode"
								className="field settings-input"
								value={settings.knowledgeMode}
								onChange={(event) =>
									updateSettings({
										knowledgeMode: event.target.value as typeof settings.knowledgeMode,
									})
								}
							>
								<option value="suggest">{t("Suggest changes")}</option>
								<option value="automatic">{t("Automatic")}</option>
								<option value="hybrid">{t("Hybrid")}</option>
								<option value="read_only">{t("Read only")}</option>
							</select>
						</div>
						<div className="settings-row">
							<div className="settings-row-copy">
								<h3 id="knowledge-tools-label">{t("Knowledge tools in chat")}</h3>
								<p id="knowledge-tools-help" className="settings-help">
									{t(
										"Let the main agent query the knowledge base when needed. The end-of-turn organizer always has access.",
									)}
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={settings.knowledgeTools}
								aria-labelledby="knowledge-tools-label"
								aria-describedby="knowledge-tools-help"
								onClick={() => updateSettings({ knowledgeTools: !settings.knowledgeTools })}
								className="settings-switch"
							>
								<span className="settings-switch-track" aria-hidden="true" />
							</button>
						</div>
						<div className="settings-row settings-row--field">
							<label htmlFor="thinking-level" className="settings-label">
								{t("Thinking level")}
							</label>
							<select
								id="thinking-level"
								className="field settings-input"
								value={settings.thinkingLevel}
								onChange={(event) =>
									updateSettings({
										thinkingLevel: event.target.value as typeof settings.thinkingLevel,
									})
								}
							>
								<option value="off">{t("Off")}</option>
								<option value="low">{t("Low")}</option>
								<option value="medium">{t("Medium")}</option>
								<option value="high">{t("High")}</option>
							</select>
						</div>
						<div className="settings-row settings-row--field">
							<div className="settings-row-copy">
								<label htmlFor="concurrent-questions" className="settings-label">
									{t("Concurrent questions (1–10)")}
								</label>
								<p id="concurrent-questions-help" className="settings-help">
									{t("Default: 5. Requests in the same conversation stay ordered.")}
								</p>
							</div>
							<input
								id="concurrent-questions"
								className="field settings-input settings-input--number"
								type="number"
								min="1"
								max="10"
								aria-describedby="concurrent-questions-help"
								value={settings.maxConcurrentRequests}
								onChange={(event) =>
									updateSettings({ maxConcurrentRequests: Number(event.target.value) })
								}
							/>
						</div>
						<div className="settings-row settings-row--field">
							<label htmlFor="confidence-threshold" className="settings-label">
								{t("Confidence threshold")}
							</label>
							<div className="settings-range-control">
								<input
									id="confidence-threshold"
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={settings.confidenceThreshold}
									aria-valuetext={`${Math.round(settings.confidenceThreshold * 100)}%`}
									onChange={(event) =>
										updateSettings({ confidenceThreshold: Number(event.target.value) })
									}
								/>
								<output htmlFor="confidence-threshold" aria-hidden="true">
									{Math.round(settings.confidenceThreshold * 100)}%
								</output>
							</div>
						</div>
					</div>
				</section>

				<section className="settings-section" aria-labelledby="accessibility-heading">
					<header className="settings-section-header">
						<h2 id="accessibility-heading">
							<Accessibility size={17} aria-hidden="true" /> {t("Accessibility")}
						</h2>
						<p>{t("Adjust motion, contrast, and text size to suit you.")}</p>
					</header>
					<div className="settings-panel">
						<div className="settings-row">
							<div className="settings-row-copy">
								<label htmlFor="reduce-motion" className="settings-label">
									{t("Reduce motion")}
								</label>
								<p id="reduce-motion-help" className="settings-help">
									{t("Limit animations and animated transitions.")}
								</p>
							</div>
							<input
								id="reduce-motion"
								type="checkbox"
								role="switch"
								className="settings-switch-input"
								aria-describedby="reduce-motion-help"
								checked={settings.reduceMotion}
								onChange={(event) => updateSettings({ reduceMotion: event.target.checked })}
							/>
						</div>
						<div className="settings-row">
							<div className="settings-row-copy">
								<label htmlFor="high-contrast" className="settings-label">
									{t("High contrast")}
								</label>
								<p id="high-contrast-help" className="settings-help">
									{t("Increase contrast for text and interface borders.")}
								</p>
							</div>
							<input
								id="high-contrast"
								type="checkbox"
								role="switch"
								className="settings-switch-input"
								aria-describedby="high-contrast-help"
								checked={settings.highContrast}
								onChange={(event) => updateSettings({ highContrast: event.target.checked })}
							/>
						</div>
						<div className="settings-row settings-row--field">
							<label htmlFor="font-scale" className="settings-label">
								{t("Font scale")}
							</label>
							<div className="settings-range-control">
								<input
									id="font-scale"
									type="range"
									min="0.85"
									max="1.35"
									step="0.05"
									value={settings.fontScale}
									aria-valuetext={`${Math.round(settings.fontScale * 100)}%`}
									onChange={(event) => updateSettings({ fontScale: Number(event.target.value) })}
								/>
								<output htmlFor="font-scale" aria-hidden="true">
									{Math.round(settings.fontScale * 100)}%
								</output>
							</div>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
};

function PluginSettings() {
	const { t } = useTranslation();
	const bridge = getRhyzaBridge();
	const [plugins, setPlugins] = useState<PiPluginInfo[]>([]);
	const [source, setSource] = useState("");
	const [busySource, setBusySource] = useState<string | null>(bridge ? "list" : null);
	const [error, setError] = useState<string | null>(null);
	const [hasLoadedPlugins, setHasLoadedPlugins] = useState(false);

	useEffect(() => {
		if (!bridge) return;
		let cancelled = false;
		bridge
			.pluginList()
			.then((items) => {
				if (!cancelled) {
					setPlugins(items);
					setHasLoadedPlugins(true);
				}
			})
			.catch((loadError) => {
				if (!cancelled) setError(errorToMessage(loadError));
			})
			.finally(() => {
				if (!cancelled) setBusySource(null);
			});
		return () => {
			cancelled = true;
		};
	}, [bridge, setPlugins]);

	const install = async (requestedSource = source.trim()) => {
		if (!bridge || !requestedSource) return;
		setBusySource(requestedSource);
		setError(null);
		try {
			const result = await bridge.pluginInstall({ source: requestedSource });
			setPlugins(result.plugins);
			setHasLoadedPlugins(true);
			setSource("");
		} catch (installError) {
			setError(errorToMessage(installError));
		} finally {
			setBusySource(null);
		}
	};
	const installLocal = async () => {
		if (!bridge) return;
		setBusySource("local");
		setError(null);
		try {
			const selection = await bridge.pluginSelectLocal();
			if (selection.source) await install(selection.source);
		} catch (selectionError) {
			setError(errorToMessage(selectionError));
		} finally {
			setBusySource(null);
		}
	};

	const remove = async (pluginSource: string) => {
		if (!bridge) return;
		setBusySource(pluginSource);
		setError(null);
		try {
			const result = await bridge.pluginRemove({ source: pluginSource });
			setPlugins(result.plugins);
			setHasLoadedPlugins(true);
		} catch (removeError) {
			setError(errorToMessage(removeError));
		} finally {
			setBusySource(null);
		}
	};

	return (
		<div className="settings-panel pi-plugins-card" aria-busy={busySource !== null}>
			<div className="pi-plugin-warning" role="note">
				<ShieldAlert size={17} aria-hidden="true" />
				<p>
					{t(
						"Pi packages may execute code with full access to your computer. Install only packages whose source you trust.",
					)}
				</p>
			</div>
			<form
				className="pi-plugin-install"
				onSubmit={(event) => {
					event.preventDefault();
					void install();
				}}
			>
				<label htmlFor="pi-plugin-source">{t("Package source")}</label>
				<div className="pi-plugin-source-row">
					<input
						id="pi-plugin-source"
						className="field settings-input"
						value={source}
						onChange={(event) => setSource(event.target.value)}
						disabled={!bridge || busySource !== null}
						placeholder="npm:@scope/package or git:github.com/user/repo"
						aria-describedby="pi-plugin-source-help"
						autoCapitalize="none"
						spellCheck={false}
					/>
					<button
						type="submit"
						className="command-button"
						disabled={!bridge || !source.trim() || busySource !== null}
					>
						{busySource && busySource !== "list" ? (
							<LoaderCircle className="pi-plugin-spinner" size={14} aria-hidden="true" />
						) : (
							<Package size={14} aria-hidden="true" />
						)}
						{t("Install")}
					</button>
				</div>
				<p id="pi-plugin-source-help">
					{t("Supports npm:, git:, HTTPS/SSH Git URLs, and absolute local paths.")}
				</p>
				<button
					type="button"
					className="secondary-button"
					disabled={!bridge || busySource !== null}
					onClick={() => void installLocal()}
				>
					<Package size={14} aria-hidden="true" /> {t("Install from local folder…")}
				</button>
			</form>
			<div className="pi-plugin-list-header">
				<h3 id="installed-packages-heading">
					{t("Installed packages")} {bridge && hasLoadedPlugins && <span>{plugins.length}</span>}
				</h3>
				<button
					type="button"
					className="secondary-button"
					onClick={() =>
						void bridge?.openExternal({
							url: "https://www.npmjs.com/search?q=keywords%3Api-package",
						})
					}
					disabled={!bridge}
				>
					<ExternalLink size={14} aria-hidden="true" /> {t("Browse packages")}
				</button>
			</div>
			{error && (
				<p className="pi-plugin-error" role="alert">
					{error}
				</p>
			)}
			{!bridge ? (
				<p className="pi-plugin-empty">
					{t("Package management requires the Electron desktop runtime.")}
				</p>
			) : busySource === "list" ? (
				<p className="pi-plugin-empty" role="status">
					<LoaderCircle className="pi-plugin-spinner" size={15} aria-hidden="true" /> Loading
					installed packages…
				</p>
			) : !hasLoadedPlugins ? null : plugins.length === 0 ? (
				<p className="pi-plugin-empty">No Pi packages are configured yet.</p>
			) : (
				<ul className="pi-plugin-list" aria-labelledby="installed-packages-heading">
					{plugins.map((plugin) => (
						<li key={`${plugin.scope}:${plugin.source}`}>
							<div>
								<strong>{pluginDisplayName(plugin.source)}</strong>
								<code>{plugin.source}</code>
								<small>
									{plugin.scope === "project" ? "Workspace" : "User"} ·{" "}
									{plugin.installed ? "Installed" : "Missing on disk"}
								</small>
								{plugin.scope === "project" && (
									<small>Managed by the workspace .pi/settings.json file.</small>
								)}
							</div>
							<button
								type="button"
								className="secondary-button pi-plugin-remove"
								disabled={busySource !== null || plugin.scope === "project"}
								aria-label={`Remove ${pluginDisplayName(plugin.source)}`}
								title={
									plugin.scope === "project"
										? "Project packages are managed by the workspace .pi/settings.json file."
										: "Remove package"
								}
								onClick={() => void remove(plugin.source)}
							>
								{busySource === plugin.source ? (
									<LoaderCircle className="pi-plugin-spinner" size={14} aria-hidden="true" />
								) : (
									<Trash2 size={14} aria-hidden="true" />
								)}{" "}
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
			<p className="pi-plugin-reload-note">
				Installing or removing a package reloads Agent sessions; the next message uses the new
				plugin set.
			</p>
		</div>
	);
}

function pluginDisplayName(source: string): string {
	const withoutPrefix = source.replace(/^(npm:|git:)/i, "").replace(/[\\/]$/, "");
	const withoutVersion = withoutPrefix.replace(/@[^/@]+$/, "");
	return withoutVersion.split(/[\\/]/).filter(Boolean).pop() ?? source;
}

function AuthEventItem({ event }: { event: AuthBridgeEvent }) {
	if (event.type === "device_code") {
		return (
			<div>
				<p>
					Device code: <strong className="font-mono">{event.userCode}</strong>
				</p>
				<div className="settings-actions settings-auth-actions">
					<button
						type="button"
						className="secondary-button"
						onClick={() => void navigator.clipboard.writeText(event.userCode)}
					>
						<Copy size={14} aria-hidden="true" /> Copy code
					</button>
					<button
						type="button"
						className="secondary-button"
						onClick={() => void getRhyzaBridge()?.openExternal({ url: event.verificationUri })}
					>
						<ExternalLink size={14} aria-hidden="true" /> Open sign-in
					</button>
				</div>
			</div>
		);
	}
	if (event.type === "auth_url") {
		return (
			<button
				type="button"
				className="secondary-button"
				onClick={() => void getRhyzaBridge()?.openExternal({ url: event.url })}
			>
				<ExternalLink size={14} aria-hidden="true" /> Open authentication page
			</button>
		);
	}
	if (event.type === "info") {
		return (
			<div>
				<p>{event.message}</p>
				{event.links?.map((link) => (
					<button
						type="button"
						key={link.url}
						className="secondary-button settings-auth-link"
						onClick={() => void getRhyzaBridge()?.openExternal({ url: link.url })}
					>
						<ExternalLink size={14} aria-hidden="true" /> {link.label ?? "Open link"}
					</button>
				))}
			</div>
		);
	}
	return <p>{event.message}</p>;
}

export default Settings;
