const maxStoredToolOutputLength = 50_000;
const ansiEscapePattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const warningLinePattern = /(?:^|\n)\s*(?:npm\s+warn\b|warn(?:ing)?\s*:|found\s+\d+\s+warnings?\b)/i;

export function extractToolOutput(result: unknown): string | undefined {
	const text = extractResultText(result).trim();
	if (!text) return undefined;
	if (text.length <= maxStoredToolOutputLength) return text;
	return `${text.slice(0, maxStoredToolOutputLength)}\n\n… Output truncated after ${maxStoredToolOutputLength.toLocaleString()} characters.`;
}

export function toolResultHasWarning(result: unknown, output: string | undefined): boolean {
	if (hasStructuredWarning(result)) return true;
	return Boolean(output && warningLinePattern.test(output.replace(ansiEscapePattern, "")));
}

function hasStructuredWarning(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (record.warning === true || (Array.isArray(record.warnings) && record.warnings.length > 0)) return true;
	return hasStructuredWarning(record.details);
}

function extractResultText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(extractResultText).filter(Boolean).join("\n");
	if (!value || typeof value !== "object") return value === undefined || value === null ? "" : String(value);

	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") return record.text;
	if (Array.isArray(record.content)) {
		const content = record.content.map(extractResultText).filter(Boolean).join("\n");
		if (content) return content;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
