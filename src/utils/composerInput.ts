const knowledgeReferencePattern = /\[@([^\]]+)\]\(#knowledge\/(entity|diagram)\/([^)]+)\)/g;

export function composeInput(draft: string, references: Array<{ raw: string }>): string {
	if (references.length === 0) return draft;
	const separator = draft.length === 0 ? "" : draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
	return `${draft}${separator}${references.map((reference) => reference.raw).join(" ")}`;
}

export function stripReferences(input: string): string {
	knowledgeReferencePattern.lastIndex = 0;
	const withoutReferences = input.replace(knowledgeReferencePattern, "");
	if (withoutReferences === input) return input;
	return withoutReferences.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimStart();
}
