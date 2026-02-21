import { describe, test, expect } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";

describe("FridayRuntime", () => {
	test("boots with default configuration", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		expect(runtime.isBooted).toBe(true);
	});

	test("exposes cortex after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		expect(runtime.cortex).toBeDefined();
		expect(runtime.cortex.providerName).toBe("anthropic");
	});

	test("exposes protocol registry after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		expect(runtime.protocols).toBeDefined();
	});

	test("exposes signal bus after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		expect(runtime.signals).toBeDefined();
	});

	test("process routes protocol input to protocol handler", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		runtime.protocols.register({
			name: "test",
			description: "test",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "Protocol executed" }),
		});
		const result = await runtime.process("/test");
		expect(result.output).toContain("Protocol executed");
	});

	test("non-protocol input is not detected as protocol", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		expect(runtime.protocols.isProtocol("hello")).toBe(false);
	});

	test("shutdown completes cleanly", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot();
		await runtime.shutdown();
		expect(runtime.isBooted).toBe(false);
	});
});
