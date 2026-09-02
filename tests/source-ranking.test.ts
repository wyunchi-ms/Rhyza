import assert from "node:assert/strict";
import test from "node:test";
import { rankSourceEvidence, sourcePathAuthority } from "../src/shared/source-ranking.ts";

test("implementation sources outrank and replace incidental skill matches", () => {
	const ranked = rankSourceEvidence([
		{ path: "src/$REAgent/skills/verify-root-cause/SKILL.md", line: 9, preview: "verify root cause" },
		{ path: "src/runtime/verifyRootCause.ts", line: 42, preview: "export function verifyRootCause" },
		{ path: "tests/verify-root-cause.test.ts", line: 12, preview: "verifyRootCause" },
	], "verify root cause", 10);
	assert.deepEqual(ranked.map(({ path }) => path), [
		"src/runtime/verifyRootCause.ts",
		"tests/verify-root-cause.test.ts",
	]);
	assert.ok(sourcePathAuthority("src/runtime/verifyRootCause.ts") > sourcePathAuthority("skills/check/SKILL.md"));
});

test("instruction files remain searchable when explicitly requested", () => {
	const ranked = rankSourceEvidence([
		{ path: "skills/check/SKILL.md", line: 1, preview: "Check skill" },
		{ path: "src/check.ts", line: 1, preview: "Check implementation" },
	], "check SKILL.md", 10);
	assert.equal(ranked[0].path, "skills/check/SKILL.md");
});

test("ranked evidence limits duplicate lines from one file", () => {
	const ranked = rankSourceEvidence([
		{ path: "src/check.ts", line: 1 },
		{ path: "src/check.ts", line: 2 },
		{ path: "src/check.ts", line: 3 },
	], "check", 10);
	assert.equal(ranked.length, 2);
});
