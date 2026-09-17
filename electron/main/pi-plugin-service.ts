import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiPluginInfo } from "../../src/shared/ipc.js";

export class PiPluginService {
	constructor(
		private readonly agentDir: string,
		private readonly getWorkspacePath: () => Promise<string | null>,
	) {}

	async list(): Promise<PiPluginInfo[]> {
		const { manager } = await this.createManager();
		return toPluginInfo(manager);
	}

	async install(source: string): Promise<PiPluginInfo[]> {
		const { manager, settingsManager } = await this.createManager();
		await manager.installAndPersist(source);
		await flushSettings(settingsManager);
		return toPluginInfo(manager);
	}

	async remove(source: string): Promise<PiPluginInfo[]> {
		// Pi persists user-local sources relative to agentDir, not the active workspace.
		const { manager, settingsManager } = await this.createManager(this.agentDir);
		const configured = manager
			.listConfiguredPackages()
			.some(
				(item) =>
					item.scope === "user" && (item.source === source || item.installedPath === source),
			);
		if (!configured) throw new Error(`Pi package is not configured: ${source}`);
		const removed = await manager.removeAndPersist(source);
		if (!removed) throw new Error(`Pi package is not configured: ${source}`);
		await flushSettings(settingsManager);
		return toPluginInfo(manager);
	}

	private async createManager(sourceBasePath?: string): Promise<{
		manager: DefaultPackageManager;
		settingsManager: SettingsManager;
	}> {
		const cwd = (await this.getWorkspacePath()) ?? process.cwd();
		const settingsManager = SettingsManager.create(cwd, this.agentDir, { projectTrusted: false });
		return {
			manager: new DefaultPackageManager({
				cwd: sourceBasePath ?? cwd,
				agentDir: this.agentDir,
				settingsManager,
			}),
			settingsManager,
		};
	}
}

function toPluginInfo(manager: DefaultPackageManager): PiPluginInfo[] {
	return manager.listConfiguredPackages().map((item) => ({
		source: item.source,
		scope: item.scope,
		installed: item.installedPath !== undefined,
		...(item.installedPath ? { installedPath: item.installedPath } : {}),
	}));
}

async function flushSettings(settingsManager: SettingsManager): Promise<void> {
	await settingsManager.flush();
	const errors = settingsManager.drainErrors();
	if (errors.length) throw errors[0].error;
}
