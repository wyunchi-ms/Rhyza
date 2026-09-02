import clsx from "clsx";
import { Accessibility, Brain, Cloud, Copy, ExternalLink, LoaderCircle, Moon, Network, Package, Palette, Settings2, ShieldAlert, Sun, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	useElectronProviderState,
} from "../hooks/useKnowbranchBridge";
import { loadWorkspaceState, setWorkspacePersistencePath, useAppStore } from "../store";
import type { AuthBridgeEvent } from "../shared/ipc";
import type { PiPluginInfo } from "../shared/ipc";
import { errorToMessage } from "../shared/value";
import archifyVendor from "../../resources/skills/archify/RHYZA_VENDOR.json";

const Settings: React.FC = () => {
	const { settings, updateSettings } = useAppStore();
	const electron = useElectronProviderState();
	const providerLabel = electron.isElectron
		? "GitHub Copilot"
		: settings.provider;
	const selectedModel = settings.defaultModel;

	const handleLogin = async () => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		electron.setError(null);
		const result = await bridge.providerLogin({
			providerId: githubCopilotProviderId,
		});
		electron.setProviderStatus(result.status);
		if (result.error) electron.setError(result.error);
		const catalog = await bridge.modelCatalog({
			providerId: githubCopilotProviderId,
			refresh: result.ok,
		});
		electron.setModels(catalog.models);
	};

	const handleLogout = async () => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const result = await bridge.providerLogout({
			providerId: githubCopilotProviderId,
		});
		electron.setProviderStatus(result.status);
		if (result.error) electron.setError(result.error);
	};

	const handleSelectWorkspace = async () => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const workspace = await bridge.selectWorkspace();
		setWorkspacePersistencePath(workspace.path);
		electron.setWorkspace(workspace);
		loadWorkspaceState(bridge.appStateLoad());
	};

	return (
		<div className="settings-page page-scroll">
			<div className="page-header">
				<h1 className="page-title">
					Settings
				</h1>
				<p className="page-subtitle">
					Configure providers, models, and workspace preferences.
				</p>
			</div>

			<div className="settings-sections">
				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Package size={16} /> Pi Plugins
					</h2>
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
								<input type="radio" name="app-theme" value="light" checked={settings.theme === "light"} onChange={() => updateSettings({ theme: "light" })} />
								<Sun size={18} aria-hidden="true" />
								<span><strong>Light</strong><small>Bright surfaces and dark text</small></span>
							</label>
							<label className={clsx(settings.theme === "dark" && "is-selected")}>
								<input type="radio" name="app-theme" value="dark" checked={settings.theme === "dark"} onChange={() => updateSettings({ theme: "dark" })} />
								<Moon size={18} aria-hidden="true" />
								<span><strong>Dark</strong><small>Dim surfaces for low-light use</small></span>
							</label>
						</div>
						<p className="text-xs text-secondary mt-4">Interactive diagrams follow the app theme automatically.</p>
					</fieldset>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Cloud size={16} /> AI Provider
					</h2>
					<div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-sm">
						<div className="flex justify-between items-center mb-6">
							<div>
								<h3 className="font-bold text-primary text-lg">
									{providerLabel}
								</h3>
								<p className="text-sm text-secondary">
									{electron.isElectron
										? electron.providerStatus?.configured
											? `Configured via ${electron.providerStatus.source ?? "Pi SDK"}.`
											: "Not signed in. OAuth/device flow progress appears below."
										: "Provider controls require the Electron desktop runtime."}
								</p>
								{electron.error && (
									<p className="text-xs text-red-500 mt-1">{electron.error}</p>
								)}
							</div>
							<button
								type="button"
								onClick={
									electron.providerStatus?.configured ? handleLogout : handleLogin
								}
								disabled={!electron.isElectron || electron.loading}
								className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-primary font-bold rounded-lg text-sm transition-colors"
							>
								{electron.isElectron
									? electron.providerStatus?.configured
										? "Sign Out"
										: "Sign In"
									: "Desktop required"}
							</button>
						</div>

						{electron.authEvents.length > 0 && (
							<div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 space-y-1">
								{electron.authEvents.map((event, index) => (
									<AuthEventItem key={`${event.type}-${index}`} event={event} />
								))}
							</div>
						)}

						<div>
							<label
								htmlFor="model-select"
								className="block text-sm font-bold text-primary mb-2"
							>
								Default Model
							</label>
							<select
								id="model-select"
								value={selectedModel}
								onChange={(e) =>
									updateSettings({ defaultModel: e.target.value })
								}
								className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent/20 focus:border-accent font-medium text-sm outline-none"
							>
								<option value="">Use provider default</option>
								{electron.isElectron ? (
									electron.models.map((model) => (
										<option key={model.id} value={model.id}>
											{model.name}
										</option>
									))
								) : (
									<>
										<option>GPT-4o (Default)</option>
										<option>Claude 3.5 Sonnet</option>
										<option>GPT-4o mini</option>
									</>
								)}
							</select>
						</div>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
						<Network size={16} /> Diagrams
					</h2>
					<fieldset className="diagram-renderer-settings border border-gray-200 rounded-2xl p-6 bg-white shadow-sm">
						<legend className="sr-only">Diagram renderer</legend>
						<div className="diagram-renderer-options">
							<label className={clsx(settings.diagramRenderer === "archify" && "is-selected")}>
								<input type="radio" name="diagram-renderer" value="archify" checked={settings.diagramRenderer === "archify"} onChange={() => updateSettings({ diagramRenderer: "archify" })} />
								<span><strong>Archify <b className="diagram-renderer-version">v{archifyVendor.version}</b></strong><small>Interactive · showcase quality · more time and tokens · schema v{archifyVendor.schemaVersion}</small></span>
								<em>Default</em>
							</label>
							<label className={clsx(settings.diagramRenderer === "mermaid" && "is-selected")}>
								<input type="radio" name="diagram-renderer" value="mermaid" checked={settings.diagramRenderer === "mermaid"} onChange={() => updateSettings({ diagramRenderer: "mermaid" })} />
								<span><strong>Mermaid</strong><small>Fast · compact · original diagram flow</small></span>
							</label>
						</div>
						<p className="text-xs text-secondary mt-4">Archify failures still fall back to a Mermaid view generated from the same topology.</p>
					</fieldset>
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
										? electron.workspace.path ?? "No workspace selected."
										: "Workspace selection requires the Electron desktop runtime."}
								</p>
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
								<h3 className="font-bold text-primary">
									Auto-extract Knowledge
								</h3>
								<p className="text-sm text-secondary">
									Automatically propose ChangeSets after turns.
								</p>
							</div>
							<button
								type="button"
								onClick={() =>
									updateSettings({ autoExtract: !settings.autoExtract })
								}
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
					<h2 className="text-sm font-bold uppercase text-gray-400 mb-4 flex items-center gap-2"><Brain size={16} /> Knowledge policy</h2>
					<div className="border border-gray-200 rounded-lg p-6 bg-white space-y-5">
						<label className="form-label">Write mode<select className="field mt-1" value={settings.knowledgeMode} onChange={(event) => updateSettings({ knowledgeMode: event.target.value as typeof settings.knowledgeMode })}><option value="suggest">Suggest changes</option><option value="automatic">Automatic</option><option value="hybrid">Hybrid</option><option value="read_only">Read only</option></select></label>
						<label className="form-label">Thinking level<select className="field mt-1" value={settings.thinkingLevel} onChange={(event) => updateSettings({ thinkingLevel: event.target.value as typeof settings.thinkingLevel })}><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
						<label className="form-label">Concurrent questions (1–10)<input className="field mt-1" type="number" min="1" max="10" value={settings.maxConcurrentRequests} onChange={(event) => updateSettings({ maxConcurrentRequests: Number(event.target.value) })} /><span className="text-xs text-secondary mt-1 block">Default: 5. Requests in the same conversation stay ordered.</span></label>
						<label className="form-label">Confidence threshold: {Math.round(settings.confidenceThreshold * 100)}%<input type="range" min="0" max="1" step="0.05" value={settings.confidenceThreshold} onChange={(event) => updateSettings({ confidenceThreshold: Number(event.target.value) })} className="w-full mt-2" /></label>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-bold uppercase text-gray-400 mb-4 flex items-center gap-2"><Accessibility size={16} /> Accessibility</h2>
					<div className="border border-gray-200 rounded-lg p-6 bg-white space-y-4">
						<label className="flex justify-between items-center text-sm font-semibold">Reduce motion<input type="checkbox" checked={settings.reduceMotion} onChange={(event) => updateSettings({ reduceMotion: event.target.checked })} /></label>
						<label className="flex justify-between items-center text-sm font-semibold">High contrast<input type="checkbox" checked={settings.highContrast} onChange={(event) => updateSettings({ highContrast: event.target.checked })} /></label>
						<label className="form-label">Font scale: {Math.round(settings.fontScale * 100)}%<input type="range" min="0.85" max="1.35" step="0.05" value={settings.fontScale} onChange={(event) => updateSettings({ fontScale: Number(event.target.value) })} className="w-full mt-2" /></label>
					</div>
				</section>
			</div>
		</div>
	);
};

function PluginSettings() {
	const bridge = getKnowbranchBridge();
	const [plugins, setPlugins] = useState<PiPluginInfo[]>([]);
	const [source, setSource] = useState("");
	const [busySource, setBusySource] = useState<string | null>(bridge ? "list" : null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!bridge) return;
		let cancelled = false;
		bridge.pluginList()
			.then((items) => { if (!cancelled) setPlugins(items); })
			.catch((loadError) => { if (!cancelled) setError(errorToMessage(loadError)); })
			.finally(() => { if (!cancelled) setBusySource(null); });
		return () => { cancelled = true; };
	}, [bridge]);

	const install = async () => {
		if (!bridge || !source.trim()) return;
		const requestedSource = source.trim();
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
				<p>Pi packages may execute code with full access to your computer. Install only packages whose source you trust.</p>
			</div>
			<form className="pi-plugin-install" onSubmit={(event) => { event.preventDefault(); void install(); }}>
				<label htmlFor="pi-plugin-source">Package source</label>
				<div>
					<input id="pi-plugin-source" className="field" value={source} onChange={(event) => setSource(event.target.value)} disabled={!bridge || busySource !== null} placeholder="npm:@scope/package or git:github.com/user/repo" />
					<button type="submit" className="command-button" disabled={!bridge || !source.trim() || busySource !== null}>
						{busySource && busySource !== "list" ? <LoaderCircle className="pi-plugin-spinner" size={14} /> : <Package size={14} />}
						Install
					</button>
				</div>
				<p>Supports npm:, git:, HTTPS/SSH Git URLs, and absolute local paths.</p>
			</form>
			<div className="pi-plugin-list-header">
				<h3>Installed packages <span>{plugins.length}</span></h3>
				<button type="button" className="secondary-button" onClick={() => void bridge?.openExternal({ url: "https://www.npmjs.com/search?q=keywords%3Api-package" })} disabled={!bridge}>
					<ExternalLink size={13} /> Browse packages
				</button>
			</div>
			{error && <p className="pi-plugin-error" role="alert">{error}</p>}
			{busySource === "list" ? (
				<p className="pi-plugin-empty"><LoaderCircle className="pi-plugin-spinner" size={15} /> Loading installed packages…</p>
			) : plugins.length === 0 ? (
				<p className="pi-plugin-empty">No Pi packages are configured yet.</p>
			) : (
				<ul className="pi-plugin-list">
					{plugins.map((plugin) => (
						<li key={`${plugin.scope}:${plugin.source}`}>
							<div><strong>{pluginDisplayName(plugin.source)}</strong><code>{plugin.source}</code><small>{plugin.scope === "project" ? "Workspace" : "User"} · {plugin.installed ? "Installed" : "Missing on disk"}</small></div>
							<button type="button" className="secondary-button pi-plugin-remove" disabled={busySource !== null || plugin.scope === "project"} title={plugin.scope === "project" ? "Project packages are managed by the workspace .pi/settings.json file." : "Remove package"} onClick={() => void remove(plugin.source)}>
								{busySource === plugin.source ? <LoaderCircle className="pi-plugin-spinner" size={13} /> : <Trash2 size={13} />} Remove
							</button>
						</li>
					))}
				</ul>
			)}
			<p className="pi-plugin-reload-note">Installing or removing a package reloads Agent sessions; the next message uses the new plugin set.</p>
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
		return <div><p>Device code: <strong className="font-mono">{event.userCode}</strong></p><div className="flex gap-2 mt-2"><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(event.userCode)}><Copy size={13} /> Copy code</button><button type="button" className="secondary-button" onClick={() => void getKnowbranchBridge()?.openExternal({ url: event.verificationUri })}><ExternalLink size={13} /> Open sign-in</button></div></div>;
	}
	if (event.type === "auth_url") {
		return <button type="button" className="secondary-button" onClick={() => void getKnowbranchBridge()?.openExternal({ url: event.url })}><ExternalLink size={13} /> Open authentication page</button>;
	}
	if (event.type === "info") {
		return <div><p>{event.message}</p>{event.links?.map((link) => <button type="button" key={link.url} className="secondary-button mt-2" onClick={() => void getKnowbranchBridge()?.openExternal({ url: link.url })}><ExternalLink size={13} /> {link.label ?? "Open link"}</button>)}</div>;
	}
	return <p>{event.message}</p>;
}

export default Settings;
