import assert from "node:assert/strict";
import test from "node:test";
import { composeInput, stripReferences } from "../src/utils/composerInput";

test("composer preserves spaces and newlines while typing", () => {
	assert.equal(composeInput("hello ", []), "hello ");
	assert.equal(stripReferences("  hello "), "  hello ");
	assert.equal(composeInput("hello\n", []), "hello\n");
	assert.equal(composeInput("first line\nsecond line", []), "first line\nsecond line");
});

test("composer keeps knowledge references separated from the visible draft", () => {
	const reference = "[@Context](#knowledge/entity/context)";
	const composed = composeInput("question", [{ raw: reference }]);
	assert.equal(composed, `question\n\n${reference}`);
	assert.equal(stripReferences(composed), "question\n\n");
});
