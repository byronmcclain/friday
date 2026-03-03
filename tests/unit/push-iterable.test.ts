import { describe, test, expect } from "bun:test";
import { createPushIterable } from "../../src/core/workers/push-iterable.ts";

describe("createPushIterable", () => {
	test("yields pushed values in order", async () => {
		const { push, done, iterable } = createPushIterable<string>();
		push("a");
		push("b");
		push("c");
		done();

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual(["a", "b", "c"]);
	});

	test("resolves next() when value pushed after await", async () => {
		const { push, done, iterable } = createPushIterable<number>();
		const iter = iterable[Symbol.asyncIterator]();

		setTimeout(() => {
			push(42);
			done();
		}, 0);

		const first = await iter.next();
		expect(first).toEqual({ value: 42, done: false });
		const last = await iter.next();
		expect(last.done).toBe(true);
	});

	test("done() terminates iteration", async () => {
		const { done, iterable } = createPushIterable<string>();
		done();

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual([]);
	});

	test("push after done is ignored", async () => {
		const { push, done, iterable } = createPushIterable<string>();
		push("before");
		done();
		push("after");

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual(["before"]);
	});

	test("error() rejects pending next()", async () => {
		const { error, iterable } = createPushIterable<string>();
		const iter = iterable[Symbol.asyncIterator]();

		setTimeout(() => error(new Error("boom")), 0);

		try {
			await iter.next();
			expect(true).toBe(false);
		} catch (err) {
			expect((err as Error).message).toBe("boom");
		}
	});

	test("collects fullValue when collect: true", async () => {
		const { push, done, fullValue } = createPushIterable<string>({ collect: true });
		push("hello ");
		push("world");
		done();

		const result = await fullValue;
		expect(result).toBe("hello world");
	});

	test("fullValue is empty string when collect not enabled", async () => {
		const { push, done, fullValue } = createPushIterable<string>();
		push("hello ");
		push("world");
		done();

		const result = await fullValue;
		expect(result).toBe("");
	});
});
