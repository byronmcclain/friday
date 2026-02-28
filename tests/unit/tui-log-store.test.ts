import { describe, test, expect } from "bun:test";
import { LogStore } from "../../src/cli/tui/log-store.ts";
import type { LogEntry } from "../../src/cli/tui/log-types.ts";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		id: crypto.randomUUID(),
		timestamp: new Date(),
		level: "info",
		source: "test",
		message: "test message",
		...overrides,
	};
}

describe("LogStore", () => {
	test("starts empty", () => {
		const store = new LogStore();
		expect(store.entries).toEqual([]);
	});

	test("push adds an entry", () => {
		const store = new LogStore();
		const entry = makeEntry();
		store.push(entry);
		expect(store.entries).toHaveLength(1);
		expect(store.entries[0]).toBe(entry);
	});

	test("push preserves insertion order", () => {
		const store = new LogStore();
		const a = makeEntry({ message: "a" });
		const b = makeEntry({ message: "b" });
		store.push(a);
		store.push(b);
		expect(store.entries[0]!.message).toBe("a");
		expect(store.entries[1]!.message).toBe("b");
	});

	test("trims oldest entries beyond max capacity", () => {
		const store = new LogStore(3);
		store.push(makeEntry({ message: "1" }));
		store.push(makeEntry({ message: "2" }));
		store.push(makeEntry({ message: "3" }));
		store.push(makeEntry({ message: "4" }));
		expect(store.entries).toHaveLength(3);
		expect(store.entries[0]!.message).toBe("2");
		expect(store.entries[2]!.message).toBe("4");
	});

	test("notifies subscribers on push", () => {
		const store = new LogStore();
		let callCount = 0;
		store.subscribe(() => callCount++);
		store.push(makeEntry());
		expect(callCount).toBe(1);
	});

	test("unsubscribe stops notifications", () => {
		const store = new LogStore();
		let callCount = 0;
		const cb = () => callCount++;
		store.subscribe(cb);
		store.push(makeEntry());
		store.unsubscribe(cb);
		store.push(makeEntry());
		expect(callCount).toBe(1);
	});

	test("multiple subscribers all receive entries", () => {
		const store = new LogStore();
		let c1 = 0;
		let c2 = 0;
		store.subscribe(() => c1++);
		store.subscribe(() => c2++);
		store.push(makeEntry());
		expect(c1).toBe(1);
		expect(c2).toBe(1);
	});

	test("subscriber errors do not break other subscribers", () => {
		const store = new LogStore();
		let callCount = 0;
		store.subscribe(() => {
			throw new Error("boom");
		});
		store.subscribe(() => callCount++);
		store.push(makeEntry());
		expect(callCount).toBe(1);
	});

	test("clear removes all entries", () => {
		const store = new LogStore();
		store.push(makeEntry());
		store.push(makeEntry());
		store.clear();
		expect(store.entries).toEqual([]);
	});

	test("default max capacity is 500", () => {
		const store = new LogStore();
		for (let i = 0; i < 510; i++) {
			store.push(makeEntry({ message: `msg-${i}` }));
		}
		expect(store.entries).toHaveLength(500);
		expect(store.entries[0]!.message).toBe("msg-10");
	});
});
