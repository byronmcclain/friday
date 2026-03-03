export interface PushIterable<T> {
	push(value: T): void;
	done(): void;
	error(err: Error): void;
	iterable: AsyncIterable<T>;
	fullValue: Promise<string>;
}

export function createPushIterable<T>(options?: {
	collect?: boolean;
}): PushIterable<T> {
	const queue: T[] = [];
	let resolve: ((result: IteratorResult<T>) => void) | null = null;
	let reject: ((err: Error) => void) | null = null;
	let isDone = false;
	const shouldCollect = options?.collect ?? false;
	const collected: string[] = [];

	let fullResolve: (value: string) => void;
	let fullReject: (err: Error) => void;
	const fullValue = new Promise<string>((res, rej) => {
		fullResolve = res;
		fullReject = rej;
	});
	// Prevent unhandled rejection when error() is called but fullValue is not awaited
	fullValue.catch(() => {});

	return {
		push(value: T) {
			if (isDone) return;
			if (shouldCollect && typeof value === "string") collected.push(value);
			if (resolve) {
				const r = resolve;
				resolve = null;
				reject = null;
				r({ value, done: false });
			} else {
				queue.push(value);
			}
		},
		done() {
			isDone = true;
			fullResolve!(collected.join(""));
			if (resolve) {
				const r = resolve;
				resolve = null;
				reject = null;
				r({ value: undefined as T, done: true });
			}
		},
		error(err: Error) {
			isDone = true;
			fullReject!(err);
			if (reject) {
				const rj = reject;
				resolve = null;
				reject = null;
				rj(err);
			}
		},
		iterable: {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<T>> {
						if (queue.length > 0) {
							return Promise.resolve({ value: queue.shift()!, done: false });
						}
						if (isDone) {
							return Promise.resolve({
								value: undefined as T,
								done: true,
							});
						}
						return new Promise<IteratorResult<T>>((res, rej) => {
							resolve = res;
							reject = rej;
						});
					},
				};
			},
		},
		fullValue,
	};
}
