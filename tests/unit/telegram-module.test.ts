import { describe, test, expect } from "bun:test";
import telegramModule from "../../src/modules/telegram/index.ts";
import type { ModuleContext } from "../../src/modules/types.ts";

describe("telegram module", () => {
	test("exports valid module manifest", () => {
		expect(telegramModule.name).toBe("telegram");
		expect(telegramModule.version).toBe("1.0.0");
		expect(telegramModule.description).toContain("Telegram");
	});

	test("declares network clearance", () => {
		expect(telegramModule.clearance).toContain("network");
	});

	test("has onLoad lifecycle hook", () => {
		expect(typeof telegramModule.onLoad).toBe("function");
	});

	test("includes telegram.send tool", () => {
		const names = telegramModule.tools.map((t) => t.name);
		expect(names).toContain("telegram.send");
	});

	test("includes telegram protocol", () => {
		expect(telegramModule.protocols.length).toBeGreaterThan(0);
		expect(telegramModule.protocols[0]!.name).toBe("telegram");
	});

	test("onLoad without TELEGRAM_BOT_TOKEN does not throw", async () => {
		const saved = process.env.TELEGRAM_BOT_TOKEN;
		delete process.env.TELEGRAM_BOT_TOKEN;
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		await telegramModule.onLoad(context);
		process.env.TELEGRAM_BOT_TOKEN = saved;
	});
});
