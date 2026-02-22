import { describe, test, expect } from "bun:test";
import { WebSocketNotificationChannel } from "../../src/server/ws-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("WebSocketNotificationChannel", () => {
	test("sends notification to registered callback", async () => {
		const sent: any[] = [];
		const channel = new WebSocketNotificationChannel((msg) => sent.push(msg));

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

	test("has name 'websocket'", () => {
		const channel = new WebSocketNotificationChannel(() => {});
		expect(channel.name).toBe("websocket");
	});
});
