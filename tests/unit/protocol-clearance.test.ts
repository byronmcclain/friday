import { describe, test, expect, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { FridayProtocol } from "../../src/modules/types.ts";

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
		const entries = runtime.audit.entries.filter(
			(e) => e.action === "protocol:blocked",
		);
		expect(entries.length).toBeGreaterThanOrEqual(1);
		expect(entries[0].source).toBe("audited");
		expect(entries[0].success).toBe(false);
	});
});
