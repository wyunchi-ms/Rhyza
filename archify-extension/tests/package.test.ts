import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DefaultPackageManager,
	DefaultResourceLoader,
	SettingsManager,
	createAgentSession,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { generateDiagramFiles } from "../src/output";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("install as an ordinary Pi package, activate its tool and remove it", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "archify-package-"));
	try {
		const agentDir = path.join(root, "agent");
		const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: false });
		const manager = new DefaultPackageManager({ cwd: root, agentDir, settingsManager });
		await manager.installAndPersist(packageRoot);
		await settingsManager.flush();
		const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const extension = loader
			.getExtensions()
			.extensions.find((item) => item.tools.has("archify_render"));
		assert(extension);
		assert(extension.handlers.has("before_agent_start"));
		assert(loader.getSkills().skills.some((skill) => skill.name === "archify"));
		const tools = loader.getExtensions().extensions.flatMap((item) => [...item.tools.keys()]);
		const { session } = await createAgentSession({
			cwd: root,
			agentDir,
			resourceLoader: loader,
			settingsManager,
			sessionManager: SessionManager.inMemory(root),
			tools: ["read", ...tools],
		});
		try {
			assert(session.getActiveToolNames().includes("archify_render"));
		} finally {
			session.dispose();
		}
		await manager.removeAndPersist(packageRoot);
		await settingsManager.flush();
		await loader.reload();
		assert.equal(loader.getExtensions().extensions.length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("schema input produces HTML, JSON and an executable replay script", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "archify-output-"));
	try {
		const source = await readFile(
			path.join(packageRoot, "skills/archify/examples/web-app.architecture.json"),
			"utf8",
		);
		const files = await generateDiagramFiles(source, root);
		assert.match(await readFile(files.htmlPath, "utf8"), /<svg\b/i);
		assert.match(files.message, /```html-preview/);
		assert.equal(JSON.parse(await readFile(files.inputPath, "utf8")).schema_version, 1);
		await rm(files.htmlPath);
		execFileSync(process.execPath, [files.scriptPath], { timeout: 120_000, stdio: "pipe" });
		assert.match(await readFile(files.htmlPath, "utf8"), /<svg\b/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
