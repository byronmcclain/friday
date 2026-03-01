import { describe, test, expect, beforeEach } from "bun:test";
import { Vox } from "../../src/core/voice/vox.ts";
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
			// Signal emission is async, give it a tick
			await new Promise((r) => setTimeout(r, 10));
			expect(emitted).toHaveLength(1);
			expect(emitted[0]).toEqual({ from: "off", to: "on" });
		});
	});

	describe("speak", () => {
		test("speak is a no-op when mode is off", async () => {
			// Should resolve without error and without connecting
			await vox.speak("Hello Boss");
			expect(vox.isConnected).toBe(false);
		});

		test("speak resolves even without XAI_API_KEY (graceful degradation)", async () => {
			vox.setMode("on");
			// speak() should never reject — errors are swallowed
			await expect(vox.speak("Hello")).resolves.toBeUndefined();
		});
	});

	describe("cancel", () => {
		test("cancel when nothing is playing does not throw", () => {
			expect(() => vox.cancel()).not.toThrow();
		});
	});

	describe("stop", () => {
		test("stop sets mode to off and disconnects", () => {
			vox.setMode("on");
			vox.stop();
			expect(vox.mode).toBe("off");
			expect(vox.isConnected).toBe(false);
		});
	});

	describe("connection state", () => {
		test("isConnected is false initially", () => {
			expect(vox.isConnected).toBe(false);
		});
	});

	describe("apiKeyAvailable", () => {
		test("reports whether XAI_API_KEY is set", () => {
			// This depends on the environment — just verify it returns boolean
			expect(typeof vox.apiKeyAvailable).toBe("boolean");
		});
	});

	describe("status", () => {
		test("returns current state summary", () => {
			const status = vox.status();
			expect(status.mode).toBe("off");
			expect(status.connected).toBe(false);
			expect(status.voice).toBe("Eve");
		});

		test("reflects mode changes", () => {
			vox.setMode("whisper");
			const status = vox.status();
			expect(status.mode).toBe("whisper");
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
			// speak will proceed past clearance but fail on API key — that's fine
			await gatedVox.speak("Should pass clearance");
			const entries = audit.entries({ action: "vox:blocked" });
			expect(entries.length).toBe(0);
		});
	});
});
