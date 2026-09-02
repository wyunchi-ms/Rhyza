export interface RankableSourceEvidence {
	path: string;
	line?: number;
	preview?: string;
}

const implementationExtensions = new Set([
	".c", ".cc", ".cpp", ".cs", ".go", ".h", ".java", ".js", ".jsx", ".kt", ".mjs", ".py", ".rs", ".sql", ".swift", ".ts", ".tsx",
]);

/** Scores whether a path is likely to be an authoritative implementation source. */
export function sourcePathAuthority(path: string): number {
	const normalized = path.replace(/\\/g, "/").toLocaleLowerCase();
	const fileName = normalized.split("/").pop() ?? normalized;
	if (fileName === "skill.md" || fileName === "agents.md") return -120;
	if (/(^|\/)(\.agents|\.codex|\.pi|skills?)(\/|$)/.test(normalized)) return -70;
	if (/(^|\/)(node_modules|dist|build|coverage|vendor|generated)(\/|$)/.test(normalized)) return -90;
	if (/\.(lock|min\.js|min\.css|map)$/.test(fileName)) return -55;
	if (/(^|\/)(schema|schemas|migrations?)(\/|$)/.test(normalized)) return 38;
	if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile|compose\.ya?ml)$/.test(fileName)) return 34;
	const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
	if (implementationExtensions.has(extension)) return /(^|\/)(tests?|__tests__)(\/|$)/.test(normalized) ? 16 : 30;
	if (fileName.startsWith("readme")) return 12;
	if (/(^|\/)docs?(\/|$)/.test(normalized)) return 8;
	if ([".json", ".toml", ".yaml", ".yml", ".xml"].includes(extension)) return 15;
	if (extension === ".md" || extension === ".txt") return 2;
	return 0;
}

/** Ranks evidence by authority and lexical relevance, with at most two hits per file. */
export function rankSourceEvidence<T extends RankableSourceEvidence>(items: T[], query: string, limit: number): T[] {
	const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 2).slice(0, 16);
	const instructionFilesRequested = terms.some((term) => term === "skill" || term === "skill.md" || term === "agents" || term === "agents.md");
	const scored = items.map((item, index) => {
		const normalizedPath = item.path.replace(/\\/g, "/").toLocaleLowerCase();
		const preview = item.preview?.toLocaleLowerCase() ?? "";
		const authority = sourcePathAuthority(item.path);
		const relevance = terms.reduce((score, term) => score + (normalizedPath.includes(term) ? 10 : 0) + (preview.includes(term) ? 4 : 0), 0);
		const requestedInstructionBoost = instructionFilesRequested && authority <= -70 ? 140 : 0;
		return { item, index, authority, score: authority + relevance + requestedInstructionBoost };
	});
	const hasNonInstructionalEvidence = scored.some(({ authority }) => authority > -55);
	const candidates = hasNonInstructionalEvidence && !instructionFilesRequested
		? scored.filter(({ authority }) => authority > -55)
		: scored;
	candidates.sort((left, right) => right.score - left.score || left.index - right.index);
	const pathCounts = new Map<string, number>();
	const seen = new Set<string>();
	const result: T[] = [];
	for (const { item } of candidates) {
		const pathKey = item.path.replace(/\\/g, "/").toLocaleLowerCase();
		const key = `${pathKey}:${item.line ?? ""}`;
		if (seen.has(key) || (pathCounts.get(pathKey) ?? 0) >= 2) continue;
		seen.add(key);
		pathCounts.set(pathKey, (pathCounts.get(pathKey) ?? 0) + 1);
		result.push(item);
		if (result.length >= limit) break;
	}
	return result;
}
