// tests/unit/arc-rhythm-runtime.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { rm } from "node:fs/promises";

const TEST_DATA_DIR = "/tmp/friday-test-arc-runtime";

let runtime: FridayRuntime;

beforeEach(() => {
	runtime = new FridayRuntime();
});

afterEach(async () => {
	if (runtime.isBooted) await runtime.shutdown();
	await Promise.allSettled([
		rm(TEST_DATA_DIR, { recursive: true }),
	]);
});

describe("FridayRuntime + Arc Rhythm", () => {
	test("boots with Arc Rhythm when dataDir is provided", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		expect(runtime.isBooted).toBe(true);
		expect(runtime.protocols.isProtocol("/arc")).toBe(true);
	});

	test("Arc Rhythm protocol responds to /arc list", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const result = await runtime.process("/arc list");
		expect(result.source).toBe("protocol");
		expect(result.output).toContain("No rhythms");
	});

	test("manage_rhythm tool is registered on Cortex", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const tools = runtime.cortex.availableTools;
		const rhythmTool = tools.find((t) => t.name === "manage_rhythm");
		expect(rhythmTool).toBeDefined();
	});

	test("shutdown stops Arc Rhythm gracefully", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		await runtime.shutdown();
		expect(runtime.isBooted).toBe(false);
	});

	test("boots without Arc Rhythm when dataDir is not provided", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			enableSensorium: false,
		});
		expect(runtime.isBooted).toBe(true);
		expect(runtime.protocols.isProtocol("/arc")).toBe(false);
	});
});
