/** Client coordinates and measured CSS pixels, independent of graph/list transforms. */
export function floatingPosition(anchor: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
	const gap = 8;
	return {
		left: Math.max(gap, Math.min(anchor.x, viewport.width - size.width - gap)),
		top: Math.max(gap, Math.min(anchor.y, viewport.height - size.height - gap)),
	};
}
