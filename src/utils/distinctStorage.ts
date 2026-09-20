import type { PersistStorage, StorageValue } from "zustand/middleware";
import { shallow } from "zustand/vanilla/shallow";
import { measurePerformance } from "./performanceMarks";

/** Skip unchanged persisted slices before JSON serialization, without delaying real saves. */
export function distinctStorage<T>(
	storage: PersistStorage<T>,
	getScope: () => string | undefined,
): PersistStorage<T> {
	let previous:
		{ name: string; scope: string; value: StorageValue<T>; result: unknown } | undefined;
	return {
		getItem(name) {
			previous = undefined;
			return storage.getItem(name);
		},
		setItem(name, value) {
			const scope = getScope();
			if (
				scope !== undefined &&
				previous?.scope === scope &&
				previous.name === name &&
				previous.value.version === value.version &&
				shallow(previous.value.state, value.state)
			) {
				return previous.result;
			}
			const entry =
				scope === undefined ? undefined : { name, scope, value, result: undefined as unknown };
			previous = entry;
			try {
				const result = measurePerformance("state-persist-serialize-dispatch", () =>
					storage.setItem(name, value),
				);
				if (!entry) return result;
				entry.result =
					result instanceof Promise
						? result.catch((error: unknown) => {
								if (previous === entry) previous = undefined;
								throw error;
							})
						: result;
				return entry.result;
			} catch (error) {
				if (previous === entry) previous = undefined;
				throw error;
			}
		},
		removeItem(name) {
			previous = undefined;
			return storage.removeItem(name);
		},
	};
}
