const mermaidDeclaration = /^(?:---[\s\S]*?---\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|gitGraph|C4\w*|pie|quadrantChart|requirementDiagram|architecture-beta|block-beta|packet-beta|kanban|xychart-beta|sankey-beta)\b/i;

export function isMermaidCodeBlock(className: string | undefined, source: string): boolean {
	if (/(?:^|\s)language-mermaid(?:\s|$)/.test(className ?? "")) return true;
	return mermaidDeclaration.test(source.trim());
}
