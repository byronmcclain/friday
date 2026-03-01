import { describe, test, expect, beforeEach } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
import { createMockModel } from "../helpers/stubs.ts";

describe("Cortex + Vox integration", () => {
	let signals: SignalBus;
	let vox: Vox;
	let spokenTexts: string[];

	beforeEach(() => {
		signals = new SignalBus();
		const notifications = new NotificationManager();
		vox = new Vox({ config: VOX_DEFAULTS, signals, notifications });

		// Patch speak to track calls without actual audio
		spokenTexts = [];
		vox.speak = async (text: string) => {
			spokenTexts.push(text);
		};
	});

	test("Cortex fires vox.speak after chat response", async () => {
		vox.setMode("on");
		const cortex = new Cortex({
			injectedModel: createMockModel(),
			vox,
		});

		await cortex.chat("Hello");
		// Give fire-and-forget a tick
		await new Promise((r) => setTimeout(r, 10));
		expect(spokenTexts).toHaveLength(1);
		expect(spokenTexts[0]).toBe("stub response");
	});

	test("Cortex does not fire vox.speak when mode is off", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
			vox,
		});

		await cortex.chat("Hello");
		await new Promise((r) => setTimeout(r, 10));
		expect(spokenTexts).toHaveLength(0);
	});

	test("Cortex works normally without vox", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});

		const result = await cortex.chat("Hello");
		expect(result).toBe("stub response");
	});

	test("Cortex returns text immediately, does not wait for speak", async () => {
		vox.setMode("on");
		// Make speak slow to verify non-blocking
		vox.speak = async () => {
			await new Promise((r) => setTimeout(r, 500));
		};

		const cortex = new Cortex({
			injectedModel: createMockModel(),
			vox,
		});

		const start = Date.now();
		const result = await cortex.chat("Hello");
		const elapsed = Date.now() - start;

		expect(result).toBe("stub response");
		expect(elapsed).toBeLessThan(200); // Should not wait for speak
	});
});

describe("getRecentHistory", () => {
	test("returns last N messages as role-prefixed strings", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "response one" }),
		});

		await cortex.chat("Hello");
		await cortex.chat("How are you?");

		const history = cortex.getRecentHistory(4);
		expect(history.length).toBe(4);
		expect(history[0]).toMatch(/^User: Hello$/);
		expect(history[1]).toMatch(/^Assistant: /);
	});

	test("returns all messages when N exceeds history length", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});

		await cortex.chat("Hi");
		const history = cortex.getRecentHistory(100);
		expect(history.length).toBe(2); // user + assistant
	});

	test("returns empty array when no history", () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});

		const history = cortex.getRecentHistory(5);
		expect(history).toEqual([]);
	});
});
