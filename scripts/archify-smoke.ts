import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArchifyService } from "../electron/main/archify-service";
import type { ArchifyDiagnosticEvent } from "../electron/main/archify-service";
import { GptArchifyHarness, resolveBundledArchifySkillRoot } from "../electron/main/archify-harness";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(projectRoot, "resources", "skills", "archify");
const vendor = JSON.parse(await readFile(path.join(skillRoot, "RHYZA_VENDOR.json"), "utf8")) as { version?: unknown; schemaVersion?: unknown };
const packageMetadata = JSON.parse(await readFile(path.join(skillRoot, "package.json"), "utf8")) as { version?: unknown };
assert.equal(vendor.version, packageMetadata.version, "RHYZA_VENDOR.json must track the vendored Archify package version.");
assert.equal(vendor.schemaVersion, 1, "Update the integration before accepting a new Archify schema major.");
assert.equal(resolveBundledArchifySkillRoot({
	appPath: path.join(projectRoot, "dist-electron", "electron", "main"),
	resourcesPath: path.join(projectRoot, "unused"),
	isPackaged: false,
}), skillRoot, "Development resource lookup must escape dist-electron/electron/main.");
assert.equal(resolveBundledArchifySkillRoot({
	appPath: path.join(projectRoot, "resources", "app.asar"),
	resourcesPath: path.join(projectRoot, "resources"),
	isPackaged: true,
}), skillRoot, "Packaged resource lookup must use Electron resourcesPath.");
const source = await readFile(path.join(skillRoot, "examples", "web-app.architecture.json"), "utf8");
const harness = new GptArchifyHarness(skillRoot);
const loader = new DefaultResourceLoader({
	cwd: projectRoot,
	agentDir: path.join(projectRoot, ".tmp", "archify-smoke-agent"),
	additionalSkillPaths: harness.additionalSkillPaths,
});
await loader.reload();
assert(loader.getSkills().skills.some((skill) => skill.name === "archify"), "Pi did not discover the bundled Archify skill.");
assert.match(harness.wrapUserPrompt("Map this system", "archify"), /^<diagram_mode>archify<\/diagram_mode>/);
const diagnosticEvents: ArchifyDiagnosticEvent[] = [];
const service = new ArchifyService(skillRoot, path.join(projectRoot, ".tmp"), (event) => { diagnosticEvents.push(event); });
const result = await service.render(source);

assert.equal(result.ok, true, result.error ?? JSON.stringify(result.diagnostics));
assert.match(result.html ?? "", /<meta name="generator" content="archify/i);
assert.match(result.html ?? "", /<svg\b/i);
assert.match(result.fallbackMermaid ?? "", /^flowchart TD/m);
await service.render(source);
assert.deepEqual(diagnosticEvents.slice(0, 4).map((event) => event.phase), ["start", "parsed", "cli-end", "success"]);
assert.equal(diagnosticEvents.at(-1)?.phase, "cache-hit");
assert.equal(diagnosticEvents.find((event) => event.phase === "cli-end")?.quality, "showcase");
assert.equal(diagnosticEvents.some((event) => Object.hasOwn(event, "source")), false, "Diagnostics must not contain diagram source.");

const genericResult = await new ArchifyService(skillRoot, path.join(projectRoot, ".tmp")).render(JSON.stringify({
	title: "Generic runtime graph",
	nodes: [
		{ id: "clients", label: "Clients", kind: "group", children: ["ui", "api"] },
		{ id: "ui", label: "Web UI", kind: "component" },
		{ id: "api", label: "API", kind: "service" },
	],
	edges: [{ from: "ui", to: "api", label: "HTTPS" }],
}));
assert.equal(genericResult.ok, true, genericResult.error ?? JSON.stringify(genericResult.diagnostics));
assert.match(genericResult.html ?? "", /<svg\b/i);
assert.match(genericResult.fallbackMermaid ?? "", /ui -->\|"HTTPS"\| api/);

const overlapResult = await service.render(JSON.stringify({
	schema_version: 1,
	diagram_type: "architecture",
	meta: { title: "Label repair", quality_profile: "showcase", viewBox: [600, 400] },
	components: [
		{ id: "clients", type: "frontend", label: "Clients", pos: [55, 230], size: [150, 72] },
		{ id: "apiEntry", type: "backend", label: "API", pos: [280, 230], size: [170, 72] },
	],
	connections: [{ id: "request", from: "clients", to: "apiEntry", label: "HTTP / API 请求" }],
}));
assert.equal(overlapResult.ok, true, overlapResult.error ?? JSON.stringify(overlapResult.diagnostics));
assert(diagnosticEvents.some((event) => event.phase === "repair" && event.repairCount === 1), "Expected deterministic label repair diagnostics.");

console.log("Archify smoke passed: skill discovery, canonical delivery, generic repair, and Mermaid fallback all succeeded.");
