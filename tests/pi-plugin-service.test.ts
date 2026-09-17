import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PiPluginService } from "../electron/main/pi-plugin-service";
import { validatePiPluginRemoveRequest } from "../src/shared/ipc";

test("removes normalized local sources relative to agent settings, not the workspace", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-plugin-remove-"));
	try {
		const agentDir = path.join(root, "config", "agent");
		const workspace = path.join(root, "workspaces", "project");
		const source = path.join(root, "extensions", "pi-archify");
		const otherSource = path.join(root, "extensions", "another-plugin");
		await mkdir(workspace, { recursive: true });
		for (const directory of [source, otherSource]) {
			await mkdir(directory, { recursive: true });
			await writeFile(path.join(directory, "package.json"), '{"name":"local-extension"}');
		}
		const service = new PiPluginService(agentDir, async () => workspace);
		await service.install(source);
		const installed = await service.install(otherSource);
		const plugin = installed.find((item) => item.installedPath === source);
		assert(plugin);
		assert.equal(plugin.source, path.relative(agentDir, source));
		assert.equal(path.isAbsolute(plugin.source), false);

		const restarted = new PiPluginService(agentDir, async () => workspace);
		const request = validatePiPluginRemoveRequest({ source: plugin.source });
		const remaining = await restarted.remove(request.source);
		assert.deepEqual(
			remaining.map((item) => item.installedPath),
			[otherSource],
		);
		assert.deepEqual(await new PiPluginService(agentDir, async () => workspace).list(), remaining);
		assert.equal(
			await readFile(path.join(source, "package.json"), "utf8"),
			'{"name":"local-extension"}',
		);
		await assert.rejects(restarted.remove(plugin.source), /Pi package is not configured/);
		await assert.rejects(restarted.remove("npm:not-configured"), /Pi package is not configured/);
		assert.deepEqual(await restarted.list(), remaining);
		await restarted.remove(otherSource);
		assert.deepEqual(await restarted.list(), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("removes missing local packages and preserves other filtered settings entries", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-plugin-missing-"));
	try {
		const agentDir = path.join(root, "agent");
		const workspace = path.join(root, "workspace");
		await mkdir(agentDir);
		await mkdir(workspace);
		const source = path.join("..", "missing", "pi-archify");
		const retained = { source: "extensions/other", extensions: ["index.ts"] };
		const settingsPath = path.join(agentDir, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				packages: [{ source, extensions: ["src/index.ts"] }, retained],
			}),
		);
		const service = new PiPluginService(agentDir, async () => workspace);
		const installed = await service.list();
		assert.equal(installed.find((item) => item.source === source)?.installed, false);
		const remaining = await service.remove(validatePiPluginRemoveRequest({ source }).source);
		assert.deepEqual(
			remaining.map((item) => item.source),
			[retained.source],
		);
		assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).packages, [retained]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
