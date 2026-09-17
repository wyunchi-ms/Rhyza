import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ArchifyService } from "../src/runtime";
import { createArchifyPreviewHtml } from "../src/viewer";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test(
	"compact diagrams fit real sandboxed viewports without losing zoom or content",
	{
		timeout: 180_000,
	},
	async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "archify-viewer-"));
		try {
			const service = new ArchifyService(path.join(packageRoot, "skills", "archify"), root);
			const fixtures: Array<{ name: string; html: string; previewHtml: string }> = [];
			for (const count of [2, 10]) {
				const result = await service.render(
					JSON.stringify({
						schema_version: 1,
						diagram_type: "architecture",
						meta: { title: `${count} columns`, viewBox: [720, 400] },
						layout: { mode: "grid", cols: count, cellW: 112, gapX: 40 },
						components: Array.from({ length: count }, (_, index) => ({
							id: `node${index}`,
							type: "backend",
							label: `A deliberately long service name ${index}`,
							row: 0,
							col: index,
						})),
						connections: [],
						cards: [
							{
								dot: "cyan",
								title: "Hidden summary",
								items: ["Not part of the compact viewer."],
							},
						],
					}),
				);
				assert.equal(result.ok, true, result.error);
				fixtures.push({
					name: `${count}-columns`,
					html: result.html!,
					previewHtml: createArchifyPreviewHtml(result.html!),
				});
			}
			for (const example of [
				"agent-tool-call.workflow",
				"cache-miss-request.sequence",
				"product-analytics.dataflow",
				"agent-run.lifecycle",
			]) {
				const source = await readFile(
					path.join(packageRoot, "skills", "archify", "examples", `${example}.json`),
					"utf8",
				);
				const result = await service.render(source);
				assert.equal(result.ok, true, result.error);
				fixtures.push({
					name: example,
					html: result.html!,
					previewHtml: createArchifyPreviewHtml(result.html!),
				});
			}
			const fixturePath = path.join(root, "fixtures.json");
			await writeFile(fixturePath, JSON.stringify(fixtures));
			const require = createRequire(import.meta.url);
			const electron: string = require("electron");
			const env = { ...process.env };
			delete env.ELECTRON_RUN_AS_NODE;
			const output = execFileSync(
				electron,
				[path.join(packageRoot, "tests", "viewer-browser.cjs"), fixturePath],
				{ env, timeout: 150_000, encoding: "utf8" },
			);
			assert.match(output, /ARCHIFY_VIEWER_OK/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
