import { describe, test, expect } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { AuditEntry } from "../../src/audit/types.ts";

describe("AuditLogger onLog callback", () => {
	test("fires callback on each log call", () => {
		const logger = new AuditLogger();
		const received: AuditEntry[] = [];
		logger.onLog = (entry) => received.push(entry);
		logger.log({ action: "test:action", source: "test", detail: "hello", success: true });
		expect(received).toHaveLength(1);
		expect(received[0]!.action).toBe("test:action");
		expect(received[0]!.timestamp).toBeInstanceOf(Date);
	});

	test("callback receives the full entry with timestamp", () => {
		const logger = new AuditLogger();
		let captured: AuditEntry | null = null;
		logger.onLog = (entry) => {
			captured = entry;
		};
		logger.log({ action: "a", source: "s", detail: "d", success: false });
		expect(captured).not.toBeNull();
		expect(captured!.success).toBe(false);
		expect(captured!.detail).toBe("d");
	});

	test("works without callback set", () => {
		const logger = new AuditLogger();
		// Should not throw
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		expect(logger.entries()).toHaveLength(1);
	});

	test("callback errors do not prevent logging", () => {
		const logger = new AuditLogger();
		logger.onLog = () => {
			throw new Error("callback boom");
		};
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		expect(logger.entries()).toHaveLength(1);
	});

	test("callback can be reassigned", () => {
		const logger = new AuditLogger();
		const first: string[] = [];
		const second: string[] = [];
		logger.onLog = (e) => first.push(e.action);
		logger.log({ action: "one", source: "s", detail: "d", success: true });
		logger.onLog = (e) => second.push(e.action);
		logger.log({ action: "two", source: "s", detail: "d", success: true });
		expect(first).toEqual(["one"]);
		expect(second).toEqual(["two"]);
	});

	test("callback can be cleared by setting to undefined", () => {
		const logger = new AuditLogger();
		const received: AuditEntry[] = [];
		logger.onLog = (entry) => received.push(entry);
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		logger.onLog = undefined;
		logger.log({ action: "b", source: "s", detail: "d", success: true });
		expect(received).toHaveLength(1);
	});
});
