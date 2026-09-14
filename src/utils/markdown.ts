const strongWithTrailingWhitespace = /(\*\*|__)([^\r\n]*?\S)([ \t]+)\1/g;

function normalizeStrongEmphasisInProse(value: string): string {
	return value.replace(strongWithTrailingWhitespace, (_match, delimiter: string, content: string, whitespace: string) =>
		`${delimiter}${content}${delimiter}${whitespace}`);
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
