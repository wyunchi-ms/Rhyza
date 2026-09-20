import assert from "node:assert/strict";
import test from "node:test";
import { distinctStorage } from "../src/utils/distinctStorage";

test("UI-only changes skip serialization; real edits and workspace switches save immediately", () => {
	let writes = 0;
	let scope: string | undefined = "workspace-a";
	const storage = distinctStorage(
		{
			getItem: () => null,
			setItem: () => {
				writes++;
			},
			removeItem: () => undefined,
		},
		() => scope,
	);
	const turns = [{ content: "saved" }];
	const value = { version: 2, state: { turns, activeSessionId: "a" } };
	storage.setItem("state", value);
	storage.setItem("state", { ...value, state: { ...value.state } });
	assert.equal(writes, 1);
	storage.setItem("state", { ...value, state: { ...value.state, turns: [...turns] } });
	assert.equal(writes, 2);
	scope = "workspace-b";
	storage.setItem("state", value);
	assert.equal(writes, 3);
	storage.getItem("state");
	storage.setItem("state", value);
	assert.equal(writes, 4);
	storage.removeItem("state");
	storage.setItem("state", value);
	assert.equal(writes, 5);
	scope = undefined;
	storage.setItem("state", value);
	storage.setItem("state", value);
	assert.equal(writes, 7, "Hydration/unknown workspace must bypass the cache");
});

test("failed saves are retried and older completions cannot overwrite newer cache state", async () => {
	let writes = 0;
	const rejectors: Array<(error: Error) => void> = [];
	const resolvers: Array<() => void> = [];
	const storage = distinctStorage(
		{
			getItem: () => null,
			setItem: () => {
				writes++;
				return new Promise<void>((resolve, reject) => {
					resolvers.push(resolve);
					rejectors.push(reject);
				});
			},
			removeItem: () => undefined,
		},
		() => "workspace",
	);
	const oldValue = { state: { id: 1 } };
	const newValue = { state: { id: 2 } };
	const first = storage.setItem("state", oldValue) as Promise<void>;
	assert.equal(storage.setItem("state", oldValue), first);
	const second = storage.setItem("state", newValue) as Promise<void>;
	rejectors[0](new Error("disk failure"));
	await assert.rejects(first, /disk failure/);
	assert.equal(storage.setItem("state", newValue), second);
	rejectors[1](new Error("disk failure"));
	await assert.rejects(second, /disk failure/);
	const retry = storage.setItem("state", newValue);
	assert.equal(writes, 3);
	resolvers[2]();
	await retry;
});
