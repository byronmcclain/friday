import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/friday-test-memory.db";

describe("SQLiteMemory — Key-Value", () => {
  let memory: SQLiteMemory;

  beforeEach(() => {
    memory = new SQLiteMemory(TEST_DB);
  });

  afterEach(() => {
    memory.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  test("set and get a string value", async () => {
    await memory.set("test-ns", "key1", "hello");
    const result = await memory.get<string>("test-ns", "key1");
    expect(result).toBe("hello");
  });

  test("set and get an object value", async () => {
    await memory.set("test-ns", "config", { port: 3000, debug: true });
    const result = await memory.get<{ port: number; debug: boolean }>("test-ns", "config");
    expect(result?.port).toBe(3000);
    expect(result?.debug).toBe(true);
  });

  test("returns undefined for missing key", async () => {
    const result = await memory.get("test-ns", "nonexistent");
    expect(result).toBeUndefined();
  });

  test("overwrites existing key", async () => {
    await memory.set("test-ns", "key1", "first");
    await memory.set("test-ns", "key1", "second");
    const result = await memory.get<string>("test-ns", "key1");
    expect(result).toBe("second");
  });

  test("namespaces are isolated", async () => {
    await memory.set("ns-a", "key", "alpha");
    await memory.set("ns-b", "key", "beta");
    expect(await memory.get<string>("ns-a", "key")).toBe("alpha");
    expect(await memory.get<string>("ns-b", "key")).toBe("beta");
  });

  test("delete removes a key", async () => {
    await memory.set("test-ns", "key1", "value");
    await memory.delete("test-ns", "key1");
    expect(await memory.get("test-ns", "key1")).toBeUndefined();
  });

  test("list returns keys for a namespace", async () => {
    await memory.set("test-ns", "a", 1);
    await memory.set("test-ns", "b", 2);
    await memory.set("other-ns", "c", 3);
    const keys = await memory.list("test-ns");
    expect(keys.sort()).toEqual(["a", "b"]);
  });
});

describe("SQLiteMemory — Conversation History", () => {
  let memory: SQLiteMemory;

  beforeEach(() => {
    memory = new SQLiteMemory(TEST_DB);
  });

  afterEach(() => {
    memory.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  test("save and retrieve a conversation", async () => {
    await memory.saveConversation({
      id: "sess-1",
      startedAt: new Date("2026-01-01"),
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hey boss!" },
      ],
    });
    const history = await memory.getConversationHistory(10);
    expect(history).toHaveLength(1);
    expect(history[0]!.id).toBe("sess-1");
    expect(history[0]!.messages).toHaveLength(2);
  });

  test("returns conversations in reverse chronological order", async () => {
    await memory.saveConversation({
      id: "sess-1",
      startedAt: new Date("2026-01-01"),
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      messages: [],
    });
    await memory.saveConversation({
      id: "sess-2",
      startedAt: new Date("2026-01-02"),
      provider: "grok",
      model: "grok-3",
      messages: [],
    });
    const history = await memory.getConversationHistory(10);
    expect(history[0]!.id).toBe("sess-2");
    expect(history[1]!.id).toBe("sess-1");
  });

  test("limit parameter works", async () => {
    for (let i = 0; i < 5; i++) {
      await memory.saveConversation({
        id: `sess-${i}`,
        startedAt: new Date(2026, 0, i + 1),
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        messages: [],
      });
    }
    const history = await memory.getConversationHistory(2);
    expect(history).toHaveLength(2);
  });
});
