import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { ComposerSkillInfo, ProviderId } from "../../src/shared/ipc.js";

/** Discover metadata only; opening a composer menu must never execute extensions. */
export function listComposerSkills(options: {
	providerId: ProviderId;
	home: string;
	workspace: string | null;
	agentDir: string;
	pluginPaths?: string[];
}): ComposerSkillInfo[] {
	const providerDirectory =
		options.providerId === "codex"
			? ".codex"
			: options.providerId === "claude-code"
				? ".claude"
				: ".pi";
	const roots: Array<{ dir: string; scope: ComposerSkillInfo["scope"] }> = [
		{ dir: path.join(options.home, ".agents", "skills"), scope: "Personal" },
		{
			dir:
				options.providerId === "github-copilot"
					? path.join(options.agentDir, "skills")
					: path.join(options.home, providerDirectory, "skills"),
			scope: "Personal",
		},
	];
	// Codex is also hosted by the Pi runtime in Rhyza and can use its installed skills.
	if (options.providerId === "codex") {
		roots.push({ dir: path.join(options.agentDir, "skills"), scope: "Personal" });
		roots.push({ dir: path.join(options.home, ".codex", "skills", ".system"), scope: "Personal" });
		if (options.workspace)
			roots.push({ dir: path.join(options.workspace, ".pi", "skills"), scope: "Project" });
	}
	if (options.workspace) {
		roots.unshift(
			{ dir: path.join(options.workspace, ".agents", "skills"), scope: "Project" },
			{ dir: path.join(options.workspace, providerDirectory, "skills"), scope: "Project" },
		);
	}
	for (const pluginPath of options.pluginPaths ?? []) {
		roots.push({ dir: path.join(pluginPath, "skills"), scope: "Plugin" });
	}
	const seen = new Set<string>();
	return roots.flatMap(({ dir, scope }) => {
		const result = loadSkillsFromDir({ dir, source: scope });
		return result.skills.flatMap((skill) => {
			if (seen.has(skill.filePath)) return [];
			seen.add(skill.filePath);
			return [{ name: skill.name, description: skill.description, path: skill.filePath, scope }];
		});
	});
}
