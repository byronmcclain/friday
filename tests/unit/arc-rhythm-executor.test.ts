// tests/unit/arc-rhythm-executor.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { Rhythm } from "../../src/arc-rhythm/types.ts";

let executor: RhythmExecutor;
let cortex: Cortex;
let protocols: ProtocolRegistry;
let clearance: ClearanceManager;
let audit: AuditLogger;

function makeRhythm(overrides: Partial<Rhythm> = {}): Rhythm {
	return {
		id: "r1",
		name: "Test Rhythm",
		description: "test",
		cron: "0 0 * * *",
		enabled: true,
		origin: "user",
		action: { type: "prompt", prompt: "Hello" },
		nextRun: new Date(),
		runCount: 0,
		consecutiveFailures: 0,
		clearance: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

beforeEach(() => {
	clearance = new ClearanceManager(["system", "read-fs", "network", "provider"]);
	audit = new AuditLogger();
	cortex = new Cortex({ injectedModel: createMockModel() });
	protocols = new ProtocolRegistry();
	executor = new RhythmExecutor({ cortex, protocols, clearance, audit });
});

describe("RhythmExecutor", () => {
	test("executes prompt action via Cortex", async () => {
		const rhythm = makeRhythm({
			action: { type: "prompt", prompt: "Check status" },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("success");
		expect(result.result).toBeDefined();
	});

	test("executes tool action", async () => {
		cortex.registerTool({
			name: "test_tool",
			description: "test",
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, output: "tool ran" }),
		});
		const rhythm = makeRhythm({
			action: { type: "tool", tool: "test_tool", args: {} },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("success");
		expect(result.result).toContain("tool ran");
	});

	test("executes protocol action", async () => {
		protocols.register({
			name: "test-proto",
			description: "test",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "proto ran" }),
		});
		const rhythm = makeRhythm({
			action: { type: "protocol", protocol: "test-proto", args: { rawArgs: "" } },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("success");
		expect(result.result).toContain("proto ran");
	});

	test("returns failure when clearance is denied", async () => {
		const restrictedClearance = new ClearanceManager([]);
		const restrictedExecutor = new RhythmExecutor({
			cortex, protocols, clearance: restrictedClearance, audit,
		});
		const rhythm = makeRhythm({ clearance: ["system"] });
		const result = await restrictedExecutor.execute(rhythm);
		expect(result.status).toBe("failure");
		expect(result.error).toContain("Clearance denied");
	});

	test("logs rhythm:blocked audit entry when clearance denied", async () => {
		const restrictedClearance = new ClearanceManager([]);
		const restrictedAudit = new AuditLogger();
		const restrictedExecutor = new RhythmExecutor({
			cortex, protocols, clearance: restrictedClearance, audit: restrictedAudit,
		});
		const rhythm = makeRhythm({ name: "Blocked Beat", clearance: ["system"] });
		await restrictedExecutor.execute(rhythm);
		const entries = restrictedAudit.entries({ action: "rhythm:blocked" });
		expect(entries.length).toBe(1);
		const entry = entries[0]!;
		expect(entry.source).toBe("Blocked Beat");
		expect(entry.success).toBe(false);
	});

	test("returns failure when tool is not found", async () => {
		const rhythm = makeRhythm({
			action: { type: "tool", tool: "nonexistent_tool" },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("failure");
		expect(result.error).toContain("nonexistent_tool");
	});

	test("returns failure when protocol is not found", async () => {
		const rhythm = makeRhythm({
			action: { type: "protocol", protocol: "nonexistent" },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("failure");
		expect(result.error).toContain("nonexistent");
	});

	test("catches and wraps execution errors", async () => {
		cortex.registerTool({
			name: "failing_tool",
			description: "test",
			parameters: [],
			clearance: [],
			execute: async () => { throw new Error("boom"); },
		});
		const rhythm = makeRhythm({
			action: { type: "tool", tool: "failing_tool" },
		});
		const result = await executor.execute(rhythm);
		expect(result.status).toBe("failure");
		expect(result.error).toContain("boom");
	});
});
