import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentPromptRequest } from "../../src/shared/ipc.js";

export type DiagramMode = NonNullable<AgentPromptRequest["diagramMode"]>;

/**
 * Rhyza's GPT/Pi adapter for the filesystem-only Archify skill. It mirrors the
 * DeepSeek Harness integration boundary: the host registers one skill root and
 * keeps model/network credentials and execution inside the existing agent.
 */
export class GptArchifyHarness {
	constructor(readonly skillRoot: string) {}

	get additionalSkillPaths(): string[] {
		return existsSync(path.join(this.skillRoot, "SKILL.md")) ? [this.skillRoot] : [];
	}

	wrapUserPrompt(prompt: string, mode: DiagramMode): string {
		return `<diagram_mode>${mode}</diagram_mode>\n\n${prompt}`;
	}

	get responseGuidance(): string {
		return `## Response presentation and diagram harness
- Each user prompt starts with a <diagram_mode> directive. It controls only diagrams; answer the user's actual question normally.
- When a diagram is useful and diagram_mode is "archify", load the registered Archify skill named "archify" and follow its Rhyza GPT Harness contract. Return the final validated specification as one fenced \`\`\`archify JSON block. Never return generated HTML, SVG, Mermaid, ASCII-art arrows, or a plain-text code block for that diagram.
- The \`archify\` fence is not a generic graph-JSON marker. Its root must contain \`"schema_version": 1\`, an exact \`"diagram_type"\` value from \`architecture|workflow|sequence|dataflow|lifecycle\`, and \`meta.title\`; generic roots such as \`type/nodes/edges\`, \`version/title/type/lanes/events\`, or a top-level \`title\` are invalid. Run the bundled validator and only fence the unchanged JSON after validation succeeds.
- Archify mode is intentionally slower and may use more tool calls and tokens. Prefer one bounded, polished diagram with at most 12 primary nodes over several noisy diagrams.
- When diagram_mode is "mermaid", use the original concise fenced \`\`\`mermaid flow. Choose the appropriate Mermaid declaration and design for a narrow reading pane, preferring top-to-bottom flowcharts.
- Do not add a diagram when prose or executable source code is clearer. Keep authored labels concise and preserve exact identifiers.`;
	}
}

export function resolveBundledArchifySkillRoot(options: {
	appPath: string;
	resourcesPath: string;
	isPackaged: boolean;
}): string {
	const candidates = options.isPackaged
		? [path.join(options.resourcesPath, "skills", "archify"), ...developmentCandidates(options.appPath)]
		: developmentCandidates(options.appPath);
	const resolved = [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
		.find((candidate) => existsSync(path.join(candidate, "SKILL.md")));
	if (resolved) return resolved;
	throw new Error(`Bundled Archify skill was not found. Checked: ${candidates.join(", ")}`);
}

function developmentCandidates(appPath: string): string[] {
	const candidates: string[] = [];
	let current = path.resolve(appPath);
	for (let depth = 0; depth < 6; depth += 1) {
		candidates.push(path.join(current, "resources", "skills", "archify"));
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return candidates;
}
