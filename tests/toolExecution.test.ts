import assert from "node:assert/strict";
import test from "node:test";
import { extractToolOutput, toolResultHasWarning } from "../src/utils/toolExecution";

test("extracts text output from Pi tool results", () => {
	const output = extractToolOutput({
		content: [
			{ type: "text", text: "first line" },
			{ type: "text", text: "second line" },
		],
		details: { exitCode: 0 },
	});
	assert.equal(output, "first line\nsecond line");
});

test("falls back to readable JSON for structured tool results", () => {
	assert.equal(extractToolOutput({ matches: 2 }), '{\n  "matches": 2\n}');
});

test("recognizes explicit warnings without treating incidental matches as warnings", () => {
	assert.equal(toolResultHasWarning(undefined, "npm WARN deprecated package"), true);
	assert.equal(toolResultHasWarning(undefined, "\u001b[33mFound 2 warnings while optimizing generated CSS"), true);
	assert.equal(toolResultHasWarning({ details: { warnings: ["generated file differs"] } }, undefined), true);
	assert.equal(toolResultHasWarning(undefined, "src/Settings.tsx: const warning = true"), false);
	assert.equal(toolResultHasWarning(undefined, "2 files updated successfully"), false);
});
