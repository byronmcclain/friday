import { describe, test, expect } from "bun:test";
import {
	SENSORIUM_DEFAULTS,
	type SystemSnapshot,
	type SensorConfig,
	type AlertThresholds,
	AlertState,
} from "../../src/sensorium/types.ts";

describe("Sensorium types", () => {
	test("SENSORIUM_DEFAULTS has expected default values", () => {
		expect(SENSORIUM_DEFAULTS.fastPollInterval).toBe(30_000);
		expect(SENSORIUM_DEFAULTS.slowPollInterval).toBe(300_000);
		expect(SENSORIUM_DEFAULTS.thresholds.cpuHigh).toBe(85);
		expect(SENSORIUM_DEFAULTS.thresholds.memoryHigh).toBe(80);
		expect(SENSORIUM_DEFAULTS.thresholds.memoryCritical).toBe(95);
		expect(SENSORIUM_DEFAULTS.thresholds.watchContainers).toEqual([]);
	});

	test("AlertState enum values are correct", () => {
		expect(AlertState.Normal as string).toBe("normal");
		expect(AlertState.High as string).toBe("high");
		expect(AlertState.Critical as string).toBe("critical");
	});
});
