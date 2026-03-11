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

	test("fires onAuditEntry for audit:entry events", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onAuditEntry = (entry) => received.push(entry);

		(bridge as any).handleServerMessage({
			type: "audit:entry",
			action: "tool:git.pull",
			source: "git.pull",
			detail: "Pulled from origin/main",
			success: true,
			timestamp: "2026-03-01T12:00:00.000Z",
		});

		expect(received).toHaveLength(1);
		expect(received[0].action).toBe("tool:git.pull");
		expect(received[0].source).toBe("git.pull");
		expect(received[0].detail).toBe("Pulled from origin/main");
		expect(received[0].success).toBe(true);
		expect(received[0].timestamp).toBe("2026-03-01T12:00:00.000Z");
	});

	test("does not throw when onAuditEntry is not set", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");

		(bridge as any).handleServerMessage({
			type: "audit:entry",
			action: "runtime:boot",
			source: "runtime",
			detail: "Friday online",
			success: true,
			timestamp: "2026-03-01T12:00:00.000Z",
		});
	});

	test("audit:entry does not interfere with request-reply messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const auditReceived: any[] = [];
		bridge.onAuditEntry = (entry) => auditReceived.push(entry);

		// An audit entry should not be treated as a request-reply
		(bridge as any).handleServerMessage({
			type: "audit:entry",
			action: "protocol:blocked",
			source: "test",
			detail: "denied",
			success: false,
			timestamp: "2026-03-01T12:00:00.000Z",
		});

		expect(auditReceived).toHaveLength(1);
		expect(auditReceived[0].success).toBe(false);
	});

	test("fires onToolExecuting for tool:executing signal messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: { name: string; args: Record<string, unknown> }[] = [];
		bridge.onToolExecuting = (name, args) => received.push({ name, args });

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "tool:executing",
			source: "fs.read",
			data: { args: { path: "/tmp/test.txt" } },
		});

		expect(received).toHaveLength(1);
		expect(received[0]!.name).toBe("fs.read");
		expect(received[0]!.args).toEqual({ path: "/tmp/test.txt" });
	});

	test("does not throw when onToolExecuting is not set", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "tool:executing",
			source: "git.status",
			data: { args: {} },
		});
	});

	test("ignores non-tool:executing signal messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onToolExecuting = (name, args) => received.push({ name, args });

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "file:changed",
			source: "watcher",
			data: { path: "/tmp/foo" },
		});

		expect(received).toHaveLength(0);
	});

	test("fires onNotification for notification events", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onNotification = (msg) => received.push(msg);

		(bridge as any).handleServerMessage({
			type: "notification",
			level: "warning",
			title: "Memory High",
			body: "Memory usage at 92%",
			source: "sensorium",
		});

		expect(received).toHaveLength(1);
		expect(received[0].level).toBe("warning");
		expect(received[0].title).toBe("Memory High");
		expect(received[0].body).toBe("Memory usage at 92%");
		expect(received[0].source).toBe("sensorium");
	});

	test("does not throw when onNotification is not set", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");

		(bridge as any).handleServerMessage({
			type: "notification",
			level: "alert",
			title: "Container Down",
			body: "nginx is not running",
			source: "sensorium",
		});
	});

	test("notification does not interfere with request-reply messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onNotification = (msg) => received.push(msg);

		// A notification should be handled by the callback, not by pendingCallbacks
		(bridge as any).handleServerMessage({
			type: "notification",
			level: "info",
			title: "Test",
			body: "test body",
			source: "test",
		});

		expect(received).toHaveLength(1);
	});
});
