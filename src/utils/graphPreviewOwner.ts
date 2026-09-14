/** Coordinate pending and visible previews without changing the graph's node data. */
export function createGraphPreviewOwner() {
	let current: { id: string; close: () => void } | null = null;
	return {
		claim(id: string, close: () => void) {
			const previous = current;
			current = { id, close };
			if (previous && previous.id !== id) previous.close();
		},
		release(id: string) {
			if (current?.id === id) current = null;
		},
		owns(id: string) {
			return current?.id === id;
		},
		close() {
			const previous = current;
			current = null;
			previous?.close();
		},
	};
}
