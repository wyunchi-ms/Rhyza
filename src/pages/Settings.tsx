import clsx from "clsx";
import { Accessibility, Brain, Cloud, Copy, ExternalLink, Settings2 } from "lucide-react";
import type React from "react";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	useElectronProviderState,
} from "../hooks/useKnowbranchBridge";
import { loadWorkspaceState, setWorkspacePersistencePath, useAppStore } from "../store";
import type { AuthBridgeEvent } from "../shared/ipc";

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
