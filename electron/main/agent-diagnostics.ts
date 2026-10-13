import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

type DiagnosticCounts = Record<string, number | boolean>;

export interface AgentDiagnosticEvent {
	timestamp: string;
	traceId: string;
	context: "prompt" | "title" | "extraction";
	frontendSessionId?: string;
	frontendTurnId?: string;
	stage: string;
	spanId?: string;
	status: "start" | "end" | "mark";
	elapsedMs: number;
	durationMs?: number;
	syncDispatchMs?: number;
	ok?: boolean;
	error?: string;
	counts?: DiagnosticCounts;
}

export type AgentDiagnosticWriter = (event: AgentDiagnosticEvent) => void;

/** A trace stores identifiers and timings only; never prompts, paths, or error messages. */
export class AgentDiagnosticTrace {
	private readonly traceId = randomUUID();
	private readonly startedAt = performance.now();

	constructor(
		private readonly write: AgentDiagnosticWriter,
		private readonly context: AgentDiagnosticEvent["context"],
		private readonly frontendSessionId?: string,
		private readonly frontendTurnId?: string,
	) {}

	mark(stage: string, counts?: DiagnosticCounts): void {
		this.emit(stage, "mark", { counts });
	}

	begin(stage: string, counts?: DiagnosticCounts): (ok: boolean) => void {
		const spanId = randomUUID();
		const startedAt = performance.now();
		this.emit(stage, "start", { spanId, counts });
		let finished = false;
		return (ok) => {
			if (finished) return;
			finished = true;
			this.emit(stage, "end", {
				spanId,
				counts,
				ok,
				durationMs: performance.now() - startedAt,
			});
		};
	}

	measure<T>(stage: string, action: () => T): T {
		const spanId = randomUUID();
		const startedAt = performance.now();
		this.emit(stage, "start", { spanId });
		try {
			const result = action();
			const durationMs = performance.now() - startedAt;
			this.emit(stage, "end", { spanId, durationMs, syncDispatchMs: durationMs, ok: true });
			return result;
		} catch (error) {
			const durationMs = performance.now() - startedAt;
			this.emit(stage, "end", {
				spanId,
				durationMs,
				syncDispatchMs: durationMs,
				ok: false,
				error: error instanceof Error ? error.name : "UnknownError",
			});
			throw error;
		}
	}

	async span<T>(stage: string, action: () => T | Promise<T>): Promise<T> {
		const spanId = randomUUID();
		const startedAt = performance.now();
		let syncDispatchMs: number | undefined;
		this.emit(stage, "start", { spanId });
		try {
			const pending = action();
			syncDispatchMs = performance.now() - startedAt;
			const result = await pending;
			this.emit(stage, "end", {
				spanId,
				durationMs: performance.now() - startedAt,
				syncDispatchMs,
				ok: true,
			});
			return result;
		} catch (error) {
			const durationMs = performance.now() - startedAt;
			this.emit(stage, "end", {
				spanId,
				durationMs,
				syncDispatchMs: syncDispatchMs ?? durationMs,
				ok: false,
				error: error instanceof Error ? error.name : "UnknownError",
			});
			throw error;
		}
	}

	private emit(
		stage: string,
		status: AgentDiagnosticEvent["status"],
		details: Partial<
			Pick<
				AgentDiagnosticEvent,
				"spanId" | "durationMs" | "syncDispatchMs" | "ok" | "error" | "counts"
			>
		> = {},
	): void {
		this.write({
			timestamp: new Date().toISOString(),
			traceId: this.traceId,
			context: this.context,
			frontendSessionId: this.frontendSessionId,
			frontendTurnId: this.frontendTurnId,
			stage,
			status,
			elapsedMs: performance.now() - this.startedAt,
			...details,
		});
	}
}
