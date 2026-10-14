const strongWithTrailingWhitespace = /(\*\*|__)([^\r\n]*?\S)([ \t]+)\1/g;

export function isMarkdownCodeBlock(className: string | undefined, source: string): boolean {
	if (/(?:^|\s)language-(?:md|markdown)(?:\s|$)/i.test(className ?? "")) return true;
	if (className?.trim() || !/^ {0,3}#{1,6}[ \t]+\S/m.test(source)) return false;
	const lines = source.split(/\r?\n/);
	return lines.some((line, index) => {
		if (!index || !line.includes("|") || !lines[index - 1].includes("|")) return false;
		const cells = line
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => cell.trim());
		return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
	});
}

function normalizeStrongEmphasisInProse(value: string): string {
	return value.replace(
		strongWithTrailingWhitespace,
		(_match, delimiter: string, content: string, whitespace: string) =>
			`${delimiter}${content}${delimiter}${whitespace}`,
	);
}

export function normalizeMarkdownEmphasis(markdown: string): string {
	let result = "";
	let proseStart = 0;
	let cursor = 0;

	while (cursor < markdown.length) {
		if (markdown[cursor] !== "`") {
			cursor += 1;
			continue;
		}

		let delimiterLength = 1;
		while (markdown[cursor + delimiterLength] === "`") delimiterLength += 1;
		const delimiter = "`".repeat(delimiterLength);
		const closingIndex = markdown.indexOf(delimiter, cursor + delimiterLength);

		if (closingIndex === -1) {
			cursor += delimiterLength;
			continue;
		}

		result += normalizeStrongEmphasisInProse(markdown.slice(proseStart, cursor));
		result += markdown.slice(cursor, closingIndex + delimiterLength);
		cursor = closingIndex + delimiterLength;
		proseStart = cursor;
	}

	return result + normalizeStrongEmphasisInProse(markdown.slice(proseStart));
}

function normalizeLegacyMathDelimitersInProse(value: string): string {
	return value
		.replace(/\\\[/g, () => "\n$$\n")
		.replace(/\\\]/g, () => "\n$$\n")
		.replace(/\\\(/g, "$")
		.replace(/\\\)/g, "$");
}

/** Convert the LaTeX delimiters commonly emitted by chat models to remark-math syntax. */
export function normalizeMarkdownMathDelimiters(markdown: string): string {
	let result = "";
	let proseStart = 0;
	let cursor = 0;

	while (cursor < markdown.length) {
		if (markdown[cursor] !== "`") {
			cursor += 1;
			continue;
		}

		let delimiterLength = 1;
		while (markdown[cursor + delimiterLength] === "`") delimiterLength += 1;
		const delimiter = "`".repeat(delimiterLength);
		const closingIndex = markdown.indexOf(delimiter, cursor + delimiterLength);

		if (closingIndex === -1) {
			cursor += delimiterLength;
			continue;
		}

		result += normalizeLegacyMathDelimitersInProse(markdown.slice(proseStart, cursor));
		result += markdown.slice(cursor, closingIndex + delimiterLength);
		cursor = closingIndex + delimiterLength;
		proseStart = cursor;
	}

	return result + normalizeLegacyMathDelimitersInProse(markdown.slice(proseStart));
}
