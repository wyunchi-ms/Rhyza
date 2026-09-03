import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const directory = join(homedir(), ".pi-graph", "diagnostics");
const requestedPath = process.argv[2];
const filePath = requestedPath ?? (existsSync(directory)
	? readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().reverse().map((name) => join(directory, name))[0]
	: undefined);

if (!filePath || !existsSync(filePath)) {
	console.error("No diagnostics file found. Run the Electron app for at least 10 seconds first.");
	process.exit(1);
}

const entries = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
	try { return [JSON.parse(line)]; } catch { return []; }
});
const renderer = entries.filter((entry) => entry.kind === "renderer-sample");
const regions = {};
for (const sample of renderer.filter((sample) => sample.visibility === "visible" && (sample.heartbeat?.maxDelayMs ?? 0) <= 5_000)) {
	for (const [region, milliseconds] of Object.entries(sample.regionStalls ?? {})) {
		regions[region] = (regions[region] ?? 0) + Number(milliseconds);
	}
}
const timingTotals = {};
for (const sample of renderer) {
	for (const [name, timing] of Object.entries(sample.timings ?? {})) {
		const current = timingTotals[name] ?? { count: 0, totalMs: 0, maxMs: 0, totalBytes: 0, maxBytes: 0 };
		current.count += Number(timing.count ?? 0);
		current.totalMs += Number(timing.totalMs ?? 0);
		current.maxMs = Math.max(current.maxMs, Number(timing.maxMs ?? 0));
		current.totalBytes += Number(timing.totalBytes ?? 0);
		current.maxBytes = Math.max(current.maxBytes, Number(timing.maxBytes ?? 0));
		timingTotals[name] = current;
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
if (Object.keys(regions).length === 0) console.log("No visible UI stalls recorded.");
console.log("\nRenderer timings:");
if (Object.keys(timingTotals).length === 0) console.log("No fine-grained timings yet. Restart the updated app and exercise the slow interaction.");
for (const [name, timing] of Object.entries(timingTotals).sort((left, right) => right[1].totalMs - left[1].totalMs)) {
	const average = timing.count ? timing.totalMs / timing.count : 0;
	const size = timing.maxBytes ? `  max ${(timing.maxBytes / 1024).toFixed(0)} KiB` : "";
	console.log(`${name.padEnd(24)} count=${String(timing.count).padStart(5)} avg=${average.toFixed(1).padStart(7)}ms max=${timing.maxMs.toFixed(1).padStart(7)}ms${size}`);
}

const mainSamples = entries.filter((entry) => entry.kind === "main-sample");
if (mainSamples.length) {
	const maximumP99 = Math.max(...mainSamples.map((sample) => Number(sample.eventLoopDelayMs?.p99 ?? 0)));
	const maximumDelay = Math.max(...mainSamples.map((sample) => Number(sample.eventLoopDelayMs?.max ?? 0)));
	const maximumRss = Math.max(...mainSamples.map((sample) => Number(sample.memoryBytes?.rss ?? 0)));
	console.log(`\nMain process: max p99 loop delay ${maximumP99}ms, max delay ${maximumDelay}ms, peak RSS ${(maximumRss / 1024 / 1024).toFixed(1)} MiB`);
}
const operations = entries.filter((entry) => entry.kind === "operation-end");
console.log("\nSlow operations:");
for (const operation of operations.sort((left, right) => right.durationMs - left.durationMs).slice(0, 10)) {
	console.log(`${String(operation.operation).padEnd(20)} ${String(operation.durationMs).padStart(8)}ms  ${operation.ok ? "ok" : "failed"}`);
}

const archify = entries.filter((entry) => entry.kind === "archify-render");
const archifyFinal = archify.filter((entry) => ["success", "fallback", "error", "cache-hit"].includes(entry.phase));
console.log("\nArchify renders:");
if (archifyFinal.length === 0) console.log("No Archify render events in this log.");
for (const entry of archifyFinal.slice(-12)) {
	const result = entry.phase === "success" ? "interactive" : entry.phase === "cache-hit" ? "cached" : entry.phase;
	console.log(`${String(entry.requestId).padEnd(12)} ${String(entry.diagramType ?? "unknown").padEnd(12)} ${String(result).padEnd(11)} ${String(entry.durationMs).padStart(7)}ms${entry.normalized ? "  normalized" : ""}`);
	const attempts = archify.filter((candidate) => candidate.requestId === entry.requestId && candidate.phase === "cli-end");
	for (const attempt of attempts) {
		const codes = Array.isArray(attempt.diagnosticCodes) && attempt.diagnosticCodes.length ? `  ${attempt.diagnosticCodes.join(", ")}` : "";
		console.log(`  ${String(attempt.quality).padEnd(9)} exit=${attempt.exitCode} ${String(attempt.durationMs).padStart(6)}ms diagnostics=${attempt.diagnosticCount ?? 0}${codes}`);
	}
	for (const repair of archify.filter((candidate) => candidate.requestId === entry.requestId && candidate.phase === "repair")) {
		console.log(`  repair    attempt=${repair.attempt} labels=${repair.repairCount}`);
	}
}
