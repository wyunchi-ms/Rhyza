interface Rect { left: number; top: number; right: number; bottom: number }

/** Keep previews inside the visible graph, including partially clipped nodes. */
export function graphPreviewPosition(anchor: Rect, graph: Rect, viewport: { width: number; height: number }) {
	const margin = 12;
	const gap = 10;
	const left = Math.max(0, graph.left) + margin;
	const top = Math.max(0, graph.top) + margin;
	const right = Math.min(viewport.width, graph.right) - margin;
	const bottom = Math.min(viewport.height, graph.bottom) - margin;
	const width = Math.max(0, Math.min(380, right - left));
	const height = Math.max(0, Math.min(420, bottom - top));
	const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
	const node = { left: clamp(anchor.left, left, right), right: clamp(anchor.right, left, right),
		top: clamp(anchor.top, top, bottom), bottom: clamp(anchor.bottom, top, bottom) };
	const sides = [
		{ left: node.right + gap, top: clamp(node.top, top, bottom - height), width: right - node.right - gap, height: bottom - top },
		{ left: node.left - gap - width, top: clamp(node.top, top, bottom - height), width: node.left - gap - left, height: bottom - top },
		{ left: clamp(node.left, left, right - width), top: node.bottom + gap, width: right - left, height: bottom - node.bottom - gap },
		{ left: clamp(node.left, left, right - width), top: Math.max(top, node.top - gap - height), width: right - left, height: node.top - gap - top },
	];
	// Prefer a full-size adjacent placement; otherwise use the tallest space
	// that preserves readable text width. A crowded graph permits bounded overlap.
	const candidates = sides.filter((side) => side.width >= width && side.height >= Math.min(120, height));
	const side = candidates.find((candidate) => candidate.height >= height)
		?? candidates.sort((a, b) => b.height - a.height)[0];
	if (side) {
		const maxHeight = Math.min(height, side.height);
		return { left: clamp(side.left, left, right - width), top: clamp(side.top, top, bottom - maxHeight), width, maxHeight };
	}
	return { left: clamp(node.left, left, right - width), top: clamp(node.bottom + gap, top, bottom - height), width, maxHeight: height };
}
