import type { PiPluginInfo } from "../shared/ipc";
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

const Settings: React.FC = () => {
	const { settings, updateSettings } = useAppStore();
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
				<h1 className="page-title">Settings</h1>
				<p className="page-subtitle">Configure providers, models, and workspace preferences.</p>
			</div>

			<div className="settings-sections">
				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Package size={16} /> Pi Plugins (GitHub Copilot only)
					</h2>
					<p className="text-sm text-secondary mb-4">
						These plugins run only with GitHub Copilot through Pi, not with Codex or Claude Code.
					</p>
					<PluginSettings />
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Palette size={16} /> Appearance
					</h2>
					<fieldset className="theme-settings border border-gray-200 rounded-2xl p-6 bg-white shadow-sm">
						<legend className="sr-only">App theme</legend>
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
									<strong>Light</strong>
									<small>Bright surfaces and dark text</small>
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
									<strong>Dark</strong>
									<small>Dim surfaces for low-light use</small>
								</span>
							</label>
						</div>
						<p className="text-xs text-secondary mt-4">
							Interactive diagrams follow the app theme automatically.
						</p>
					</fieldset>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Cloud size={16} /> AI Provider
					</h2>
					<div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-sm">
						<div className="mb-6">
							<label
								htmlFor="provider-select"
								className="block text-sm font-bold text-primary mb-2"
							>
								Provider
							</label>
							<select
								id="provider-select"
								value={provider.id}
								onChange={(event) =>
									updateSettings({ provider: normalizeProviderId(event.target.value) })
								}
								className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent/20 focus:border-accent font-medium text-sm outline-none"
							>
								{providers.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
							<p className="text-xs text-secondary mt-2">
								Used for new messages, titles, and knowledge extraction. Changing provider resets
								the model to its default.
							</p>
						</div>
						<div
							className="flex flex-wrap justify-between items-center gap-4 mb-6"
							aria-busy={electron.loading}
						>
							<div>
								<h3 className="font-bold text-primary text-lg">{provider.label}</h3>
								<p className="text-sm text-secondary">
									{electron.isElectron
										? electron.loading
											? "Checking connection…"
											: electron.providerStatus?.configured
												? (electron.providerStatus.label ??
													`Connected via ${electron.providerStatus.source ?? provider.runtimeLabel}.`)
												: externalAuth
													? "Local CLI sign-in is required. Follow the setup instructions below."
													: "Not signed in. OAuth/device flow progress appears below."
										: "Provider controls require the Electron desktop runtime."}
								</p>
								{electron.error && (
									<p role="alert" className="text-xs text-red-500 mt-1">
										{electron.error}
									</p>
								)}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{!externalAuth && (
									<button
										type="button"
										onClick={() =>
											void (electron.providerStatus?.configured
												? electron.logout()
												: electron.login())
										}
										disabled={!electron.isElectron || electron.loading}
										className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
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
									className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
								>
									{electron.loading && (
										<LoaderCircle
											size={14}
											className="inline mr-2 animate-spin"
											aria-hidden="true"
										/>
									)}
									{electron.action === "refresh"
										? "Checking…"
										: electron.providerStatus?.configured
											? "Refresh status"
											: "Check connection"}
								</button>
							</div>
						</div>

						{setupInstructions && (
							<div className="mb-6 rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-secondary">
								<p className="whitespace-pre-line">{setupInstructions}</p>
								{externalAuth && (
									<p className="mt-2">
										Sign-in and sign-out are managed by the local CLI, not Rhyza.
									</p>
								)}
							</div>
						)}

						{!externalAuth && electron.authEvents.length > 0 && (
							<div
								role="status"
								className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 space-y-1"
							>
								{electron.authEvents.map((event, index) => (
									<AuthEventItem key={`${event.type}-${index}`} event={event} />
								))}
							</div>
						)}

						<div>
							<label htmlFor="model-select" className="block text-sm font-bold text-primary mb-2">
								Default Model
							</label>
							<select
								id="model-select"
								value={selectedModel}
								onChange={(e) => updateSettings({ defaultModel: e.target.value })}
								className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent/20 focus:border-accent font-medium text-sm outline-none"
							>
								<option value="">Use provider default</option>
								{customModel && <option value={selectedModel}>{selectedModel} (custom)</option>}
								{electron.models.map((model) => (
									<option key={model.id} value={model.id}>
										{model.name}
									</option>
								))}
							</select>
							{externalAuth && (
								<div className="mt-4">
									<label
										htmlFor="custom-model-id"
										className="block text-sm font-bold text-primary mb-2"
									>
										Custom model ID or CLI alias
									</label>
									<input
										id="custom-model-id"
										type="text"
										value={selectedModel}
										onChange={(event) => updateSettings({ defaultModel: event.target.value })}
										placeholder="Leave blank for provider default"
										aria-describedby="custom-model-help"
										className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent/20 focus:border-accent font-medium text-sm outline-none"
									/>
									<p id="custom-model-help" className="text-xs text-secondary mt-2">
										{provider.label} may not publish a model catalog. The provider default works
										without one; you can also enter a supported SDK/CLI model ID or alias.
									</p>
								</div>
							)}
						</div>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Settings2 size={16} /> Workspace
					</h2>
					<div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-sm space-y-6">
						<div className="flex justify-between items-center gap-4">
							<div>
								<h3 className="font-bold text-primary">Workspace Folder</h3>
								<p className="text-sm text-secondary break-all">
									{electron.isElectron
										? (electron.workspace.path ?? "No workspace selected.")
										: "Workspace selection requires the Electron desktop runtime."}
								</p>
								{electron.workspaceError && (
									<p role="alert" className="text-xs text-red-500 mt-1">
										{electron.workspaceError}
									</p>
								)}
							</div>
							<button
								type="button"
								onClick={handleSelectWorkspace}
								disabled={!electron.isElectron}
								className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
							>
								Choose Folder
							</button>
						</div>

						<div className="flex justify-between items-center">
							<div>
								<h3 className="font-bold text-primary">Auto-extract Knowledge</h3>
								<p className="text-sm text-secondary">
									Automatically propose ChangeSets after turns.
								</p>
							</div>
							<button
								type="button"
								onClick={() => updateSettings({ autoExtract: !settings.autoExtract })}
								className={clsx(
									"w-12 h-6 rounded-full relative cursor-pointer transition-colors",
									settings.autoExtract ? "bg-accent" : "bg-gray-300",
								)}
							>
								<div
									className={clsx(
										"absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
										settings.autoExtract ? "right-1" : "left-1",
									)}
								/>
							</button>
						</div>

						<div className="flex justify-between items-center">
							<div>
								<h3 className="font-bold text-primary">Worktree isolation</h3>
								<p className="text-sm text-secondary">
									Run writable sessions in separate Git worktrees.
								</p>
							</div>
							<span className="status-badge status-success">Required for Git</span>
						</div>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
						<Brain size={16} /> Knowledge policy
					</h2>
					<div className="border border-gray-200 rounded-lg p-6 bg-white space-y-5">
						<label className="form-label">
							Write mode
							<select
								className="field mt-1"
								value={settings.knowledgeMode}
								onChange={(event) =>
									updateSettings({
										knowledgeMode: event.target.value as typeof settings.knowledgeMode,
									})
								}
							>
								<option value="suggest">Suggest changes</option>
								<option value="automatic">Automatic</option>
								<option value="hybrid">Hybrid</option>
								<option value="read_only">Read only</option>
							</select>
						</label>
						<div className="flex justify-between items-center gap-4">
							<div>
								<h3 className="font-bold text-primary">Knowledge tools in chat</h3>
								<p className="text-sm text-secondary">
									Let the main agent query the knowledge base when needed. The end-of-turn organizer
									always has access.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={settings.knowledgeTools}
								aria-label="Knowledge tools in chat"
								onClick={() => updateSettings({ knowledgeTools: !settings.knowledgeTools })}
								className={clsx(
									"w-12 h-6 rounded-full relative shrink-0 cursor-pointer transition-colors",
									settings.knowledgeTools ? "bg-accent" : "bg-gray-300",
								)}
							>
								<div
									className={clsx(
										"absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
										settings.knowledgeTools ? "right-1" : "left-1",
									)}
								/>
							</button>
						</div>
						<label className="form-label">
							Thinking level
							<select
								className="field mt-1"
								value={settings.thinkingLevel}
								onChange={(event) =>
									updateSettings({
										thinkingLevel: event.target.value as typeof settings.thinkingLevel,
									})
								}
							>
								<option value="off">Off</option>
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
							</select>
						</label>
						<label className="form-label">
							Concurrent questions (1–10)
							<input
								className="field mt-1"
								type="number"
								min="1"
								max="10"
								value={settings.maxConcurrentRequests}
								onChange={(event) =>
									updateSettings({ maxConcurrentRequests: Number(event.target.value) })
								}
							/>
							<span className="text-xs text-secondary mt-1 block">
								Default: 5. Requests in the same conversation stay ordered.
							</span>
						</label>
						<label className="form-label">
							Confidence threshold: {Math.round(settings.confidenceThreshold * 100)}%
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={settings.confidenceThreshold}
								onChange={(event) =>
									updateSettings({ confidenceThreshold: Number(event.target.value) })
								}
								className="w-full mt-2"
							/>
						</label>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
						<Accessibility size={16} /> Accessibility
					</h2>
					<div className="border border-gray-200 rounded-lg p-6 bg-white space-y-4">
						<label className="flex justify-between items-center text-sm font-semibold">
							Reduce motion
							<input
								type="checkbox"
								checked={settings.reduceMotion}
								onChange={(event) => updateSettings({ reduceMotion: event.target.checked })}
							/>
						</label>
						<label className="flex justify-between items-center text-sm font-semibold">
							High contrast
							<input
								type="checkbox"
								checked={settings.highContrast}
								onChange={(event) => updateSettings({ highContrast: event.target.checked })}
							/>
						</label>
						<label className="form-label">
							Font scale: {Math.round(settings.fontScale * 100)}%
							<input
								type="range"
								min="0.85"
								max="1.35"
								step="0.05"
								value={settings.fontScale}
								onChange={(event) => updateSettings({ fontScale: Number(event.target.value) })}
								className="w-full mt-2"
							/>
						</label>
					</div>
				</section>
			</div>
		</div>
	);
};

function PluginSettings() {
	const bridge = getRhyzaBridge();
	const [plugins, setPlugins] = useState<PiPluginInfo[]>([]);
	const [source, setSource] = useState("");
	const [busySource, setBusySource] = useState<string | null>(bridge ? "list" : null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!bridge) return;
		let cancelled = false;
		bridge
			.pluginList()
			.then((items) => {
				if (!cancelled) setPlugins(items);
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
		} catch (removeError) {
			setError(errorToMessage(removeError));
		} finally {
			setBusySource(null);
		}
	};

	return (
		<div className="pi-plugins-card">
			<div className="pi-plugin-warning" role="note">
				<ShieldAlert size={17} aria-hidden="true" />
				<p>
					Pi packages may execute code with full access to your computer. Install only packages
					whose source you trust.
				</p>
			</div>
			<form
				className="pi-plugin-install"
				onSubmit={(event) => {
					event.preventDefault();
					void install();
				}}
			>
				<label htmlFor="pi-plugin-source">Package source</label>
				<div>
					<input
						id="pi-plugin-source"
						className="field"
						value={source}
						onChange={(event) => setSource(event.target.value)}
						disabled={!bridge || busySource !== null}
						placeholder="npm:@scope/package or git:github.com/user/repo"
					/>
					<button
						type="submit"
						className="command-button"
						disabled={!bridge || !source.trim() || busySource !== null}
					>
						{busySource && busySource !== "list" ? (
							<LoaderCircle className="pi-plugin-spinner" size={14} />
						) : (
							<Package size={14} />
						)}
						Install
					</button>
				</div>
				<p>Supports npm:, git:, HTTPS/SSH Git URLs, and absolute local paths.</p>
				<button
					type="button"
					className="secondary-button"
					disabled={!bridge || busySource !== null}
					onClick={() => void installLocal()}
				>
					<Package size={14} /> Install from local folder…
				</button>
			</form>
			<div className="pi-plugin-list-header">
				<h3>
					Installed packages <span>{plugins.length}</span>
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
					<ExternalLink size={13} /> Browse packages
				</button>
			</div>
			{error && (
				<p className="pi-plugin-error" role="alert">
					{error}
				</p>
			)}
			{busySource === "list" ? (
				<p className="pi-plugin-empty">
					<LoaderCircle className="pi-plugin-spinner" size={15} /> Loading installed packages…
				</p>
			) : plugins.length === 0 ? (
				<p className="pi-plugin-empty">No Pi packages are configured yet.</p>
			) : (
				<ul className="pi-plugin-list">
					{plugins.map((plugin) => (
						<li key={`${plugin.scope}:${plugin.source}`}>
							<div>
								<strong>{pluginDisplayName(plugin.source)}</strong>
								<code>{plugin.source}</code>
								<small>
									{plugin.scope === "project" ? "Workspace" : "User"} ·{" "}
									{plugin.installed ? "Installed" : "Missing on disk"}
								</small>
							</div>
							<button
								type="button"
								className="secondary-button pi-plugin-remove"
								disabled={busySource !== null || plugin.scope === "project"}
								title={
									plugin.scope === "project"
										? "Project packages are managed by the workspace .pi/settings.json file."
										: "Remove package"
								}
								onClick={() => void remove(plugin.source)}
							>
								{busySource === plugin.source ? (
									<LoaderCircle className="pi-plugin-spinner" size={13} />
								) : (
									<Trash2 size={13} />
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
				<div className="flex gap-2 mt-2">
					<button
						type="button"
						className="secondary-button"
						onClick={() => void navigator.clipboard.writeText(event.userCode)}
					>
						<Copy size={13} /> Copy code
					</button>
					<button
						type="button"
						className="secondary-button"
						onClick={() => void getRhyzaBridge()?.openExternal({ url: event.verificationUri })}
					>
						<ExternalLink size={13} /> Open sign-in
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
				<ExternalLink size={13} /> Open authentication page
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
						className="secondary-button mt-2"
						onClick={() => void getRhyzaBridge()?.openExternal({ url: link.url })}
					>
						<ExternalLink size={13} /> {link.label ?? "Open link"}
					</button>
				))}
			</div>
		);
	}
	return <p>{event.message}</p>;
}

export default Settings;
