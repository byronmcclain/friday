import { describe, test, expect } from "bun:test";
import { TuiChannel } from "../../src/cli/tui/channels/tui-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("TuiChannel", () => {
	test("has name 'tui'", () => {
		const channel = new TuiChannel(() => {});
		expect(channel.name).toBe("tui");
	});

	test("calls onNotify with formatted message for info", async () => {
		const calls: Array<{ level: string; text: string }> = [];
		const channel = new TuiChannel((level, text) =>
			calls.push({ level, text }),
		);
		const notification: FridayNotification = {
			level: "info",
			title: "Test Title",
			body: "Test body text",
			source: "test",
		};
		await channel.send(notification);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.level).toBe("info");
		expect(calls[0]!.text).toContain("Test Title");
		expect(calls[0]!.text).toContain("Test body text");
	});

	test("calls onNotify with alert level", async () => {
		const calls: Array<{ level: string; text: string }> = [];
		const channel = new TuiChannel((level, text) =>
			calls.push({ level, text }),
		);
		await channel.send({
			level: "alert",
			title: "Alert!",
			body: "Something broke",
			source: "test",
		});
		expect(calls[0]!.level).toBe("alert");
	});

	test("calls onNotify with warning level", async () => {
		const calls: Array<{ level: string; text: string }> = [];
		const channel = new TuiChannel((level, text) =>
			calls.push({ level, text }),
		);
		await channel.send({
			level: "warning",
			title: "Warning",
			body: "CPU high",
			source: "sensorium",
		});
		expect(calls[0]!.level).toBe("warning");
	});
});
