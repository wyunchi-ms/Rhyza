import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

interface PersistedSettings {
	workspacePath: string | null;
}

const defaultSettings: PersistedSettings = { workspacePath: null };

export class SettingsStore {
	private readonly settingsPath: string;
	private readonly legacySettingsPath?: string;

	constructor(dataRoot: string, legacyUserDataPath?: string) {
		this.settingsPath = path.join(dataRoot, "settings.json");
		this.legacySettingsPath = legacyUserDataPath
			? path.join(legacyUserDataPath, "knowbranch-settings.json")
			: undefined;
	}

	async getWorkspacePath(): Promise<string | null> {
		return (await this.readSettings()).workspacePath;
	}

	getWorkspacePathSync(): string | null {
		for (const settingsPath of [this.settingsPath, this.legacySettingsPath]) {
			if (!settingsPath) continue;
			try {
				return parseSettings(readFileSync(settingsPath, "utf8")).workspacePath;
			} catch (error) {
				if (!isMissingFileError(error)) throw error;
			}
		}
		return null;
	}

	async setWorkspacePath(workspacePath: string | null): Promise<void> {
		const settings = await this.readSettings();
		await this.writeSettings({
			...settings,
			workspacePath: workspacePath ? await canonicalizeWorkspacePath(workspacePath) : null,
		});
	}

	async requireWorkspacePath(): Promise<string> {
		const workspacePath = await this.getWorkspacePath();
		if (!workspacePath) {
			throw new Error("Choose a workspace folder in Settings before chatting.");
		}
		return canonicalizeWorkspacePath(workspacePath);
	}

	private async readSettings(): Promise<PersistedSettings> {
		for (const [index, settingsPath] of [this.settingsPath, this.legacySettingsPath].entries()) {
			if (!settingsPath) continue;
			try {
				const settings = parseSettings(await readFile(settingsPath, "utf8"));
				if (index > 0) await this.writeSettings(settings);
				return settings;
			} catch (error) {
				if (!isMissingFileError(error)) throw error;
			}
		}
		return defaultSettings;
	}

	private async writeSettings(settings: PersistedSettings): Promise<void> {
		await mkdir(path.dirname(this.settingsPath), { recursive: true });
		await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	}
}

function parseSettings(raw: string): PersistedSettings {
	const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
	return {
		workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
	};
}

export async function canonicalizeWorkspacePath(workspacePath: string): Promise<string> {
	return realpath(path.resolve(workspacePath));
}

export async function assertPathInsideWorkspace(
	workspacePath: string,
	candidatePath: string,
): Promise<string> {
	const workspaceRoot = await canonicalizeWorkspacePath(workspacePath);
	const candidate = await canonicalizeWorkspacePath(candidatePath);
	const relative = path.relative(workspaceRoot, candidate);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
		return candidate;
	}
	throw new Error("Path is outside the selected workspace.");
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}
