import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const directory = join(homedir(), ".pi-graph", "diagnostics");
const requestedPath = process.argv[2];
const filePath = requestedPath ?? (existsSync(directory)
	? readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().reverse().map((name) => join(directory, name))[0]
	: undefined);

if (!filePath || !existsSync(filePath)) {
	console.error("No diagnostics file found. Run the Tauri app for at least 10 seconds first.");
	process.exit(1);
}

const entries = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
	try { return [JSON.parse(line)]; } catch { return []; }
});
const renderer = entries.filter((entry) => entry.kind === "renderer-sample");
const regions = {};
for (const sample of renderer) {
	for (const [region, milliseconds] of Object.entries(sample.regionStalls ?? {})) {
		regions[region] = (regions[region] ?? 0) + Number(milliseconds);
	}
}
const maxRegion = Math.max(1, ...Object.values(regions));
console.log(`Diagnostics: ${filePath}`);
console.log(`Samples: ${renderer.length} renderer / ${entries.filter((entry) => entry.kind === "main-sample").length} main`);
console.log(`Window unresponsive events: ${entries.filter((entry) => entry.kind === "window-unresponsive").length}`);
console.log("\nUI stall heatmap (aggregated blocked milliseconds):");
for (const [region, milliseconds] of Object.entries(regions).sort((left, right) => right[1] - left[1])) {
	const bars = "█".repeat(Math.max(1, Math.round((milliseconds / maxRegion) * 28)));
	console.log(`${region.padEnd(18)} ${bars.padEnd(28)} ${Math.round(milliseconds)}ms`);
}
const operations = entries.filter((entry) => entry.kind === "operation-end");
console.log("\nSlow operations:");
for (const operation of operations.sort((left, right) => right.durationMs - left.durationMs).slice(0, 10)) {
	console.log(`${String(operation.operation).padEnd(20)} ${String(operation.durationMs).padStart(8)}ms  ${operation.ok ? "ok" : "failed"}`);
}
