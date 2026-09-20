import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listComposerSkills } from "../electron/main/composer-skills";

test("skill catalog combines current provider, shared and plugin skills with scope labels", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-composer-skills-"));
	try {
		const home = path.join(root, "home");
		const workspace = path.join(root, "workspace");
		const plugin = path.join(root, "plugin");
		for (const [dir, name] of [
			[path.join(home, ".agents", "skills", "shared"), "shared"],
			[path.join(home, ".codex", "skills", "codex"), "codex"],
			[path.join(home, ".claude", "skills", "claude"), "claude"],
			[path.join(workspace, ".agents", "skills", "project"), "project"],
			[path.join(plugin, "skills", "plugin"), "plugin"],
		]) {
			await mkdir(dir, { recursive: true });
			await writeFile(
				path.join(dir, "SKILL.md"),
				`---\nname: ${name}\ndescription: Example skill\n---\nInstructions.`,
			);
		}
		const skills = listComposerSkills({
			providerId: "codex",
			home,
			workspace,
			agentDir: path.join(root, "agent"),
			pluginPaths: [plugin, plugin],
		});
		assert.deepEqual(
			skills.map((skill) => [skill.name, skill.scope]),
			[
				["project", "Project"],
				["shared", "Personal"],
				["codex", "Personal"],
				["plugin", "Plugin"],
			],
		);
		assert.ok(skills.every((skill) => skill.path.endsWith("SKILL.md")));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
