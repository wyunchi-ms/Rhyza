import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root } from "hast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import { markdownRehypePlugins } from "../src/utils/markdownHtml";
import { rehypeMarkdownSections, remarkMarkdownSections } from "../src/utils/markdownSections";

function renderTree(markdown: string): Root {
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkMarkdownSections, { idPrefix: "test" })
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(markdownRehypePlugins)
		.use(rehypeMarkdownSections);
	return processor.runSync(processor.parse(markdown)) as Root;
}

function elements(parent: Root | Element): Element[] {
	return parent.children.flatMap((child) =>
		child.type === "element" ? [child, ...elements(child)] : [],
	);
}

test("renders native disclosure groups with formatted summaries and Markdown lists", () => {
	const tree = renderTree(
		[
			"<details>",
			"<summary><b>Region A (3 items)</b></summary>",
			"",
			"- `resource-one`",
			"- **Resource two**",
			"- [Resource three](https://example.com)",
			"",
			"<details open>",
			"<summary>Nested group</summary>",
			"",
			"Nested content.",
			"",
			"</details>",
			"",
			"</details>",
		].join("\n"),
	);
	const all = elements(tree);
	const details = all.filter((element) => element.tagName === "details");
	assert.equal(details.length, 2);
	assert.equal(details[0].properties.open, undefined);
	assert.equal(details[1].properties.open, true);
	assert.equal(elements(details[0]).filter((element) => element.tagName === "li").length, 3);
	assert.ok(
		elements(details[0]).some(
			(element) => element.tagName === "summary" && elements(element)[0]?.tagName === "b",
		),
	);
});

test("filters unsafe HTML, event attributes, styles and URL schemes", () => {
	const tree = renderTree(
		[
			'<details onclick="alert(1)" style="position:fixed" open>',
			'<summary onmouseover="alert(1)">Safe label</summary>',
			"",
			"<script>window.unsafeHtmlExecuted = true</script>",
			'<iframe src="https://example.com"></iframe>',
			"<style>body { display: none }</style>",
			'<img src="x" onerror="alert(1)">',
			'<a href="javascript:alert(1)">Unsafe link</a>',
			'<a href="https://example.com">Safe link</a>',
			"",
			"</details>",
		].join("\n"),
	);
	const all = elements(tree);
	assert.equal(
		all.some((element) => ["script", "iframe", "style"].includes(element.tagName)),
		false,
	);
	for (const element of all) {
		assert.ok(Object.keys(element.properties).every((property) => !/^on/i.test(property)));
		assert.equal(element.properties.style, undefined);
		assert.notEqual(element.properties.href, "javascript:alert(1)");
	}
	assert.ok(all.some((element) => element.properties.href === "https://example.com"));
});

test("preserves code fences, Mermaid, HTML preview declarations, math, tables and task lists", () => {
	const all = elements(
		renderTree(
			[
				"```html",
				"<details><summary>Literal example</summary></details>",
				"```",
				"",
				"```mermaid",
				"graph TD; A-->B",
				"```",
				"",
				"```html-preview",
				'{"version":1,"path":"preview.html"}',
				"```",
				"",
				"Inline $x^2$",
				"",
				"$$",
				"x^2",
				"$$",
				"",
				"| Column |",
				"| --- |",
				"| Value |",
				"",
				"- [x] Done",
			].join("\n"),
		),
	);
	assert.equal(
		all.some((element) => element.tagName === "details"),
		false,
	);
	for (const className of ["language-html", "language-mermaid", "language-html-preview"]) {
		assert.ok(
			all.some(
				(element) =>
					element.tagName === "code" &&
					Array.isArray(element.properties.className) &&
					element.properties.className.includes(className),
			),
		);
	}
	assert.ok(all.some((element) => element.tagName === "table"));
	assert.ok(all.some((element) => element.tagName === "input" && element.properties.disabled));
	for (const className of ["katex", "katex-display"]) {
		assert.ok(
			all.some(
				(element) =>
					Array.isArray(element.properties.className) &&
					element.properties.className.includes(className),
			),
		);
	}
});

test("keeps sanitized IDs aligned with Markdown sections, fragment links and footnotes", () => {
	const all = elements(
		renderTree(
			[
				"<details>",
				"<summary>Group</summary>",
				"",
				"## Hidden heading",
				"",
				"Body with a footnote[^note].",
				"",
				"</details>",
				"",
				'<a id="example"></a>',
				"",
				"[Jump](#example)",
				"",
				"[^note]: Footnote text",
			].join("\n"),
		),
	);
	const heading = all.find((element) => element.properties.dataMarkdownHeadingId);
	assert.ok(heading);
	assert.equal(heading.properties.id, "user-content-test-heading-0");
	assert.equal(heading.properties.dataMarkdownHeadingId, heading.properties.id);
	assert.ok(
		all.some((element) => element.properties.dataMarkdownSectionId === heading.properties.id),
	);
	assert.ok(all.some((element) => element.properties.id === `${heading.properties.id}-body`));
	const ids = new Set(all.map((element) => element.properties.id));
	for (const anchor of all.filter(
		(element) =>
			element.tagName === "a" &&
			typeof element.properties.href === "string" &&
			element.properties.href.startsWith("#"),
	)) {
		assert.ok(ids.has(String(anchor.properties.href).slice(1)));
	}
});
