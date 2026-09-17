import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export interface ArchifyRenderResponse {
	ok: boolean;
	html?: string;
	error?: string;
	diagnostics?: unknown[];
	fallbackMermaid?: string;
	renderedSpec?: string;
}
import { archifyToMermaid, parseArchifySource } from "./spec.js";
import { isRecord } from "./value.js";
import { prepareArchifyViewerHtml } from "./viewer.js";
import { patchArchifyExportHtml } from "./export.js";

const renderTimeoutMs = 120_000;
const maxArtifactBytes = 5_000_000;
const maxCacheEntries = 3;
const maxCacheBytes = 10_000_000;

export interface ArchifyDiagnosticEvent {
	timestamp: string;
	requestId: string;
	phase: "start" | "parsed" | "cache-hit" | "cli-end" | "repair" | "success" | "fallback" | "error";
	durationMs: number;
	sourceBytes?: number;
	diagramType?: string;
	nodeCount?: number;
	edgeCount?: number;
	normalized?: boolean;
	quality?: "showcase" | "standard";
	exitCode?: number;
	stdoutBytes?: number;
	stderrBytes?: number;
	diagnosticCount?: number;
	diagnosticCodes?: string[];
	attempt?: number;
	repairCount?: number;
	fallbackBytes?: number;
	htmlBytes?: number;
	cacheEntries?: number;
	error?: string;
}

type ArchifyDiagnosticSink = (event: ArchifyDiagnosticEvent) => void | Promise<void>;

export class ArchifyService {
	private readonly cache = new Map<string, ArchifyRenderResponse>();
	private cacheBytes = 0;

	constructor(
		private readonly skillRoot: string,
		private readonly tempRoot: string = os.tmpdir(),
		private readonly diagnosticSink?: ArchifyDiagnosticSink,
	) {}

	async render(source: string): Promise<ArchifyRenderResponse> {
		const startedAt = Date.now();
		const sourceBytes = Buffer.byteLength(source, "utf8");
		const requestId = createHash("sha256").update(source).digest("hex").slice(0, 12);
		await this.trace({
			timestamp: new Date().toISOString(),
			requestId,
			phase: "start",
			durationMs: 0,
			sourceBytes,
		});
		let fallbackMermaid = "";
		try {
			const parsed = parseArchifySource(source);
			fallbackMermaid = archifyToMermaid(source);
			await this.trace({
				timestamp: new Date().toISOString(),
				requestId,
				phase: "parsed",
				durationMs: Date.now() - startedAt,
				diagramType: parsed.type,
				nodeCount: parsed.nodes.length,
				edgeCount: parsed.edges.length,
				normalized: parsed.normalized,
				fallbackBytes: Buffer.byteLength(fallbackMermaid, "utf8"),
			});
			const cacheKey = createHash("sha256").update(source).digest("hex");
			const cached = this.cache.get(cacheKey);
			if (cached) {
				await this.trace({
					timestamp: new Date().toISOString(),
					requestId,
					phase: "cache-hit",
					durationMs: Date.now() - startedAt,
					diagramType: parsed.type,
					cacheEntries: this.cache.size,
				});
				return cached;
			}

			await mkdir(this.tempRoot, { recursive: true });
			const workDirectory = await mkdtemp(path.join(this.tempRoot, "rhyza-archify-"));
			try {
				const inputPath = path.join(workDirectory, "diagram.json");
				const outputPath = path.join(workDirectory, "diagram.html");
				const spec = prepareArchifySpec(parsed.spec);
				applyEstimatedComponentWidths(spec);
				applyAdaptiveGridSpacing(spec);
				await writeFile(inputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
				const cliPath = path.join(this.skillRoot, "bin", "archify.mjs");
				const showcase = await this.deliverWithLayoutRepairs({
					cliPath,
					type: parsed.type,
					inputPath,
					outputPath,
					quality: "showcase",
					spec,
					requestId,
				});
				if (showcase.result.exitCode !== 0) {
					const standard = await this.deliverWithLayoutRepairs({
						cliPath,
						type: parsed.type,
						inputPath,
						outputPath,
						quality: "standard",
						spec,
						requestId,
					});
					if (standard.result.exitCode !== 0) {
						const error = receiptError(
							standard.receipt,
							standard.result.stderr ||
								receiptError(showcase.receipt, "Archify validation failed."),
						);
						await this.trace({
							timestamp: new Date().toISOString(),
							requestId,
							phase: "fallback",
							durationMs: Date.now() - startedAt,
							diagramType: parsed.type,
							normalized: parsed.normalized,
							fallbackBytes: Buffer.byteLength(fallbackMermaid, "utf8"),
							error: errorSummary(error),
						});
						return {
							ok: false,
							error,
							diagnostics:
								receiptDiagnostics(standard.receipt) ?? receiptDiagnostics(showcase.receipt),
							fallbackMermaid,
						};
					}
				}
				const html = prepareArchifyViewerHtml(
					patchArchifyExportHtml(await readFile(outputPath, "utf8")),
				);
				const htmlBytes = Buffer.byteLength(html, "utf8");
				if (htmlBytes > maxArtifactBytes) {
					throw new Error("Rendered Archify artifact exceeds the 5 MB safety limit.");
				}
				const response: ArchifyRenderResponse = {
					ok: true,
					html,
					fallbackMermaid,
					renderedSpec: JSON.stringify(spec, null, 2),
				};
				this.remember(cacheKey, response);
				await this.trace({
					timestamp: new Date().toISOString(),
					requestId,
					phase: "success",
					durationMs: Date.now() - startedAt,
					diagramType: parsed.type,
					normalized: parsed.normalized,
					htmlBytes,
					fallbackBytes: Buffer.byteLength(fallbackMermaid, "utf8"),
					cacheEntries: this.cache.size,
				});
				return response;
			} finally {
				await rm(workDirectory, { recursive: true, force: true });
			}
		} catch (error) {
			await this.trace({
				timestamp: new Date().toISOString(),
				requestId,
				phase: "error",
				durationMs: Date.now() - startedAt,
				fallbackBytes: fallbackMermaid ? Buffer.byteLength(fallbackMermaid, "utf8") : 0,
				error: errorSummary(error instanceof Error ? error.message : String(error)),
			});
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				fallbackMermaid: fallbackMermaid || undefined,
			};
		}
	}

	private async deliverWithLayoutRepairs(options: {
		cliPath: string;
		type: string;
		inputPath: string;
		outputPath: string;
		quality: "showcase" | "standard";
		spec: Record<string, unknown>;
		requestId: string;
	}): Promise<{
		result: { exitCode: number; stdout: string; stderr: string };
		receipt?: Record<string, unknown>;
	}> {
		let result = { exitCode: 1, stdout: "", stderr: "" };
		let receipt: Record<string, unknown> | undefined;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const cliStartedAt = Date.now();
			result = await runArchify(options.cliPath, [
				"deliver",
				options.type,
				options.inputPath,
				options.outputPath,
				"--quality",
				options.quality,
				"--json",
			]);
			receipt = parseReceipt(result.stdout);
			await this.trace(
				cliDiagnosticEvent(
					options.requestId,
					options.quality,
					result,
					receipt,
					cliStartedAt,
					attempt,
				),
			);
			if (result.exitCode === 0 || attempt === 3) break;
			const error = receiptError(receipt, result.stderr);
			const repairCount =
				applySuggestedLabelPositions(options.spec, error) +
				applySuggestedComponentWidths(options.spec, error);
			if (repairCount === 0) break;
			applyAdaptiveGridSpacing(options.spec);
			await writeFile(options.inputPath, `${JSON.stringify(options.spec, null, 2)}\n`, "utf8");
			await this.trace({
				timestamp: new Date().toISOString(),
				requestId: options.requestId,
				phase: "repair",
				durationMs: 0,
				quality: options.quality,
				attempt,
				repairCount,
			});
		}
		return { result, receipt };
	}

	private async trace(event: ArchifyDiagnosticEvent): Promise<void> {
		if (!this.diagnosticSink) return;
		try {
			await this.diagnosticSink(event);
		} catch {
			// Diagnostics must never change rendering behavior.
		}
	}

	private remember(cacheKey: string, response: ArchifyRenderResponse): void {
		const previous = this.cache.get(cacheKey);
		if (previous) this.cacheBytes -= cacheEntryBytes(previous);
		this.cache.set(cacheKey, response);
		this.cacheBytes += cacheEntryBytes(response);
		while (this.cache.size > maxCacheEntries || this.cacheBytes > maxCacheBytes) {
			const oldestKey = this.cache.keys().next().value;
			if (!oldestKey) break;
			const oldest = this.cache.get(oldestKey);
			this.cache.delete(oldestKey);
			if (oldest) this.cacheBytes -= cacheEntryBytes(oldest);
		}
	}
}

export function prepareArchifySpec(source: Record<string, unknown>): Record<string, unknown> {
	const spec = structuredClone(source);
	if (!isRecord(spec.meta)) return spec;
	delete spec.meta.output;
	delete spec.meta.viewBox;
	spec.meta.visual_preset = "classic";
	return spec;
}

export function applyAdaptiveGridSpacing(spec: Record<string, unknown>): void {
	if (
		spec.diagram_type !== "architecture" ||
		!isRecord(spec.layout) ||
		spec.layout.mode !== "grid" ||
		!Array.isArray(spec.components)
	) {
		return;
	}
	const widths = spec.components.flatMap((component) =>
		isRecord(component) &&
		!Array.isArray(component.pos) &&
		Array.isArray(component.size) &&
		typeof component.size[0] === "number" &&
		Number.isFinite(component.size[0])
			? [component.size[0]]
			: [],
	);
	if (widths.length === 0) return;
	const cellWidth = typeof spec.layout.cellW === "number" ? spec.layout.cellW : 130;
	spec.layout.cellW = Math.max(cellWidth, ...widths);
}

function cacheEntryBytes(response: ArchifyRenderResponse): number {
	return (
		Buffer.byteLength(response.html ?? "", "utf8") +
		Buffer.byteLength(response.fallbackMermaid ?? "", "utf8")
	);
}

function cliDiagnosticEvent(
	requestId: string,
	quality: "showcase" | "standard",
	result: { exitCode: number; stdout: string; stderr: string },
	receipt: Record<string, unknown> | undefined,
	startedAt: number,
	attempt: number,
): ArchifyDiagnosticEvent {
	const diagnostics = receiptDiagnostics(receipt) ?? [];
	return {
		timestamp: new Date().toISOString(),
		requestId,
		phase: "cli-end",
		durationMs: Date.now() - startedAt,
		quality,
		attempt,
		exitCode: result.exitCode,
		stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
		stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
		diagnosticCount: diagnostics.length,
		diagnosticCodes: diagnosticCodes(diagnostics),
	};
}

export function applySuggestedLabelPositions(spec: Record<string, unknown>, error: string): number {
	if (spec.diagram_type !== "architecture" || !Array.isArray(spec.connections)) return 0;
	const suggestions = new Map<string, [number, number]>();
	const pattern =
		/Label "([^"\r\n]+)" overlaps component "[^"\r\n]+"[\s\S]*?Suggested fix: labelAt \[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]/g;
	for (const match of error.matchAll(pattern)) {
		const x = Number(match[2]);
		const y = Number(match[3]);
		if (Number.isFinite(x) && Number.isFinite(y) && !suggestions.has(match[1]))
			suggestions.set(match[1], [x, y]);
	}
	let repairCount = 0;
	for (const connection of spec.connections) {
		if (!isRecord(connection) || typeof connection.label !== "string") continue;
		const labelAt = suggestions.get(connection.label);
		if (
			!labelAt ||
			(Array.isArray(connection.labelAt) &&
				connection.labelAt[0] === labelAt[0] &&
				connection.labelAt[1] === labelAt[1])
		)
			continue;
		connection.labelAt = labelAt;
		delete connection.labelDx;
		delete connection.labelDy;
		delete connection.labelSegment;
		repairCount += 1;
	}
	return repairCount;
}

/** Applies the minimum readable width reported by Archify, plus a small guard band. */
export function applySuggestedComponentWidths(
	spec: Record<string, unknown>,
	error: string,
): number {
	if (spec.diagram_type !== "architecture" || !Array.isArray(spec.components)) return 0;
	const requiredWidths = new Map<string, number>();
	for (const match of error.matchAll(
		/(?:Sublabel|Label) "[^"\r\n]+"(?: \([^)]*\))? needs ~(\d+)px[^\r\n]*component "([^"]+)" provides \d+px/g,
	)) {
		requiredWidths.set(match[2], Math.max(requiredWidths.get(match[2]) ?? 0, Number(match[1])));
	}
	for (const match of error.matchAll(
		/Label "[^"\r\n]+" \(~(\d+)px\) is wider than component "([^"]+)" \(\d+px\)/g,
	)) {
		requiredWidths.set(match[2], Math.max(requiredWidths.get(match[2]) ?? 0, Number(match[1])));
	}
	let repairCount = 0;
	for (const component of spec.components) {
		if (!isRecord(component) || typeof component.id !== "string") continue;
		const minimumWidth = requiredWidths.get(component.id);
		if (!minimumWidth) continue;
		const size = Array.isArray(component.size) ? component.size : [];
		const width = typeof size[0] === "number" ? size[0] : 0;
		const height = typeof size[1] === "number" ? size[1] : 72;
		const repairedWidth = Math.max(width, minimumWidth + 12);
		if (repairedWidth === width) continue;
		component.size = [repairedWidth, height];
		repairCount += 1;
	}
	return repairCount;
}

/**
 * First-pass sizing based on the visible copy. The renderer's own diagnostics
 * remain authoritative and can widen components further on the retry path.
 */
export function applyEstimatedComponentWidths(spec: Record<string, unknown>): number {
	if (spec.diagram_type !== "architecture" || !Array.isArray(spec.components)) return 0;
	let repairCount = 0;
	for (const component of spec.components) {
		if (!isRecord(component)) continue;
		const label = typeof component.label === "string" ? component.label : "";
		const sublabel = typeof component.sublabel === "string" ? component.sublabel : "";
		const minimumWidth = Math.max(
			112,
			Math.ceil(estimateTextWidth(label, 6.5) + 16),
			Math.ceil(estimateTextWidth(sublabel, 3.8) + 12),
		);
		const size = Array.isArray(component.size) ? component.size : [];
		const width = typeof size[0] === "number" ? size[0] : 0;
		const height = typeof size[1] === "number" ? size[1] : 72;
		const repairedWidth = Math.max(width, minimumWidth);
		if (repairedWidth === width) continue;
		component.size = [repairedWidth, height];
		repairCount += 1;
	}
	return repairCount;
}

function estimateTextWidth(text: string, asciiWidth: number): number {
	return [...text].reduce(
		(width, char) =>
			width +
			(/[^\x00-\x7f]/.test(char) ? asciiWidth * 1.6 : char === " " ? asciiWidth * 0.5 : asciiWidth),
		0,
	);
}

function diagnosticCodes(diagnostics: unknown[]): string[] {
	return [
		...new Set(
			diagnostics.flatMap((diagnostic) =>
				isRecord(diagnostic) && typeof diagnostic.code === "string" ? [diagnostic.code] : [],
			),
		),
	].slice(0, 20);
}

function errorSummary(error: string): string {
	return error.split(/\r?\n/, 1)[0].trim().slice(0, 500) || "Unknown Archify error";
}

async function runArchify(
	cliPath: string,
	args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath, ...args], {
			env: {
				...process.env,
				ARCHIFY_SKIP_LAYOUT_VALIDATION: "1",
				ELECTRON_RUN_AS_NODE: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout = appendBounded(stdout, chunk);
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = appendBounded(stderr, chunk);
		});
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("Archify rendering timed out after 120 seconds."));
		}, renderTimeoutMs);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

function appendBounded(current: string, chunk: string): string {
	const next = current + chunk;
	return next.length <= 1_000_000 ? next : next.slice(next.length - 1_000_000);
}

function parseReceipt(stdout: string): Record<string, unknown> | undefined {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const value = JSON.parse(stdout.slice(start, end + 1));
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function receiptError(receipt: Record<string, unknown> | undefined, fallback: string): string {
	return typeof receipt?.error === "string" && receipt.error.trim()
		? receipt.error
		: fallback.trim();
}

function receiptDiagnostics(receipt: Record<string, unknown> | undefined): unknown[] | undefined {
	return Array.isArray(receipt?.diagnostics) ? receipt.diagnostics.slice(0, 30) : undefined;
}
