import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "../src/utils/common.js";

test("withTimeout invokes cancellation before rejecting", async () => {
	let canceled = false;
	await assert.rejects(
		withTimeout(new Promise<never>(() => {}), 5, "Auxiliary request", () => {
			canceled = true;
		}),
		/Auxiliary request timed out/,
	);
	assert.equal(canceled, true);
});
