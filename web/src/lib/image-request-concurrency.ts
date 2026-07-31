export const IMAGE_REQUEST_CONCURRENCY_LIMIT = 2;

type SemaphoreWaiter = {
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
};

export class AsyncSemaphore {
    private active = 0;
    private readonly limit: number;
    private readonly queue: SemaphoreWaiter[] = [];

    constructor(limit: number) {
        if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be a positive integer");
        this.limit = limit;
    }

    acquire(signal?: AbortSignal) {
        if (signal?.aborted) return Promise.reject(new DOMException("请求已取消", "AbortError"));

        return new Promise<() => void>((resolve, reject) => {
            const waiter: SemaphoreWaiter = { resolve, reject, signal };
            waiter.onAbort = () => {
                const index = this.queue.indexOf(waiter);
                if (index < 0) return;
                this.queue.splice(index, 1);
                reject(new DOMException("请求已取消", "AbortError"));
            };
            signal?.addEventListener("abort", waiter.onAbort, { once: true });
            this.queue.push(waiter);
            this.dispatch();
        });
    }

    async run<T>(signal: AbortSignal | undefined, task: () => Promise<T>) {
        const release = await this.acquire(signal);
        try {
            if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
            return await task();
        } finally {
            release();
        }
    }

    private dispatch() {
        while (this.active < this.limit && this.queue.length) {
            const waiter = this.queue.shift()!;
            waiter.signal?.removeEventListener("abort", waiter.onAbort!);
            if (waiter.signal?.aborted) {
                waiter.reject(new DOMException("请求已取消", "AbortError"));
                continue;
            }

            this.active += 1;
            let released = false;
            waiter.resolve(() => {
                if (released) return;
                released = true;
                this.active -= 1;
                this.dispatch();
            });
        }
    }
}

export const imageRequestSemaphore = new AsyncSemaphore(IMAGE_REQUEST_CONCURRENCY_LIMIT);

export async function mapSettledWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
    const results = new Array<PromiseSettledResult<R>>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(0, Math.min(Math.max(1, Math.floor(limit) || 1), items.length));

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            for (;;) {
                const index = nextIndex++;
                if (index >= items.length) return;
                try {
                    results[index] = { status: "fulfilled", value: await task(items[index], index) };
                } catch (reason) {
                    results[index] = { status: "rejected", reason };
                }
            }
        }),
    );
    return results;
}
