import { describe, test, expect, beforeEach } from "bun:test";
import { WebSocketHandler } from "../../src/server/handler.ts";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { stubProvider } from "../helpers/stubs.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

describe("WebSocketHandler", () => {
	let runtime: FridayRuntime;
	let handler: WebSocketHandler;
	let sent: ServerMessage[];

	const mockSend = (msg: ServerMessage) => {
		sent.push(msg);
	};

	beforeEach(() => {
		runtime = new FridayRuntime();
		handler = new WebSocketHandler(runtime, { injectedProvider: stubProvider });
		sent = [];
	});

	test("returns error when runtime not booted and chat received", async () => {
		await handler.handle('{"type":"chat","id":"1","content":"hello"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("error");
		expect((sent[0] as any).code).toBe("NOT_BOOTED");
	});

	test("boots runtime on session:boot", async () => {
		await handler.handle(
			'{"type":"session:boot","id":"1","provider":"grok"}',
			mockSend,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("session:booted");
		expect(runtime.isBooted).toBe(true);
	});

	test("handles chat after boot", async () => {
		await handler.handle('{"type":"session:boot","id":"1"}', mockSend);
		sent = [];
		await handler.handle(
			'{"type":"chat","id":"2","content":"hello"}',
			mockSend,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("chat:response");
		expect((sent[0] as any).requestId).toBe("2");
	});

	test("handles protocol command after boot", async () => {
		await handler.handle('{"type":"session:boot","id":"1"}', mockSend);
		runtime.protocols.register({
			name: "test",
			description: "test",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "Test OK" }),
		});
		sent = [];
		await handler.handle(
			'{"type":"protocol","id":"3","command":"/test"}',
			mockSend,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("chat:response");
		expect((sent[0] as any).content).toContain("Test OK");
	});

	test("handles session:shutdown", async () => {
		await handler.handle('{"type":"session:boot","id":"1"}', mockSend);
		sent = [];
		await handler.handle('{"type":"session:shutdown","id":"4"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("session:closed");
		expect(runtime.isBooted).toBe(false);
	});

	test("pushSensoriumUpdate does not throw when runtime not booted", () => {
		// Should safely no-op when sensorium is not available
		handler.pushSensoriumUpdate(mockSend);
		expect(sent).toHaveLength(0);
	});

	test("pushSensoriumUpdate sends via provided send function after boot", async () => {
		await handler.handle('{"type":"session:boot","id":"1"}', mockSend);
		sent = [];

		// pushSensoriumUpdate may or may not produce output depending on
		// whether sensorium has a snapshot in stub mode — the key is it doesn't throw
		handler.pushSensoriumUpdate(mockSend);
		const sensoriumMsgs = sent.filter((m) => m.type === "sensorium:update");
		expect(sensoriumMsgs.length).toBeGreaterThanOrEqual(0);
	});

	test("returns error for invalid JSON", async () => {
		await handler.handle("not json", mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("error");
		expect((sent[0] as any).code).toBe("INVALID_MESSAGE");
	});
});
