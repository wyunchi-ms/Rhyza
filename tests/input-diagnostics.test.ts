import assert from "node:assert/strict";
import test from "node:test";
import { createInputDiagnostics, inputEventStart } from "../src/utils/inputDiagnostics";
import {
	drainPerformanceTimings,
	measurePerformance,
	recordPerformanceTiming,
} from "../src/utils/performanceMarks";

function harness() {
	drainPerformanceTimings();
	let now = 100;
	let visible = true;
	const frames = new Set<() => void>();
	const tracker = createInputDiagnostics({
		now: () => now,
		timeOrigin: 1_000_000,
		visible: () => visible,
		afterFrame(callback) {
			frames.add(callback);
			return () => {
				frames.delete(callback);
			};
		},
	});
	return {
		tracker,
		frames,
		setNow(value: number) {
			now = value;
		},
		setVisible(value: boolean) {
			visible = value;
		},
		paint() {
			for (const callback of frames) callback();
			frames.clear();
		},
	};
}

test("input timings distinguish queue, handler, commit, and frame for batched IME/paste edits", () => {
	const h = harness();
	const finish = h.tracker.begin({ timeStamp: 80, isComposing: true });
	h.setNow(105);
	finish();
	finish();
	h.tracker.begin({ timeStamp: 103, inputType: "insertFromPaste" })();
	h.setNow(130);
	h.tracker.commit();
	h.tracker.commit();
	assert.equal(h.frames.size, 1);
	h.setNow(160);
	h.paint();
	const timings = drainPerformanceTimings();
	assert.equal(timings["composer-input-ime-queue"].maxMs, 20);
	assert.equal(timings["composer-input-ime-handler"].maxMs, 5);
	assert.equal(timings["composer-input-ime-handler"].count, 1);
	assert.equal(timings["composer-input-ime-to-commit"].maxMs, 30);
	assert.equal(timings["composer-input-ime-after-frame"].maxMs, 80);
	assert.equal(timings["composer-input-paste-after-frame"].maxMs, 57);
	assert.equal(Object.keys(timings).length, 8);
});

test("hidden documents and lifecycle reset do not report throttled frame latency", () => {
	const h = harness();
	h.tracker.begin({ timeStamp: 90 })();
	h.tracker.commit();
	h.setVisible(false);
	h.setNow(10_000);
	h.paint();
	assert.equal(drainPerformanceTimings()["composer-input-text-after-frame"], undefined);
	h.tracker.begin({ timeStamp: 90 })();
	h.tracker.commit();
	assert.equal(h.frames.size, 0);
	h.setVisible(true);
	h.tracker.begin({ timeStamp: 9999 })();
	h.tracker.commit();
	h.tracker.reset();
	assert.equal(h.frames.size, 0);
	// The same tracker remains usable after StrictMode effect cleanup.
	h.tracker.begin({ timeStamp: 9999 })();
	h.tracker.commit();
	h.paint();
	assert.equal(drainPerformanceTimings()["composer-input-text-after-frame"].count, 1);
});

test("input diagnostic buffers remain bounded when commits or frames stall", () => {
	const h = harness();
	for (let index = 0; index < 100; index++) h.tracker.begin({ timeStamp: 90 })();
	h.tracker.commit();
	h.paint();
	let timings = drainPerformanceTimings();
	assert.equal(timings["composer-input-text-after-frame"].count, 32);
	assert.equal(timings["composer-input-sample-dropped"].count, 68);
	for (let index = 0; index < 100; index++) {
		h.tracker.begin({ timeStamp: 90 })();
		h.tracker.commit();
	}
	assert.equal(h.frames.size, 32);
	timings = drainPerformanceTimings();
	assert.equal(timings["composer-input-frame-sample-dropped"].count, 68);
	h.tracker.reset();
});

test("event timestamps normalize epoch clocks and reject invalid or future values", () => {
	assert.equal(inputEventStart(1_000_080, 100, 1_000_000), 80);
	assert.equal(inputEventStart(80, 100, 1_000_000), 80);
	for (const timestamp of [0, -10, NaN, Infinity, 200]) {
		assert.equal(inputEventStart(timestamp, 100, 1_000_000), 100);
	}
});

test("aggregate thresholds survive drain without storing samples and measurement preserves errors", () => {
	drainPerformanceTimings();
	for (const duration of [0, 16, 17, 50, 51, 100, 101, NaN, -1]) {
		recordPerformanceTiming("test", duration);
	}
	const timing = drainPerformanceTimings().test;
	assert.equal(timing.count, 7);
	assert.equal(timing.over16Ms, 5);
	assert.equal(timing.over50Ms, 3);
	assert.equal(timing.over100Ms, 1);
	assert.deepEqual(drainPerformanceTimings(), {});
	const error = new Error("expected");
	assert.throws(
		() =>
			measurePerformance("throw", () => {
				throw error;
			}),
		error,
	);
	assert.equal(
		measurePerformance("return", () => 42),
		42,
	);
	assert.equal(drainPerformanceTimings().throw.count, 1);
});
