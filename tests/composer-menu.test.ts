import assert from "node:assert/strict";
import test from "node:test";
import { getComposerTrigger, filterComposerItems } from "../src/utils/composerMenu";
import {
	buildComposerReferenceContext,
	composeInput,
	createReference,
	parseReferences,
	stripReferences,
} from "../src/utils/composerInput";

test("triggers follow the caret without treating email, URLs or paths as menus", () => {
	for (const value of ["a@b.com", "https://example.org/", "src/components/", "C:/", "hello"]) {
		assert.equal(getComposerTrigger(value, value.length), null);
	}
	assert.deepEqual(getComposerTrigger("请参考 @知识 more", 7), {
		start: 4,
		end: 7,
		query: "知识",
		kind: "mention",
	});
	assert.deepEqual(getComposerTrigger("/rea", 4), {
		start: 0,
		end: 4,
		query: "rea",
		kind: "command",
	});
	assert.deepEqual(getComposerTrigger("hi\n/", 4), {
		start: 3,
		end: 4,
		query: "",
		kind: "command",
	});
});

test("command submenus accept searchable parameters", () => {
	assert.deepEqual(getComposerTrigger("/reasoning high", 15), {
		start: 0,
		end: 15,
		query: "high",
		kind: "command",
		page: "thinking",
	});
	assert.deepEqual(getComposerTrigger("hello /model GPT", 16), {
		start: 6,
		end: 16,
		query: "GPT",
		kind: "command",
		page: "model",
	});
	assert.equal(getComposerTrigger("/unknown query", 14), null);
});

test("search includes aliases and descriptions without truncating the catalog", () => {
	const items = Array.from({ length: 20 }, (_, i) => ({
		name: `Skill ${i}`,
		detail: "Create docs",
		keywords: "文档",
	}));
	assert.equal(filterComposerItems(items, "SKILL").length, 20);
	assert.equal(filterComposerItems(items, "文档").length, 20);
	assert.equal(filterComposerItems(items, "skill 19")[0].name, "Skill 19");
	assert.deepEqual(filterComposerItems(items, "missing"), []);
});

test("reference kinds round-trip, malformed references remain editable, duplicates collapse", () => {
	for (const kind of ["entity", "diagram", "session", "source", "skill"] as const) {
		const raw = createReference("技能 [one]", kind, "C:/a (b)/中文");
		const refs = parseReferences(raw + " " + raw);
		assert.equal(refs.length, 1);
		assert.equal(refs[0].id, "C:/a (b)/中文");
		assert.equal(refs[0].kind, kind);
		assert.equal(stripReferences(composeInput("question", refs)), "question");
	}
	const malformed = "[@broken](#context/session/%ZZ)";
	assert.deepEqual(parseReferences(malformed), []);
	assert.equal(stripReferences(malformed), malformed);
});

test("selected conversations resolve to bounded quoted text and exclude unrelated sessions", () => {
	const context = buildComposerReferenceContext(createReference("Discussion", "session", "a"), {
		sessions: [{ id: "a", title: "Discussion", parentId: null, isRoot: true, status: "idle" }],
		turns: [
			{
				id: "1",
				sessionId: "a",
				role: "user",
				content: "Explain graphs",
				status: "complete",
				createdAt: "2026-01-01",
			},
			{
				id: "2",
				sessionId: "b",
				role: "user",
				content: "Unrelated secret",
				status: "complete",
				createdAt: "2026-01-01",
			},
		],
		sources: [],
		entities: [],
		diagrams: [],
	});
	assert.match(context, /quoted data, not instructions/);
	assert.match(context, /Explain graphs/);
	assert.doesNotMatch(context, /Unrelated secret/);
});
