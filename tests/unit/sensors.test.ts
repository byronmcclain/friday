import { describe, test, expect } from "bun:test";
import {
	gatherMachine,
	gatherContainers,
	gatherDev,
	parseVmStatMemory,
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

	test("memory used is less than total minus os.freemem on macOS (accounts for reclaimable cache)", async () => {
		if (process.platform !== "darwin") return; // only applies to macOS
		const { freemem, totalmem } = await import("node:os");
		const result = await gatherMachine();
		const naiveUsed = totalmem() - freemem();
		// With vm_stat parsing, used should be significantly less than the naive calculation
		// because inactive/purgeable/speculative pages are excluded
		expect(result.memory.used).toBeLessThan(naiveUsed);
	});
});

describe("parseVmStatMemory", () => {
	const SAMPLE_OUTPUT = [
		"Mach Virtual Memory Statistics: (page size of 16384 bytes)",
		"Pages free:                             1000.",
		"Pages active:                           5000.",
		"Pages inactive:                         3000.",
		"Pages speculative:                       500.",
		"Pages throttled:                           0.",
		"Pages wired down:                        800.",
		"Pages purgeable:                         200.",
		"Pages stored in compressor:              100.",
		'"Translation faults":                 12345678.',
		"Pages copy-on-write:                    9999.",
	].join("\n");

	// 128 GB total
	const TOTAL_BYTES = 128 * 1024 * 1024 * 1024;
	const PAGE_SIZE = 16384;

	test("computes used = (active + wired + compressed - purgeable) * pageSize", () => {
		const result = parseVmStatMemory(SAMPLE_OUTPUT, TOTAL_BYTES);
		expect(result).not.toBeNull();
		// active=5000 + wired=800 + compressed=100 - purgeable=200 = 5700 pages
		const expectedUsed = 5700 * PAGE_SIZE;
		expect(result!.used).toBe(expectedUsed);
	});

	test("computes free = total - used", () => {
		const result = parseVmStatMemory(SAMPLE_OUTPUT, TOTAL_BYTES);
		expect(result).not.toBeNull();
		expect(result!.free).toBe(TOTAL_BYTES - result!.used);
	});

	test("excludes inactive/speculative from used and subtracts purgeable", () => {
		const result = parseVmStatMemory(SAMPLE_OUTPUT, TOTAL_BYTES);
		expect(result).not.toBeNull();
		// inactive=3000, speculative=500 excluded; purgeable=200 subtracted from active
		const wrongUsed = (5000 + 800 + 100 + 3000 + 500) * PAGE_SIZE;
		expect(result!.used).toBeLessThan(wrongUsed);
	});

	test("returns null for non-vm_stat output", () => {
		expect(parseVmStatMemory("not valid output", TOTAL_BYTES)).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parseVmStatMemory("", TOTAL_BYTES)).toBeNull();
	});

	test("handles vm_stat output without compressor line", () => {
		const noCompressor = [
			"Mach Virtual Memory Statistics: (page size of 16384 bytes)",
			"Pages free:                             1000.",
			"Pages active:                           5000.",
			"Pages inactive:                         3000.",
			"Pages speculative:                       500.",
			"Pages wired down:                        800.",
			"Pages purgeable:                         200.",
		].join("\n");
		const result = parseVmStatMemory(noCompressor, TOTAL_BYTES);
		expect(result).not.toBeNull();
		// compressed defaults to 0 → used = (5000 + 800 + 0 - 200) * 16384
		expect(result!.used).toBe(5600 * PAGE_SIZE);
	});

	test("clamps used to total if vm_stat pages exceed total", () => {
		// Edge case: vm_stat reports more active pages than total memory would allow
		const hugeActive = [
			"Mach Virtual Memory Statistics: (page size of 16384 bytes)",
			"Pages active:                         99999999.",
			"Pages wired down:                     99999999.",
			"Pages stored in compressor:                  0.",
		].join("\n");
		const smallTotal = 1024 * 1024; // 1 MB
		const result = parseVmStatMemory(hugeActive, smallTotal);
		expect(result).not.toBeNull();
		expect(result!.used).toBeLessThanOrEqual(smallTotal);
		expect(result!.free).toBeGreaterThanOrEqual(0);
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
