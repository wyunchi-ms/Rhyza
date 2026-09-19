export function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function summarize(value: string): string {
	const firstLine = value.trim().split(/\r?\n/)[0] ?? "Untitled";
	return firstLine.length > 36 ? `${firstLine.slice(0, 33)}...` : firstLine;
}

export function formatDuration(durationMs: number): string {
	return durationMs < 1_000
		? `${durationMs}ms`
		: `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
	onTimeout?: () => void | Promise<void>,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => {
					try {
						void Promise.resolve(onTimeout?.()).catch(() => {});
					} catch {
						// Timeout remains authoritative even if best-effort cancellation fails.
					}
					reject(new Error(`${label} timed out after ${formatDuration(timeoutMs)}.`));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
