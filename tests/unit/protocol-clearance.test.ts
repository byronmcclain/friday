import { describe, test, expect, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { FridayProtocol } from "../../src/modules/types.ts";
import type { FridayDirective } from "../../src/directives/types.ts";

describe("Protocol clearance enforcement", () => {
	let runtime: FridayRuntime;

	afterEach(async () => {
		if (runtime?.isBooted) await runtime.shutdown();
	});

	test("blocks protocol when required clearance is not granted", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.clearance.revoke("network");
		runtime.protocols.register({
			name: "gated",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => ({ success: true, summary: "should not run" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/gated");
		expect(result.output).toContain("Clearance denied");
		expect(result.output).toContain("network");
		expect(result.source).toBe("protocol");
	});

	test("executes protocol when required clearance is granted", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.protocols.register({
			name: "allowed",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => ({ success: true, summary: "executed ok" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/allowed");
		expect(result.output).toContain("executed ok");
	});

	test("executes protocol with empty clearance without checking", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.protocols.register({
			name: "open",
			description: "no clearance needed",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "open access" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/open");
		expect(result.output).toContain("open access");
	});

	test("logs protocol:blocked audit entry when clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.clearance.revoke("exec-shell");
		runtime.protocols.register({
			name: "audited",
			description: "needs exec-shell",
			aliases: [],
			parameters: [],
			clearance: ["exec-shell"],
			execute: async () => ({ success: true, summary: "should not run" }),
		} satisfies FridayProtocol);
		await runtime.process("/audited");
		const entries = runtime.audit.entries({ action: "protocol:blocked" });
		expect(entries.length).toBeGreaterThanOrEqual(1);
		const first = entries[0]!;
		expect(first.source).toBe("audited");
		expect(first.success).toBe(false);
	});
});

describe("Directive action dispatch clearance", () => {
	let runtime: FridayRuntime;

	afterEach(async () => {
		if (runtime?.isBooted) await runtime.shutdown();
	});

	test("blocks directive-dispatched protocol when target clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		let executed = false;
		runtime.protocols.register({
			name: "secret",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => {
				executed = true;
				return { success: true, summary: "ran" };
			},
		} satisfies FridayProtocol);
		runtime.clearance.revoke("network");

		runtime.directives.add({
			id: "test-dir-1",
			name: "test-directive",
			description: "test",
			enabled: true,
			trigger: { type: "signal", signal: "custom:test-fire" },
			action: { type: "protocol", protocol: "secret", args: { rawArgs: "" } },
			clearance: [],
			executionCount: 0,
		} satisfies FridayDirective);
		await runtime.signals.emit("custom:test-fire", "test");
		await new Promise((r) => setTimeout(r, 50));
		expect(executed).toBe(false);
	});

	test("blocks directive-dispatched tool when target clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		let executed = false;
		runtime.cortex.registerTool({
			name: "gated_tool",
			description: "needs exec-shell",
			parameters: [],
			clearance: ["exec-shell"],
			execute: async () => {
				executed = true;
				return { success: true, output: "ran" };
			},
		});
		runtime.clearance.revoke("exec-shell");

		runtime.directives.add({
			id: "test-dir-2",
			name: "test-tool-directive",
			description: "test",
			enabled: true,
			trigger: { type: "signal", signal: "custom:test-tool-fire" },
			action: { type: "tool", tool: "gated_tool", args: {} },
			clearance: [],
			executionCount: 0,
		} satisfies FridayDirective);
		await runtime.signals.emit("custom:test-tool-fire", "test");
		await new Promise((r) => setTimeout(r, 50));
		expect(executed).toBe(false);
	});
});
