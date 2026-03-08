import { describe, test, expect, beforeEach } from "bun:test";
import { Vox } from "../../src/core/voice/vox.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";

describe("Vox", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	describe("mode management", () => {
		test("starts in off mode", () => {
			expect(vox.mode).toBe("off");
		});

		test("setMode changes mode", () => {
			vox.setMode("on");
			expect(vox.mode).toBe("on");
		});

		test("setMode to whisper", () => {
			vox.setMode("whisper");
			expect(vox.mode).toBe("whisper");
		});

		test("setMode back to off", () => {
			vox.setMode("on");
			vox.setMode("off");
			expect(vox.mode).toBe("off");
		});

		test("setMode emits custom:vox-mode-changed signal", async () => {
			const emitted: Array<{ from: string; to: string }> = [];
			signals.on("custom:vox-mode-changed", (sig) => {
				emitted.push(sig.data as any);
			});
			vox.setMode("on");
			await new Promise((r) => setTimeout(r, 10));
			expect(emitted).toHaveLength(1);
			expect(emitted[0]).toEqual({ from: "off", to: "on" });
		});
	});

	describe("speak", () => {
		test("speak is a no-op when mode is off", async () => {
			await vox.speak("Hello Boss");
			// Should resolve without error — no fetch called
		});

		test("speak resolves even without XAI_API_KEY (graceful degradation)", async () => {
			vox.setMode("on");
			await expect(vox.speak("Hello")).resolves.toBeUndefined();
		});

		test("speak skips empty text", async () => {
			vox.setMode("on");
			await vox.speak("");
			await vox.speak("   ");
			// Should resolve without error
		});
	});

	describe("cancel", () => {
		test("cancel when nothing is playing does not throw", () => {
			expect(() => vox.cancel()).not.toThrow();
		});
	});

	describe("stop", () => {
		test("stop sets mode to off", () => {
			vox.setMode("on");
			vox.stop();
			expect(vox.mode).toBe("off");
		});
	});

	describe("apiKeyAvailable", () => {
		test("reports whether XAI_API_KEY is set", () => {
			expect(typeof vox.apiKeyAvailable).toBe("boolean");
		});
	});

	describe("status", () => {
		test("returns current state summary", () => {
			const status = vox.status();
			expect(status.mode).toBe("off");
			expect(status.voice).toBe("Eve");
			expect(typeof status.apiKeyAvailable).toBe("boolean");
		});

		test("reflects mode changes", () => {
			vox.setMode("whisper");
			const status = vox.status();
			expect(status.mode).toBe("whisper");
		});

		test("status has no connected field", () => {
			const status = vox.status();
			expect((status as any).connected).toBeUndefined();
		});
	});

	describe("clearance audit", () => {
		test("logs vox:blocked audit entry when audio-output clearance denied", async () => {
			const clearance = new ClearanceManager([]);
			const audit = new AuditLogger();
			const gatedVox = new Vox({
				config: VOX_DEFAULTS,
				signals,
				notifications,
				clearance,
				audit,
			});
			gatedVox.setMode("on");
			await gatedVox.speak("Should be blocked");
			const entries = audit.entries({ action: "vox:blocked" });
			expect(entries.length).toBe(1);
			const entry = entries[0]!;
			expect(entry.source).toBe("vox");
			expect(entry.success).toBe(false);
		});

		test("does not log audit when clearance is granted", async () => {
			const clearance = new ClearanceManager(["audio-output"]);
			const audit = new AuditLogger();
			const gatedVox = new Vox({
				config: VOX_DEFAULTS,
				signals,
				notifications,
				clearance,
				audit,
			});
			gatedVox.setMode("on");
			await gatedVox.speak("Should pass clearance");
			const entries = audit.entries({ action: "vox:blocked" });
			expect(entries.length).toBe(0);
		});
	});
});

describe("emotion engine", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	test("setEmotionEngine stores model and history callback", () => {
		const model = createMockModel();
		vox.setEmotionEngine(model, () => []);
		expect(vox.hasEmotionEngine).toBe(true);
	});

	test("hasEmotionEngine is false by default", () => {
		expect(vox.hasEmotionEngine).toBe(false);
	});

	test("status includes emotionEngine field", () => {
		expect(vox.status().emotionEngine).toBe(false);
		const model = createMockModel();
		vox.setEmotionEngine(model, () => []);
		expect(vox.status().emotionEngine).toBe(true);
	});
});

describe("flat mode", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	test("setMode accepts flat", () => {
		vox.setMode("flat");
		expect(vox.mode).toBe("flat");
	});

	test("speak in flat mode does not call emotion engine", async () => {
		const model = createMockModel();
		let emotionCalled = false;
		vox.setEmotionEngine(model, () => {
			emotionCalled = true;
			return [];
		});
		vox.setMode("flat");
		// speak will bail early (no API key) but should not call emotion engine
		await vox.speak("Hello");
		expect(emotionCalled).toBe(false);
	});
});
