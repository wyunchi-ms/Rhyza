import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root } from "hast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import {
	markdownHeadingSelector,
	rehypeMarkdownSections,
	remarkMarkdownSections,
	revealMarkdownHeadingEvent,
} from "../src/utils/markdownSections";

function renderTree(markdown: string, idPrefix = "test"): Root {
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkMarkdownSections, { idPrefix })
		.use(remarkRehype)
		.use(rehypeKatex)
		.use(rehypeMarkdownSections);
	return processor.runSync(processor.parse(markdown)) as Root;
}

function elements(parent: Root | Element, property: string): Element[] {
	return parent.children.flatMap((child) =>
		child.type === "element"
			? [...(child.properties[property] !== undefined ? [child] : []), ...elements(child, property)]
			: [],
	);
}

function sections(parent: Root | Element): Element[] {
	return elements(parent, "dataMarkdownSectionId");
}

function body(section: Element): Element {
	return section.children[1] as Element;
}

test("exports the renderer outline and reveal integration contract", () => {
	assert.equal(markdownHeadingSelector, "[data-markdown-heading-id]");
	assert.equal(revealMarkdownHeadingEvent, "rhyza:reveal-markdown-heading");
});

test("groups hierarchical sections through the next same or higher heading", () => {
	const tree = renderTree(
		"Intro\n\n# Parent\n\nParent body\n\n### Child\n\nChild body\n\n###### Deep\n\nDeep body\n\n### Sibling\n\nSibling body\n\n# Next\n\nNext body",
	);
	const [parent, child, deep, sibling, next] = sections(tree);
	assert.equal(tree.children[0].type, "element");
	assert.equal((tree.children[0] as Element).tagName, "p");
	assert.deepEqual(sections(body(parent)), [child, deep, sibling]);
	assert.deepEqual(sections(body(child)), [deep]);
	assert.deepEqual(sections(body(sibling)), []);
	assert.deepEqual(sections(body(next)), []);
	assert.ok(tree.children.includes(next));
	assert.equal(body(parent).properties.id, `${parent.properties.dataMarkdownSectionId}-body`);
});

test("uses parsed Setext headings, inline labels and unique IDs rather than code-fence text", () => {
	const tree = renderTree(
		[
			"Setext *title*",
			"=============",
			"",
			"## [Linked](https://example.com) **bold** `code` $x^2$ ![image](image.png)",
			"",
			"## Duplicate",
			"",
			"## Duplicate",
			"",
			"```markdown",
			"# Not a heading",
			"Fake Setext",
			"===========",
			"```",
			"",
			"~~~html-preview",
			'{"version":1,"path":"preview.html","title":"# Not a heading"}',
			"~~~",
			"",
			"```mermaid",
			"graph TD",
			'A["# Not a heading"]',
			"```",
			"",
			"<h1>Raw HTML is not a Markdown heading</h1>",
		].join("\n"),
	);
	const headings = elements(tree, "dataMarkdownHeadingId");
	assert.deepEqual(
		headings.map((heading) => heading.properties.dataMarkdownHeadingText),
		["Setext title", "Linked bold code x^2 image", "Duplicate", "Duplicate"],
	);
	assert.deepEqual(
		headings.map((heading) => heading.properties.dataMarkdownHeadingLevel),
		[1, 2, 2, 2],
	);
	assert.equal(new Set(headings.map((heading) => heading.properties.id)).size, 4);
	for (const heading of headings) {
		assert.equal(heading.properties.id, heading.properties.dataMarkdownHeadingId);
	}
	assert.ok(elements(tree, "href").length > 0);
	assert.ok(
		elements(tree, "className").some(
			(element) =>
				Array.isArray(element.properties.className) &&
				element.properties.className.includes("katex"),
		),
	);
});

test("heading IDs remain stable while streaming appends content and completes a title", () => {
	const before = elements(renderTree("# First\n\nBody\n\n## Grow"), "dataMarkdownHeadingId");
	const after = elements(
		renderTree("# First\n\nBody\n\n## Growing title\n\nMore content\n\n## New"),
		"dataMarkdownHeadingId",
	);
	assert.deepEqual(
		before.map((heading) => heading.properties.id),
		after.slice(0, 2).map((heading) => heading.properties.id),
	);
	assert.notEqual(
		elements(renderTree("# First", "other"), "dataMarkdownHeadingId")[0].properties.id,
		before[0].properties.id,
	);
});

test("headings within blockquotes and lists retain their block container", () => {
	const tree = renderTree(
		"> ## Quoted\n>\n> Quoted body\n\n- ### Listed\n\n  Listed body\n\nOutside",
	);
	const [quoted, listed] = sections(tree);
	const quote = tree.children[0] as Element;
	const list = tree.children.find(
		(node) => node.type === "element" && node.tagName === "ul",
	) as Element;
	assert.equal(quote.tagName, "blockquote");
	assert.ok(quote.children.includes(quoted));
	assert.ok((list.children[1] as Element).children.includes(listed));
	assert.equal((tree.children[tree.children.length - 1] as Element).tagName, "p");
});
