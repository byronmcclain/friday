import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { mkdir, unlink } from "node:fs/promises";

const TEST_DATA_DIR = "/tmp/friday-vox-runtime-test";

describe("Runtime + Vox", () => {
	let runtime: FridayRuntime;

	beforeEach(async () => {
		runtime = new FridayRuntime();
		await mkdir(TEST_DATA_DIR, { recursive: true });
	});

	afterEach(async () => {
		try {
			await runtime.shutdown();
		} catch {
			/* ignore */
		}
		await Promise.allSettled([
			unlink(`${TEST_DATA_DIR}/friday.db`),
			unlink(`${TEST_DATA_DIR}/friday.db-wal`),
			unlink(`${TEST_DATA_DIR}/friday.db-shm`),
		]);
	});

	test("runtime boots with vox enabled (default)", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		expect(runtime.vox).toBeDefined();
		expect(runtime.vox!.mode).toBe("off"); // off by default
	});

	test("runtime boots with vox disabled", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableVox: false,
			enableSensorium: false,
		});
		expect(runtime.vox).toBeUndefined();
	});

	test("/voice protocol is registered when vox enabled", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const result = await runtime.process("/voice");
		expect(result.source).toBe("protocol");
		expect(result.output).toContain("off");
	});

	test("vox is stopped on shutdown", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const vox = runtime.vox!;
		vox.setMode("on");
		await runtime.shutdown();
		expect(vox.mode).toBe("off");
	});

	test("wires emotion engine to Vox when both exist", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			injectedFastModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});

		expect(runtime.vox).toBeDefined();
		expect(runtime.vox!.hasEmotionEngine).toBe(true);
	});
});
