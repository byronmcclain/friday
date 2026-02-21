import { describe, test, expect } from "bun:test";
import {
	gatherMachine,
	gatherContainers,
	gatherDev,
	type CpuTimes,
} from "../../src/sensorium/sensors.ts";

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

describe("gatherContainers", () => {
	test("returns a valid container snapshot", async () => {
		const result = await gatherContainers();
		expect(result.runtime).toMatch(/^(docker|podman|none)$/);
		expect(Array.isArray(result.running)).toBe(true);
		expect(typeof result.stopped).toBe("number");
	});

	test("each running container has required fields", async () => {
		const result = await gatherContainers();
		for (const c of result.running) {
			expect(c.id).toBeTruthy();
			expect(c.name).toBeTruthy();
			expect(c.image).toBeTruthy();
			expect(typeof c.cpu).toBe("number");
			expect(typeof c.memory).toBe("number");
		}
	});
});

describe("gatherDev", () => {
	test("returns valid dev snapshot", async () => {
		const result = await gatherDev();
		expect(Array.isArray(result.ports)).toBe(true);
		expect(Array.isArray(result.runtimes)).toBe(true);
	});

	test("detects git repo when in one", async () => {
		const result = await gatherDev();
		expect(result.git).toBeDefined();
		expect(result.git!.branch).toBeTruthy();
		expect(typeof result.git!.dirty).toBe("boolean");
	});

	test("detects bun runtime", async () => {
		const result = await gatherDev();
		const bun = result.runtimes.find((r) => r.name === "bun");
		expect(bun).toBeDefined();
		expect(bun!.version).toBeTruthy();
	});

	test("port entries have required fields", async () => {
		const result = await gatherDev();
		for (const p of result.ports) {
			expect(typeof p.port).toBe("number");
			expect(typeof p.pid).toBe("number");
			expect(typeof p.process).toBe("string");
		}
	});
});
