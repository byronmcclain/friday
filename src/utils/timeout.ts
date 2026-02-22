export class TimeoutError extends Error {
	constructor(label?: string) {
		super(label ? `Timed out: ${label}` : "Operation timed out");
		this.name = "TimeoutError";
	}
}

/**
 * Race a promise against a timeout. Rejects with TimeoutError on expiration.
 */
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label?: string,
): Promise<T> {
	return new Promise<T>((res, rej) => {
		const timer = setTimeout(() => rej(new TimeoutError(label)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				res(value);
			},
			(err) => {
				clearTimeout(timer);
				rej(err);
			},
		);
	});
}
