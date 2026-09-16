import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { generateDiagramFiles } from "./output.js";

export const authoringGuidance = `## Diagram extension
When a diagram helps, use the installed archify skill and the archify_render tool instead of the default Mermaid presentation.
Author a schema_version: 1 JSON specification with an exact diagram_type (architecture, workflow, sequence, dataflow, lifecycle), meta.title, and the corresponding typed nodes/connections. Read the skill's schemas/examples as needed.
Call archify_render with the JSON specification. The tool validates and renders it, writes a reproducible .mjs script, the validated .json specification, and a self-contained .html page in the session workspace.
On success, include the tool's html-preview fenced JSON block unchanged in the final answer. This is a generic HTML file reference, not a diagram specification. Never fence raw Archify JSON or paste HTML into the final answer.
On failure, correct the reported specification and retry. If delivery remains unavailable, explain the error and use Mermaid only as a fallback or when the user explicitly requests it. Do not claim a preview was created unless the tool succeeded.`;

export default function archifyExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${authoringGuidance}`,
	}));
	pi.registerTool({
		name: "archify_render",
		label: "Generate HTML diagram",
		description:
			"Validate an Archify JSON specification and generate its HTML file, JSON source, and replay script. Returns a generic html-preview reference for the final answer.",
		parameters: Type.Object({
			specification: Type.String({
				description:
					"Complete Archify JSON specification conforming to the installed skill's schema_version 1.",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Diagram generation canceled.");
			const result = await generateDiagramFiles(params.specification, ctx.cwd);
			return { content: [{ type: "text", text: result.message }], details: result };
		},
	});
}
