import assert from "node:assert/strict";
import test from "node:test";
import { RequestScheduler } from "../src/utils/requestScheduler";

test("jobs sharing a session key never overlap while other sessions may run", async () => {
	const scheduler = new RequestScheduler();
	scheduler.setLimit(2);
	const releaseFirst = deferred<void>();
	const firstStarted = deferred<void>();
	const events: string[] = [];

	const first = scheduler.enqueue("session-a", async () => {
		events.push("first:start");
		firstStarted.resolve();
		await releaseFirst.promise;
		events.push("first:end");
	});
	await firstStarted.promise;
	const second = scheduler.enqueue("session-a", async () => { events.push("second:start"); });
	const other = scheduler.enqueue("session-b", async () => { events.push("other:start"); });

	await other;
	assert.deepEqual(events, ["first:start", "other:start"]);
	releaseFirst.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(events, ["first:start", "other:start", "first:end", "second:start"]);
});

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
