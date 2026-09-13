interface Rect { left: number; right: number; top: number; bottom: number }
interface Point { x: number; y: number }

/** Source, popup and the corridor between them are one hover region. */
export function inHoverRegion(point: Point, source: Rect, panel: Rect): boolean {
	const points = [source, panel].flatMap((r) => [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]).sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const half = (list: Point[]) => {
		const result: Point[] = [];
		for (const item of list) {
			while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], item) <= 0) result.pop();
			result.push(item);
		}
		return result.slice(0, -1);
	};
	const hull = [...half(points), ...half([...points].reverse())];
	return hull.every((item, index) => cross(item, hull[(index + 1) % hull.length], point) >= 0);
}
