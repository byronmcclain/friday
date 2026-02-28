import { describe, test, expect } from "bun:test";
import { SocketBridge } from "../../src/core/bridges/socket.ts";

describe("SocketBridge", () => {
	test("isBooted returns false when not connected", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		expect(bridge.isBooted()).toBe(false);
	});

	test("fires onConversationMessage for conversation:message events", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onConversationMessage = (msg) => received.push(msg);

		const msg = {
			type: "conversation:message",
			role: "user",
			content: "hello from another client",
			source: "chat",
		};
		(bridge as any).handleServerMessage(msg);

		expect(received).toHaveLength(1);
		expect(received[0].role).toBe("user");
		expect(received[0].content).toBe("hello from another client");
		expect(received[0].source).toBe("chat");
	});

	test("fires onConversationMessage for replay messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onConversationMessage = (msg) => received.push(msg);

		(bridge as any).handleServerMessage({
			type: "conversation:message",
			role: "assistant",
			content: "replayed response",
			source: "replay",
		});

		expect(received).toHaveLength(1);
		expect(received[0].source).toBe("replay");
	});

	test("does not throw when onConversationMessage is not set", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");

		// Should not throw when no callback is set
		(bridge as any).handleServerMessage({
			type: "conversation:message",
			role: "user",
			content: "ignored",
			source: "chat",
		});
	});
});
