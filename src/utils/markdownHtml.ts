import type { Element, Root } from "hast";
import type { PluggableList } from "unified";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

const headingAttributes = [
	"dataMarkdownHeadingId",
	"dataMarkdownHeadingLevel",
	"dataMarkdownHeadingText",
];

const markdownHtmlSchema: Options = {
	...defaultSchema,
	attributes: {
		...defaultSchema.attributes,
		code: [["className", /^language-./, "math-inline", "math-display"]],
		h1: headingAttributes,
		h2: [...(defaultSchema.attributes?.h2 ?? []), ...headingAttributes],
		h3: headingAttributes,
		h4: headingAttributes,
		h5: headingAttributes,
		h6: headingAttributes,
	},
};

function visitElements(parent: Root | Element, visit: (element: Element) => void): void {
	for (const child of parent.children) {
		if (child.type !== "element") continue;
		visit(child);
		visitElements(child, visit);
	}
}

/** Keep section metadata and fragment links aligned with the sanitizer's safe IDs. */
function rehypeSanitizedMarkdownIds() {
	return (tree: Root) => {
		const ids = new Map<string, string>();
		const prefix = defaultSchema.clobberPrefix ?? "";
		visitElements(tree, (element) => {
			const id = element.properties.id;
			if (typeof id !== "string") return;
			ids.set(id.slice(prefix.length), id);
			if (typeof element.properties.dataMarkdownHeadingId === "string") {
				element.properties.dataMarkdownHeadingId = id;
			}
		});
		visitElements(tree, (element) => {
			const href = element.properties.href;
			if (typeof href !== "string" || !href.startsWith("#")) return;
			const id = ids.get(href.slice(1));
			if (id) element.properties.href = `#${id}`;
		});
	};
}

// Sanitize before KaTeX and host-owned section markup add their trusted attributes.
export const markdownRehypePlugins: PluggableList = [
	rehypeRaw,
	[rehypeSanitize, markdownHtmlSchema],
	rehypeSanitizedMarkdownIds,
	rehypeKatex,
];
