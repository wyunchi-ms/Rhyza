import type { Element, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";

export const markdownHeadingSelector = "[data-markdown-heading-id]";
export const revealMarkdownHeadingEvent = "rhyza:reveal-markdown-heading";

function headingText(node: MarkdownNode): string {
	if (node.type === "html") return "";
	if (node.type === "break") return " ";
	if ("value" in node) return node.value;
	if ("alt" in node) return node.alt ?? "";
	if ("children" in node) return node.children.map(headingText).join("");
	return "";
}

/** Mark parsed headings before KaTeX expands inline math into presentation markup. */
export function remarkMarkdownSections({ idPrefix }: { idPrefix: string }) {
	return (tree: MarkdownRoot) => {
		let headingIndex = 0;
		const visit = (node: MarkdownNode) => {
			if (node.type === "heading") {
				// Ordinals stay stable when a streamed heading's text grows or titles repeat.
				const id = `${idPrefix}-heading-${headingIndex++}`;
				node.data = {
					...node.data,
					hProperties: {
						...node.data?.hProperties,
						id,
						dataMarkdownHeadingId: id,
						dataMarkdownHeadingLevel: node.depth,
						dataMarkdownHeadingText: headingText(node).replace(/\s+/g, " ").trim(),
					},
				};
			}
			if ("children" in node) node.children.forEach(visit);
		};
		visit(tree);
	};
}

/** Fold siblings within their existing block container, preserving lists and blockquotes. */
export function rehypeMarkdownSections() {
	return (tree: HastRoot) => {
		const group = (parent: HastRoot | Element) => {
			for (const child of parent.children) {
				if (child.type === "element") group(child);
			}
			const children: HastContent[] = [];
			const sections: { level: number; body: Element }[] = [];
			for (const child of parent.children) {
				if (child.type === "doctype") {
					children.push(child);
					continue;
				}
				const id = child.type === "element" && child.properties.dataMarkdownHeadingId;
				const level = child.type === "element" && Number(child.properties.dataMarkdownHeadingLevel);
				if (typeof id === "string" && level && level >= 1 && level <= 6) {
					while (sections.length && sections[sections.length - 1].level >= level) {
						sections.pop();
					}
					const body: Element = {
						type: "element",
						tagName: "div",
						properties: {
							id: `${id}-body`,
							dataMarkdownSectionBody: id,
							className: ["markdown-section-body"],
						},
						children: [],
					};
					const section: Element = {
						type: "element",
						tagName: "section",
						properties: {
							dataMarkdownSectionId: id,
							className: ["markdown-section"],
						},
						children: [child, body],
					};
					(sections[sections.length - 1]?.body.children ?? children).push(section);
					sections.push({ level, body });
				} else {
					(sections[sections.length - 1]?.body.children ?? children).push(child);
				}
			}
			parent.children = children as typeof parent.children;
		};
		group(tree);
	};
}
