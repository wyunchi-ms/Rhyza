import assert from "node:assert/strict";
import test from "node:test";
import { isLightweightGreeting } from "../src/utils/promptWorkPolicy.js";

test("recognizes standalone greetings without hiding real requests", () => {
	for (const prompt of ["hi", "Hello!", "HEY!!!", "你好", "您好！", "嗨～", "早上好"]) {
		assert.equal(isLightweightGreeting(prompt), true, prompt);
	}

	for (const prompt of [
		"hi, explain this",
		"你好，请分析代码",
		"hey there can you help?",
		"hello.ts",
	]) {
		assert.equal(isLightweightGreeting(prompt), false, prompt);
	}
});

test("images and selected passages always use the full pipeline", () => {
	assert.equal(isLightweightGreeting("hi", { hasImages: true }), false);
	assert.equal(isLightweightGreeting("你好", { hasSelection: true }), false);
});
