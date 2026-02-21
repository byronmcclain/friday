import { describe, test, expect } from "bun:test";
import { gatherMachine, type CpuTimes } from "../../src/sensorium/sensors.ts";

describe("gatherMachine", () => {
	test("returns valid machine snapshot", async () => {
		const result = await gatherMachine();
		expect(result.platform).toBeTruthy();
		expect(result.arch).toBeTruthy();
		expect(result.hostname).toBeTruthy();
		expect(result.cpus.count).toBeGreaterThan(0);
		expect(result.memory.total).toBeGreaterThan(0);
		expect(result.memory.free).toBeGreaterThan(0);
		expect(result.memory.used).toBe(result.memory.total - result.memory.free);
		expect(result.loadAvg).toHaveLength(3);
		expect(result.uptime).toBeGreaterThan(0);
	});

	test("returns 0 CPU usage on first call (no previous sample)", async () => {
		const result = await gatherMachine();
		expect(result.cpus.usage).toBe(0);
	});

	test("computes CPU usage delta when previous sample provided", async () => {
		const prevTimes: CpuTimes = { idle: 1000, total: 2000 };
		const result = await gatherMachine(prevTimes);
		expect(result.cpus.usage).toBeGreaterThanOrEqual(0);
		expect(result.cpus.usage).toBeLessThanOrEqual(100);
	});
});
