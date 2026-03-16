import { describe, test, expect } from "bun:test";
import { telegramSend } from "../../src/modules/telegram/tools/send.ts";
import { setTelegramClient } from "../../src/modules/telegram/state.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const stubContext: ToolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as unknown as ToolContext["audit"],
	signal: { emit: async () => {} } as unknown as ToolContext["signal"],
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

describe("telegram.send tool", () => {
	test("has correct name and clearance", () => {
		expect(telegramSend.name).toBe("telegram.send");
		expect(telegramSend.clearance).toEqual(["network"]);
	});

	test("fails without message parameter", async () => {
		const result = await telegramSend.execute({}, stubContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("message");
	});

	test("fails when client not initialized", async () => {
		setTelegramClient(null);
		const result = await telegramSend.execute(
			{ message: "Hello" },
			stubContext,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("not active");
	});

	test("fails when owner chat ID not known", async () => {
		const mockClient = {
			getOwnerChatId: () => null,
			sendMessage: async () => {},
		} as any;
		setTelegramClient(mockClient);
		const result = await telegramSend.execute(
			{ message: "Hello" },
			stubContext,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("owner");
		setTelegramClient(null);
	});

	test("sends message when owner chat ID is set", async () => {
		let sentMsg = "";
		const mockClient = {
			getOwnerChatId: () => 12345,
			sendMessage: async (_chatId: number, text: string) => {
				sentMsg = text;
			},
		} as any;
		setTelegramClient(mockClient);
		const result = await telegramSend.execute(
			{ message: "Hello Boss" },
			stubContext,
		);
		expect(result.success).toBe(true);
		expect(sentMsg).toBe("Hello Boss");
		setTelegramClient(null);
	});
});
