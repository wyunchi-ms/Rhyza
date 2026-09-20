export type ComposerTrigger = {
	start: number;
	end: number;
	query: string;
	kind: "mention" | "command";
	page?: "model" | "thinking" | "provider";
};

/** Only standalone triggers count; emails, URLs and paths are ordinary text. */
export function getComposerTrigger(value: string, caret: number): ComposerTrigger | null {
	const command = /(^|\s)\/(model|reasoning|provider) ([^@/\n]*)$/.exec(value.slice(0, caret));
	if (command) {
		return {
			start: caret - command[0].length + command[1].length,
			end: caret,
			kind: "command",
			page: command[2] === "reasoning" ? "thinking" : (command[2] as "model" | "provider"),
			query: command[3],
		};
	}
	const match = /(^|\s)([@/])([^\s@/]*)$/.exec(value.slice(0, caret));
	if (!match) return null;
	return {
		start: caret - match[3].length - 1,
		end: caret,
		query: match[3],
		kind: match[2] === "@" ? "mention" : "command",
	};
}

export function filterComposerItems<T extends { name: string; detail: string; keywords?: string }>(
	items: T[],
	query: string,
): T[] {
	const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
	return items.filter((item) => {
		const text = `${item.name} ${item.detail} ${item.keywords ?? ""}`.toLocaleLowerCase();
		return terms.every((term) => text.includes(term));
	});
}
