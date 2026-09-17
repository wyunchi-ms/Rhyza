import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArchifyService } from "./runtime.js";
import { parseArchifySource } from "./spec.js";
import { createArchifyPreviewHtml, createArchifyViewerHead } from "./viewer.js";
import { archifyExportPatches } from "./export.js";

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
	const previewPath = path.join(resolved, `${stem}.preview.html`);
	const scriptPath = path.join(resolved, `${stem}.mjs`);
	const cli = path.join(skillRoot, "bin", "archify.mjs");
	const script = `import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const input = fileURLToPath(new URL(${JSON.stringify(`./${stem}.json`)}, import.meta.url));
const output = fileURLToPath(new URL(${JSON.stringify(`./${stem}.html`)}, import.meta.url));
const preview = fileURLToPath(new URL(${JSON.stringify(`./${stem}.preview.html`)}, import.meta.url));
const cli = process.env.ARCHIFY_CLI || ${JSON.stringify(cli)};
const viewerHead = ${JSON.stringify(createArchifyViewerHead())};
const exportPatches = ${JSON.stringify(archifyExportPatches)};
let result;
for (const quality of ["showcase", "standard"]) {
	result = spawnSync(process.execPath, [
		cli, "deliver", ${JSON.stringify(parsed.type)}, input, output, "--quality", quality,
	], {
		stdio: "inherit",
		env: { ...process.env, ARCHIFY_SKIP_LAYOUT_VALIDATION: "1", ELECTRON_RUN_AS_NODE: "1" },
	});
	if (result.error) throw result.error;
	if (result.status === 0) break;
}
if (result.status === 0) {
	let html = readFileSync(output, "utf8").replace(/\\r\\n/g, "\\n");
	for (const [source, replacement] of exportPatches) {
		const index = html.indexOf(source);
		if (index < 0 || index !== html.lastIndexOf(source)) {
			throw new Error("The Archify export adapter does not match the bundled viewer.");
		}
		html = html.replace(source, () => replacement);
	}
	html = html.replace(/<html\\b([^>]*)>/i, (_tag, attributes) =>
		'<html' + attributes + ' data-rhyza-mode="expanded">');
	const fullHtml = html.replace(/<\\/head>/i, () => viewerHead + "\\n</head>");
	writeFileSync(output, fullHtml, "utf8");
	writeFileSync(preview, fullHtml.replace('data-rhyza-mode="expanded"', 'data-rhyza-mode="inline"'), "utf8");
}
process.exitCode = result.status ?? 1;
`;
	await writeFile(inputPath, result.renderedSpec, "utf8");
	await writeFile(scriptPath, script, "utf8");
	await writeFile(htmlPath, result.html, "utf8");
	await writeFile(previewPath, createArchifyPreviewHtml(result.html), "utf8");
	const reference = {
		version: 1,
		path: path.relative(workspaceRoot, htmlPath).split(path.sep).join("/"),
		previewPath: path.relative(workspaceRoot, previewPath).split(path.sep).join("/"),
		title: parsed.title ?? "Diagram",
	};
	return {
		htmlPath,
		previewPath,
		scriptPath,
		inputPath,
		message: `Generated HTML: ${reference.path}\nChat preview: ${reference.previewPath}\nReplay script: ${path.relative(workspaceRoot, scriptPath)}\nValidated specification: ${path.relative(workspaceRoot, inputPath)}\n\nInclude this block unchanged in the final answer:\n\n\`\`\`html-preview\n${JSON.stringify(reference)}\n\`\`\``,
	};
}
