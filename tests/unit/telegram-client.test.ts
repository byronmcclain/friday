import { describe, test, expect } from "bun:test";
import { TelegramClient } from "../../src/modules/telegram/client.ts";

describe("TelegramClient", () => {
	test("stores and retrieves owner chat ID", () => {
		const client = new TelegramClient("fake-token");
		expect(client.getOwnerChatId()).toBeNull();
		client.setOwnerChatId(12345);
		expect(client.getOwnerChatId()).toBe(12345);
	});

	test("getBot returns grammY Bot instance", () => {
		const client = new TelegramClient("fake-token");
		const bot = client.getBot();
		expect(bot).toBeDefined();
		expect(typeof bot.api).toBe("object");
	});
});
