type Job<T> = { key: string; run: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

/** Limits agent work globally while keeping requests in one session ordered. */
export class RequestScheduler {
	private limit = 5;
	private active = 0;
	private activeKeys = new Set<string>();
	private queues = new Map<string, Job<unknown>[]>();

	setLimit(value: number): void {
		this.limit = Math.min(10, Math.max(1, Math.round(value) || 5));
		this.drain();
	}

	enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const queue = this.queues.get(key) ?? [];
			queue.push({ key, run, resolve: resolve as (value: unknown) => void, reject });
			this.queues.set(key, queue);
			this.drain();
		});
	}

	private drain(): void {
		while (this.active < this.limit) {
			const next = [...this.queues.values()].find((queue) => queue.length > 0 && !this.activeKeys.has(queue[0].key));
			if (!next) return;
			const job = next.shift()!;
			if (next.length === 0) this.queues.delete(job.key);
			this.active += 1;
			this.activeKeys.add(job.key);
			void job.run().then(job.resolve, job.reject).finally(() => {
				this.active -= 1;
				this.activeKeys.delete(job.key);
				this.drain();
			});
		}
	}
}

export const requestScheduler = new RequestScheduler();
