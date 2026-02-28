import { describe, test, expect, beforeEach } from "bun:test";
import { VoiceChannel } from "../../src/core/voice/channel.ts";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager, type FridayNotification } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";

describe("VoiceChannel", () => {
	let vox: Vox;
	let channel: VoiceChannel;
	let spokenTexts: string[];

	beforeEach(() => {
		const signals = new SignalBus();
		const notifications = new NotificationManager();
		vox = new Vox({ config: VOX_DEFAULTS, signals, notifications });

		// Track what gets spoken by patching speak
		spokenTexts = [];
		vox.speak = async (text: string) => {
			spokenTexts.push(text);
		};

		channel = new VoiceChannel(vox);
	});

	test("has name 'voice'", () => {
		expect(channel.name).toBe("voice");
	});

	test("send() calls vox.speak with title and body for warning level", async () => {
		const notification: FridayNotification = {
			level: "warning",
			title: "Test Alert",
			body: "Something happened",
			source: "test",
		};
		await channel.send(notification);
		expect(spokenTexts).toHaveLength(1);
		expect(spokenTexts[0]).toContain("Test Alert");
		expect(spokenTexts[0]).toContain("Something happened");
	});

	test("send() skips info-level notifications", async () => {
		const notification: FridayNotification = {
			level: "info",
			title: "Info Update",
			body: "Low priority",
			source: "test",
		};
		await channel.send(notification);
		expect(spokenTexts).toHaveLength(0);
	});

	test("send() formats notification as natural speech", async () => {
		const notification: FridayNotification = {
			level: "alert",
			title: "CPU High",
			body: "CPU at 95% sustained",
			source: "sensorium",
		};
		await channel.send(notification);
		expect(spokenTexts[0]).toBe("CPU High. CPU at 95% sustained");
	});
});
