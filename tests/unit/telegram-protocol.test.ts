import { describe, test, expect } from "bun:test";
import { telegramProtocol } from "../../src/modules/telegram/protocol.ts";
import { setTelegramClient, setTelegramListener } from "../../src/modules/telegram/state.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";

const stubContext: ProtocolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as any,
	signal: { emit: async () => {} } as any,
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
	tools: new Map(),
};

describe("/telegram protocol", () => {
	test("has correct name and aliases", () => {
		expect(telegramProtocol.name).toBe("telegram");
		expect(telegramProtocol.aliases).toContain("tg");
	});

	test("returns inactive when client not set", async () => {
		setTelegramClient(null);
		setTelegramListener(null);
		const result = await telegramProtocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("not active");
	});

	test("status shows mode and connection info", async () => {
		const mockClient = { getOwnerChatId: () => 12345, getMe: async () => ({ id: 1, username: "friday_bot" }) } as any;
		const mockListener = { getMode: () => "polling" as const } as any;
		setTelegramClient(mockClient);
		setTelegramListener(mockListener);
		const result = await telegramProtocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("polling");
		setTelegramClient(null);
		setTelegramListener(null);
	});

	test("unknown subcommand returns error", async () => {
		const mockClient = { getOwnerChatId: () => null } as any;
		const mockListener = { getMode: () => "stopped" as const } as any;
		setTelegramClient(mockClient);
		setTelegramListener(mockListener);
		const result = await telegramProtocol.execute({ rawArgs: "bogus" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown subcommand");
		setTelegramClient(null);
		setTelegramListener(null);
	});
});
