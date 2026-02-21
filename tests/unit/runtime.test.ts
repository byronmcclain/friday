import { describe, test, expect } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import type { LLMProvider } from "../../src/providers/types.ts";

const stubProvider: LLMProvider = {
	name: "stub",
	defaultModel: "stub-model",
	chat: async () => "stub response",
};

describe("FridayRuntime", () => {
	test("boots with default configuration", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.isBooted).toBe(true);
	});

	test("exposes cortex after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.cortex).toBeDefined();
		expect(runtime.cortex.providerName).toBe("stub");
	});

	test("exposes protocol registry after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.protocols).toBeDefined();
	});

	test("exposes signal bus after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.signals).toBeDefined();
	});

	test("process routes protocol input to protocol handler", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
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
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.protocols.isProtocol("hello")).toBe(false);
	});

	test("shutdown completes cleanly", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		await runtime.shutdown();
		expect(runtime.isBooted).toBe(false);
	});

	test("process throws when not booted", async () => {
		const runtime = new FridayRuntime();
		expect(runtime.process("hello")).rejects.toThrow("Runtime not booted");
	});

	test("shutdown throws when not booted", async () => {
		const runtime = new FridayRuntime();
		expect(runtime.shutdown()).rejects.toThrow("Runtime not booted");
	});

	test("protocol handler receives rawArgs", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		let receivedArgs: Record<string, unknown> = {};
		runtime.protocols.register({
			name: "deploy",
			description: "deploy",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async (args) => {
				receivedArgs = args;
				return { success: true, summary: "deployed" };
			},
		});
		await runtime.process("/deploy --env production");
		expect(receivedArgs.rawArgs).toBe("--env production");
	});

	test("boot is idempotent — double boot does not throw", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.isBooted).toBe(true);
	});
});
