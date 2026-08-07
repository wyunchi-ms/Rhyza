import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

interface PersistedSettings {
	workspacePath: string | null;
}

const defaultSettings: PersistedSettings = { workspacePath: null };

export class SettingsStore {
	private readonly settingsPath: string;

	constructor(userDataPath: string) {
		this.settingsPath = path.join(userDataPath, "knowbranch-settings.json");
	}

	async getWorkspacePath(): Promise<string | null> {
		return (await this.readSettings()).workspacePath;
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
		try {
			const raw = await readFile(this.settingsPath, "utf8");
			const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
			return {
				workspacePath:
					typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
			};
		} catch (error) {
			if (isMissingFileError(error)) {
				return defaultSettings;
			}
			throw error;
		}
	}

	private async writeSettings(settings: PersistedSettings): Promise<void> {
		await mkdir(path.dirname(this.settingsPath), { recursive: true });
		await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	}
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
