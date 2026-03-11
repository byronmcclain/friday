import { describe, test, expect } from "bun:test";
import { PushNotificationChannel } from "../../src/server/push-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("PushNotificationChannel", () => {
	test("sends notification to registered callback", async () => {
		const sent: any[] = [];
		const channel = new PushNotificationChannel((msg) => sent.push(msg));

		const notification: FridayNotification = {
			level: "warning",
			title: "CPU High",
			body: "CPU at 92%",
			source: "sensorium",
		};
		await channel.send(notification);

		expect(sent).toHaveLength(1);
		expect(sent[0].type).toBe("notification");
		expect(sent[0].level).toBe("warning");
		expect(sent[0].title).toBe("CPU High");
	});

	test("has default name 'push'", () => {
		const channel = new PushNotificationChannel(() => {});
		expect(channel.name).toBe("push");
	});
});
