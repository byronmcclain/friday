import { describe, test, expect } from "bun:test";
import { TelegramListener } from "../../src/modules/telegram/listener.ts";

describe("TelegramListener", () => {
	test("starts in stopped mode", () => {
		const listener = new TelegramListener();
		expect(listener.getMode()).toBe("stopped");
	});
});
