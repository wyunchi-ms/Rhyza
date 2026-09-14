import assert from "node:assert/strict";
import test from "node:test";
import { formatChatTimestamp, formatFullChatTimestamp } from "../src/utils/chatTimestamp";

const options = {
	locale: "en-US",
	timeZone: "UTC",
	now: new Date("2026-09-14T12:00:00.000Z"),
};

test("formats today's chat timestamp as time only", () => {
	assert.equal(formatChatTimestamp("2026-09-14T09:05:00.000Z", options), "09:05 AM");
});

test("adds the date for older chat timestamps", () => {
	assert.equal(formatChatTimestamp("2026-09-12T09:05:00.000Z", options), "Sep 12, 09:05 AM");
	assert.equal(formatChatTimestamp("2025-09-12T09:05:00.000Z", options), "Sep 12, 2025, 09:05 AM");
});

test("provides a full timestamp for hover details", () => {
	assert.equal(
		formatFullChatTimestamp("2026-09-14T09:05:06.000Z", options),
		"Sep 14, 2026, 9:05:06 AM",
	);
});
