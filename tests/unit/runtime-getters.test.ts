import { describe, test, expect } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";

describe("FridayRuntime getters", () => {
	test("summarizer getter returns undefined before boot", () => {
		const runtime = new FridayRuntime();
		expect(runtime.summarizer).toBeUndefined();
	});

	test("curator getter returns undefined before boot", () => {
		const runtime = new FridayRuntime();
		expect(runtime.curator).toBeUndefined();
	});
});
