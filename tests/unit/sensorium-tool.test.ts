import { describe, test, expect, beforeEach } from "bun:test";
import { createEnvironmentTool } from "../../src/sensorium/tool.ts";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";
import type { FridayTool, ToolContext } from "../../src/modules/types.ts";

const stubToolContext: ToolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as any,
	signal: { emit: async () => {} } as any,
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

describe("getEnvironmentStatus tool", () => {
	let sensorium: Sensorium;
	let tool: FridayTool;

	beforeEach(async () => {
		sensorium = new Sensorium({
			config: SENSORIUM_DEFAULTS,
			signals: new SignalBus(),
			notifications: new NotificationManager(),
		});
		await sensorium.poll();
		tool = createEnvironmentTool(sensorium);
	});

	test("tool has correct metadata", () => {
		expect(tool.name).toBe("getEnvironmentStatus");
		expect(tool.clearance).toContain("system");
		expect(tool.parameters).toHaveLength(1);
		expect(tool.parameters[0]!.name).toBe("section");
	});

	test("returns full snapshot when section is 'all'", async () => {
		const result = await tool.execute({ section: "all" }, stubToolContext);
		expect(result.success).toBe(true);
		expect(result.output).toContain("CPU");
		expect(result.output).toContain("Memory");
		expect(result.artifacts).toBeDefined();
		expect(result.artifacts!.machine).toBeDefined();
	});

	test("returns CPU section only", async () => {
		const result = await tool.execute({ section: "cpu" }, stubToolContext);
		expect(result.success).toBe(true);
		expect(result.output).toContain("cores");
		expect(result.artifacts!.cpu).toBeDefined();
	});

	test("returns memory section only", async () => {
		const result = await tool.execute(
			{ section: "memory" },
			stubToolContext,
		);
		expect(result.success).toBe(true);
		expect(result.artifacts!.memory).toBeDefined();
	});

	test("defaults to 'all' when no section provided", async () => {
		const result = await tool.execute({}, stubToolContext);
		expect(result.success).toBe(true);
		expect(result.artifacts!.machine).toBeDefined();
	});

	test("returns error when no snapshot available", async () => {
		const emptySensorium = new Sensorium({
			config: SENSORIUM_DEFAULTS,
			signals: new SignalBus(),
			notifications: new NotificationManager(),
		});
		const emptyTool = createEnvironmentTool(emptySensorium);
		const result = await emptyTool.execute({}, stubToolContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("No environment data");
	});
});
