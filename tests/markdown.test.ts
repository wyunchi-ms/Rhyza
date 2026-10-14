import assert from "node:assert/strict";
import test from "node:test";
import {
	isMarkdownCodeBlock,
	normalizeMarkdownEmphasis,
	normalizeMarkdownMathDelimiters,
} from "../src/utils/markdown";

test("unlabelled fenced headings and tables render as Markdown without reinterpreting code languages", () => {
	const source = "### 核心组件\n\n| 组件 | 职责 |\n|---|---|\n| `Worker` | 处理消息 |";
	assert.equal(isMarkdownCodeBlock(undefined, source), true);
	assert.equal(isMarkdownCodeBlock("language-markdown", "## Title"), true);
	assert.equal(isMarkdownCodeBlock("language-MD", "## Title"), true);
	for (const language of ["language-js", "language-python", "language-text", "language-json"]) {
		assert.equal(isMarkdownCodeBlock(language, source), false);
	}
	for (const plainCode of [
		"### Python comment\nprint('hello')",
		"A | B\n--- | ---",
		"### Heading only",
		"console.log('hi')",
	]) {
		assert.equal(isMarkdownCodeBlock(undefined, plainCode), false);
	}
});

test("moves trailing whitespace outside strong emphasis delimiters", () => {
	assert.equal(
		normalizeMarkdownEmphasis("**前端开发服务器 (frontend dev server) **是本地服务"),
		"**前端开发服务器 (frontend dev server)** 是本地服务",
	);
	assert.equal(normalizeMarkdownEmphasis("__important __text"), "__important__ text");
});

test("preserves correctly formatted emphasis and code verbatim", () => {
	const markdown = [
		"**already valid** text",
		'`const marker = "**raw **";`',
		"```md",
		"**leave code unchanged **",
		"```",
	].join("\n");

	assert.equal(normalizeMarkdownEmphasis(markdown), markdown);
});

test("normalizes LaTeX delimiters outside Markdown code spans", () => {
	const markdown = [
		"传统写法：\\[P(\\text{下一个 token}\\mid\\text{前文})\\]",
		"行内写法：\\(x^2 + y^2\\)",
		"`\\[not math\\]`",
		"```tex",
		"\\[leave code unchanged\\]",
		"```",
	].join("\n");

	assert.equal(
		normalizeMarkdownMathDelimiters(markdown),
		[
			"传统写法：",
			"$$",
			"P(\\text{下一个 token}\\mid\\text{前文})",
			"$$",
			"",
			"行内写法：$x^2 + y^2$",
			"`\\[not math\\]`",
			"```tex",
			"\\[leave code unchanged\\]",
			"```",
		].join("\n"),
	);
});
