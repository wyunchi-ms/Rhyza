/** Runtime-safe helpers shared by the renderer and Electron processes. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
