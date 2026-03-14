import { describe, test, expect } from "bun:test";
import type { FridayModule, ModuleContext } from "../../src/modules/types.ts";

describe("ModuleContext", () => {
	test("ModuleContext type exists and has memory field", () => {
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		expect(context.memory).toBeDefined();
		expect(typeof context.memory.get).toBe("function");
		expect(typeof context.memory.set).toBe("function");
		expect(typeof context.memory.delete).toBe("function");
		expect(typeof context.memory.list).toBe("function");
	});

	test("FridayModule with zero-arg onLoad satisfies interface", () => {
		const mod = {
			name: "compat-test",
			description: "Tests backward compat",
			version: "1.0.0",
			tools: [],
			protocols: [],
			knowledge: [],
			triggers: [],
			clearance: [],
			async onLoad() {
				// zero-arg — must still be valid
			},
		} satisfies FridayModule;

		expect(typeof mod.onLoad).toBe("function");
	});

	test("FridayModule with ModuleContext onLoad satisfies interface", () => {
		const mod = {
			name: "context-test",
			description: "Tests new signature",
			version: "1.0.0",
			tools: [],
			protocols: [],
			knowledge: [],
			triggers: [],
			clearance: [],
			async onLoad(context: ModuleContext) {
				await context.memory.set("key", "value");
			},
		} satisfies FridayModule;

		expect(typeof mod.onLoad).toBe("function");
	});
});
