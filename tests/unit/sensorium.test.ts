import { describe, test, expect, beforeEach } from "bun:test";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";

describe("Sensorium", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let sensorium: Sensorium;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		sensorium = new Sensorium({
			config: SENSORIUM_DEFAULTS,
			signals,
			notifications,
		});
	});

	test("initial snapshot is null before poll", () => {
		expect(sensorium.currentSnapshot).toBeNull();
	});

	test("poll populates snapshot", async () => {
		await sensorium.poll();
		const snap = sensorium.currentSnapshot;
		expect(snap).not.toBeNull();
		expect(snap!.timestamp).toBeInstanceOf(Date);
		expect(snap!.machine.cpus.count).toBeGreaterThan(0);
	});

	test("getContextBlock returns empty string before first poll", () => {
		expect(sensorium.getContextBlock()).toBe("");
	});

	test("getContextBlock returns formatted string after poll", async () => {
		await sensorium.poll();
		const block = sensorium.getContextBlock();
		expect(block).toContain("[ENVIRONMENT]");
		expect(block).toContain("cores");
		expect(block).toContain("RAM");
	});

	test("start and stop manage polling intervals", async () => {
		sensorium.start();
		expect(sensorium.isRunning).toBe(true);
		sensorium.stop();
		expect(sensorium.isRunning).toBe(false);
	});

	test("stop is idempotent", () => {
		sensorium.stop();
		sensorium.stop();
		expect(sensorium.isRunning).toBe(false);
	});

	test("emits signal on memory high transition", async () => {
		const emitted: string[] = [];
		signals.on("custom:env-memory-high", (sig) => {
			emitted.push(sig.name);
		});

		await sensorium.poll();
		sensorium.evaluateAlerts({
			...sensorium.currentSnapshot!,
			machine: {
				...sensorium.currentSnapshot!.machine,
				memory: { total: 100, used: 85, free: 15 },
			},
		});

		expect(emitted).toContain("custom:env-memory-high");
	});

	test("hysteresis: does not re-emit on consecutive high readings", async () => {
		const emitted: string[] = [];
		signals.on("custom:env-memory-high", () => {
			emitted.push("high");
		});

		await sensorium.poll();
		const highSnap = {
			...sensorium.currentSnapshot!,
			machine: {
				...sensorium.currentSnapshot!.machine,
				memory: { total: 100, used: 85, free: 15 },
			},
		};

		sensorium.evaluateAlerts(highSnap);
		sensorium.evaluateAlerts(highSnap);
		sensorium.evaluateAlerts(highSnap);

		expect(emitted).toHaveLength(1);
	});
});
