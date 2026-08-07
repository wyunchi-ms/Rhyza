import clsx from "clsx";
import { Cloud, Settings2 } from "lucide-react";
import type React from "react";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	useElectronProviderState,
} from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";

const Settings: React.FC = () => {
	const { settings, updateSettings } = useAppStore();
	const electron = useElectronProviderState();
	const providerLabel = electron.isElectron
		? "GitHub Copilot"
		: `${settings.provider} (browser demo fallback)`;
	const selectedModel = electron.isElectron
		? settings.defaultModel
		: settings.defaultModel;

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
		electron.setWorkspace(await bridge.selectWorkspace());
	};

	return (
		<div className="flex-1 flex flex-col bg-white overflow-hidden p-8 max-w-3xl mx-auto w-full">
			<div className="mb-8">
				<h1 className="text-3xl font-black tracking-tight text-primary">
					Settings
				</h1>
				<p className="text-secondary mt-2 text-lg">
					Configure providers, models, and workspace preferences.
				</p>
			</div>

			<div className="space-y-8">
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
										: "Browser demo fallback: provider and model behavior is mocked."}
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
									: "Sign Out (demo mock)"}
							</button>
						</div>

						{electron.authEvents.length > 0 && (
							<div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 space-y-1">
								{electron.authEvents.map((event, index) => (
									<div key={`${event.type}-${index}`}>
										{formatAuthEvent(event)}
									</div>
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
										: "Browser demo fallback: no real filesystem workspace is selected."}
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
								<h3 className="font-bold text-primary">Strict Conflict Mode (Mock)</h3>
								<p className="text-sm text-secondary">
									Prevent concurrent writes in the same Git Worktree. (Prototype only)
								</p>
							</div>
							<button
								type="button"
								onClick={() =>
									updateSettings({ strictConflict: !settings.strictConflict })
								}
								className={clsx(
									"w-12 h-6 rounded-full relative cursor-pointer transition-colors",
									settings.strictConflict ? "bg-accent" : "bg-gray-300",
								)}
							>
								<div
									className={clsx(
										"absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
										settings.strictConflict ? "right-1" : "left-1",
									)}
								/>
							</button>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
};

function formatAuthEvent(event: { type: string } & Record<string, unknown>) {
	if (event.type === "device_code") {
		return `Device code: ${event.userCode} at ${event.verificationUri}`;
	}
	if (event.type === "auth_url") {
		return `Open authentication URL: ${event.url}`;
	}
	if (typeof event.message === "string") {
		return event.message;
	}
	return event.type;
}

export default Settings;
