import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArchifyService } from "./runtime.js";
import { parseArchifySource } from "./spec.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function generateDiagramFiles(specification: string, cwd: string) {
	const parsed = parseArchifySource(specification);
	const skillRoot = path.join(packageRoot, "skills", "archify");
	const result = await new ArchifyService(skillRoot).render(specification);
	if (!result.ok || !result.html || !result.renderedSpec)
		throw new Error(result.error ?? "Diagram rendering failed.");
	const workspaceRoot = await realpath(cwd);
	const outputRoot = path.join(workspaceRoot, ".rhyza", "html");
	await mkdir(outputRoot, { recursive: true });
	const resolved = await realpath(outputRoot);
	const relativeRoot = path.relative(workspaceRoot, resolved);
	if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot))
		throw new Error("Output directory must remain inside the workspace.");
	const stem = `diagram-${randomUUID()}`;
	const inputPath = path.join(resolved, `${stem}.json`);
	const htmlPath = path.join(resolved, `${stem}.html`);
	const scriptPath = path.join(resolved, `${stem}.mjs`);
	const cli = path.join(skillRoot, "bin", "archify.mjs");
	const script = `import { spawnSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nconst input = fileURLToPath(new URL(${JSON.stringify(`./${stem}.json`)}, import.meta.url));\nconst output = fileURLToPath(new URL(${JSON.stringify(`./${stem}.html`)}, import.meta.url));\nconst cli = process.env.ARCHIFY_CLI || ${JSON.stringify(cli)};\nlet result;\nfor (const quality of ["showcase", "standard"]) {\n  result = spawnSync(process.execPath, [cli, "deliver", ${JSON.stringify(parsed.type)}, input, output, "--quality", quality], { stdio: "inherit" });\n  if (result.status === 0) break;\n}\nif (result.error) throw result.error;\nprocess.exitCode = result.status ?? 1;\n`;
	await writeFile(inputPath, result.renderedSpec, "utf8");
	await writeFile(scriptPath, script, "utf8");
	await writeFile(htmlPath, result.html, "utf8");
	const reference = {
		version: 1,
		path: path.relative(workspaceRoot, htmlPath).split(path.sep).join("/"),
		title: parsed.title ?? "Diagram",
	};
	return {
		htmlPath,
		scriptPath,
		inputPath,
		message: `Generated HTML: ${reference.path}\nReplay script: ${path.relative(workspaceRoot, scriptPath)}\nValidated specification: ${path.relative(workspaceRoot, inputPath)}\n\nInclude this block unchanged in the final answer:\n\n\`\`\`html-preview\n${JSON.stringify(reference)}\n\`\`\``,
	};
}
