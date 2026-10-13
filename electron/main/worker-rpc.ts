import { isRecord } from "../../src/shared/value.js";

type Contract<T> = { [K in keyof T]: (...args: never[]) => unknown };
type Arguments<T> = T extends (...args: infer A) => unknown ? A : never;
type Result<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never;

export interface RpcPort {
	postMessage(message: unknown): void;
	on(event: "message", listener: (message: unknown) => void): unknown;
	off(event: "message", listener: (message: unknown) => void): unknown;
}

/** Internal, correlated RPC. Renderer access remains behind Main's sender validation. */
export class WorkerRpc<Remote extends Contract<Remote>, Local extends Contract<Local>> {
	private nextId = 0;
	private failure?: Error;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
		}
	>();

	constructor(
		private readonly port: RpcPort,
		private readonly handlers: Local,
		private readonly onEvent: (event: unknown) => void = () => {},
	) {
		port.on("message", this.receive);
	}

	method<K extends keyof Remote & string>(method: K) {
		return (...args: Arguments<Remote[K]>): Promise<Result<Remote[K]>> =>
			this.call(method, ...args);
	}

	call<K extends keyof Remote & string>(
		method: K,
		...args: Arguments<Remote[K]>
	): Promise<Result<Remote[K]>> {
		if (this.failure) return Promise.reject(this.failure);
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as Result<Remote[K]>),
				reject,
			});
			try {
				this.port.postMessage({ type: "request", id, method, args });
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	emit(event: unknown): void {
		if (!this.failure) this.port.postMessage({ type: "event", event });
	}

	close(error = new Error("Background service closed.")): void {
		if (this.failure) return;
		this.failure = error;
		this.port.off("message", this.receive);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private readonly receive = (message: unknown): void => {
		if (!isRecord(message)) return;
		if (message.type === "event") {
			this.onEvent(message.event);
			return;
		}
		if (typeof message.id !== "number") return;
		if (message.type === "response") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (isRecord(message.error)) {
				const error = new Error(
					typeof message.error.message === "string"
						? message.error.message
						: "Background service failed.",
				);
				if (typeof message.error.name === "string") error.name = message.error.name;
				pending.reject(error);
			} else {
				pending.resolve(message.value);
			}
			return;
		}
		if (message.type === "request") void this.respond(message);
	};

	private async respond(message: Record<string, unknown>): Promise<void> {
		try {
			if (
				typeof message.method !== "string" ||
				!Object.hasOwn(this.handlers, message.method) ||
				!Array.isArray(message.args)
			) {
				throw new Error("Unknown background service operation.");
			}
			const handler = this.handlers[message.method as keyof Local];
			if (typeof handler !== "function") throw new Error("Invalid background service operation.");
			const value: unknown = await Reflect.apply(handler, undefined, message.args);
			if (!this.failure) this.port.postMessage({ type: "response", id: message.id, value });
		} catch (error) {
			if (!this.failure) {
				this.port.postMessage({
					type: "response",
					id: message.id,
					error: {
						name: error instanceof Error ? error.name : "Error",
						message: error instanceof Error ? error.message : String(error),
					},
				});
			}
		}
	}
}
