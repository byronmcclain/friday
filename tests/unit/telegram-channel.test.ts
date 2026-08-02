import { describe, expect, test } from "bun:test";
import { TelegramChannel } from "../../src/modules/telegram/channel.ts";

describe("TelegramChannel", () => {
	test("has name 'telegram'", () => {
		const mockClient = {
			getOwnerChatId: () => null,
			sendMessage: async () => {},
		};
		const channel = new TelegramChannel(mockClient as any);
		expect(channel.name).toBe("telegram");
	});

	test("skips send when no owner chat ID", async () => {
		let sent = false;
		const mockClient = {
			getOwnerChatId: () => null,
			sendMessage: async () => {
				sent = true;
			},
		};
		const channel = new TelegramChannel(mockClient as any);
		await channel.send({
			level: "info",
			title: "Test",
			body: "Hello",
			source: "test",
		});
		expect(sent).toBe(false);
	});

	test("sends formatted notification when owner chat ID is set", async () => {
		let sentText = "";
		const mockClient = {
			getOwnerChatId: () => 12345,
			sendMessage: async (_chatId: number, text: string) => {
				sentText = text;
			},
		};
		const channel = new TelegramChannel(mockClient as any);
		await channel.send({
			level: "warning",
			title: "Alert",
			body: "CPU high",
			source: "sensorium",
		});
		expect(sentText).toContain("Alert");
		expect(sentText).toContain("CPU high");
	});
});
