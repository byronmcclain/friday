import { describe, test, expect, beforeEach } from "bun:test";
import { createEnvProtocol } from "../../src/sensorium/protocol.ts";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";

const stubContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as any,
	signal: { emit: async () => {} } as any,
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
	tools: new Map(),
};

describe("/env protocol", () => {
	let sensorium: Sensorium;
	let protocol: ReturnType<typeof createEnvProtocol>;

	beforeEach(async () => {
		sensorium = new Sensorium({
			config: SENSORIUM_DEFAULTS,
			signals: new SignalBus(),
			notifications: new NotificationManager(),
		});
		await sensorium.poll();
		protocol = createEnvProtocol(sensorium);
	});

	test("protocol has correct name and aliases", () => {
		expect(protocol.name).toBe("env");
		expect(protocol.aliases).toContain("environment");
		expect(protocol.aliases).toContain("sys");
	});

	test("default (no subcommand) shows status", async () => {
		const result = await protocol.execute({ rawArgs: "" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("CPU");
		expect(result.summary).toContain("Memory");
	});

	test("status subcommand shows full summary", async () => {
		const result = await protocol.execute(
			{ rawArgs: "status" },
			stubContext,
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("CPU");
	});

	test("cpu subcommand shows CPU details", async () => {
		const result = await protocol.execute({ rawArgs: "cpu" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("cores");
		expect(result.summary).toContain("Load");
	});

	test("memory subcommand shows memory details", async () => {
		const result = await protocol.execute(
			{ rawArgs: "memory" },
			stubContext,
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Total");
		expect(result.summary).toContain("Used");
		expect(result.summary).toContain("Free");
	});

	test("git subcommand shows git info", async () => {
		const result = await protocol.execute({ rawArgs: "git" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Branch");
	});

	test("unknown subcommand returns error", async () => {
		const result = await protocol.execute(
			{ rawArgs: "invalid" },
			stubContext,
		);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown subcommand");
	});
});
