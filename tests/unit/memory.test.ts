import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink } from "node:fs/promises";

describe("SQLiteMemory — Key-Value", () => {
  let memory: SQLiteMemory;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/friday-test-memory-kv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    memory = new SQLiteMemory(dbPath);
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(dbPath),
      unlink(`${dbPath}-wal`),
      unlink(`${dbPath}-shm`),
    ]);
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
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/friday-test-memory-conv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    memory = new SQLiteMemory(dbPath);
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(dbPath),
      unlink(`${dbPath}-wal`),
      unlink(`${dbPath}-shm`),
    ]);
  });

  test("save and retrieve a conversation", async () => {
    await memory.saveConversation({
      id: "sess-1",
      startedAt: new Date("2026-01-01"),
      provider: "grok",
      model: "grok-3",
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
      provider: "grok",
      model: "grok-3",
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
        provider: "grok",
        model: "grok-3",
        messages: [],
      });
    }
    const history = await memory.getConversationHistory(2);
    expect(history).toHaveLength(2);
  });

  test("getConversationById returns a specific session", async () => {
    await memory.saveConversation({
      id: "sess-abc",
      startedAt: new Date("2026-01-15"),
      provider: "grok",
      model: "grok-3",
      messages: [{ role: "user", content: "Hi" }],
    });
    const session = await memory.getConversationById("sess-abc");
    expect(session).toBeDefined();
    expect(session!.id).toBe("sess-abc");
    expect(session!.messages).toHaveLength(1);
  });

  test("getConversationById returns undefined for missing id", async () => {
    const session = await memory.getConversationById("nonexistent");
    expect(session).toBeUndefined();
  });

  test("deleteAllConversations removes all sessions", async () => {
    await memory.saveConversation({
      id: "sess-1",
      startedAt: new Date("2026-01-01"),
      provider: "grok",
      model: "grok-3",
      messages: [],
    });
    await memory.saveConversation({
      id: "sess-2",
      startedAt: new Date("2026-01-02"),
      provider: "grok",
      model: "grok-3",
      messages: [],
    });
    await memory.deleteAllConversations();
    const history = await memory.getConversationHistory(10);
    expect(history).toHaveLength(0);
  });
});

describe("SQLiteMemory — Semantic Search", () => {
  let memory: SQLiteMemory;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/friday-test-memory-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    memory = new SQLiteMemory(dbPath);
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(dbPath),
      unlink(`${dbPath}-wal`),
      unlink(`${dbPath}-shm`),
    ]);
  });

  test("embed stores content and returns an id", async () => {
    const id = await memory.embed("test-ns", "TypeScript is a typed superset of JavaScript");
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  test("search finds matching content", async () => {
    await memory.embed("test-ns", "TypeScript is a typed superset of JavaScript");
    await memory.embed("test-ns", "Bun is a fast JavaScript runtime");
    await memory.embed("test-ns", "The weather is sunny today");
    const results = await memory.search("test-ns", "JavaScript", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("search respects namespace isolation", async () => {
    await memory.embed("ns-a", "Alpha content about cats");
    await memory.embed("ns-b", "Beta content about cats");
    const results = await memory.search("ns-a", "cats", 10);
    expect(results).toHaveLength(1);
  });

  test("forget removes an embedding", async () => {
    const id = await memory.embed("test-ns", "Temporary content");
    await memory.forget("test-ns", id);
    const results = await memory.search("test-ns", "Temporary", 10);
    expect(results).toHaveLength(0);
  });

  test("embed stores metadata", async () => {
    await memory.embed("test-ns", "Important fact", { source: "user", priority: "high" });
    const results = await memory.search("test-ns", "Important", 1);
    expect(results[0]?.metadata?.source).toBe("user");
  });

  test("search handles FTS5 special characters in query", async () => {
    await memory.embed("test-ns", "TypeScript patterns and best practices");
    const results = await memory.search("test-ns", "TypeScript's \"best\" (practices)*", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  test("search handles slash characters in query without FTS5 error", async () => {
    await memory.embed("test-ns", "voice command protocol handler");
    const results = await memory.search("test-ns", "what is the /voice command?", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  test("search handles dash and plus operators in query", async () => {
    await memory.embed("test-ns", "debug flag configuration options");
    const results = await memory.search("test-ns", "fix --debug +verbose flag", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  test("search handles embedded double quotes in query", async () => {
    await memory.embed("test-ns", "the best TypeScript patterns");
    const results = await memory.search("test-ns", 'find "best" patterns', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  test("search returns empty array for pure-punctuation query", async () => {
    await memory.embed("test-ns", "Some content");
    const results = await memory.search("test-ns", "??? !!! ...", 5);
    expect(results).toEqual([]);
  });

  test("search returns empty array for empty query", async () => {
    await memory.embed("test-ns", "Some content");
    const results = await memory.search("test-ns", "", 5);
    expect(results).toEqual([]);
  });

  test("search returns empty array for whitespace-only query", async () => {
    await memory.embed("test-ns", "Some content");
    const results = await memory.search("test-ns", "   ", 5);
    expect(results).toEqual([]);
  });

  test("forget respects namespace isolation", async () => {
    const idA = await memory.embed("ns-a", "Shared content about dogs");
    const idB = await memory.embed("ns-b", "Shared content about dogs");
    await memory.forget("ns-b", idA);
    const resultsA = await memory.search("ns-a", "dogs", 10);
    const resultsB = await memory.search("ns-b", "dogs", 10);
    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(1);
  });

  test("purgeNamespace removes all embeddings for a namespace", async () => {
    await memory.embed("target", "First document about TypeScript");
    await memory.embed("target", "Second document about Bun runtime");
    await memory.embed("other", "Content in another namespace");
    await memory.purgeNamespace("target");
    const targetResults = await memory.search("target", "TypeScript Bun", 10);
    const otherResults = await memory.search("other", "Content", 10);
    expect(targetResults).toHaveLength(0);
    expect(otherResults).toHaveLength(1);
  });

  test("purgeNamespace on empty namespace is a no-op", async () => {
    await memory.embed("keep", "Preserved content");
    await memory.purgeNamespace("nonexistent");
    const results = await memory.search("keep", "Preserved", 10);
    expect(results).toHaveLength(1);
  });

  test("embedBatch inserts multiple items in one transaction", async () => {
    const ids = await memory.embedBatch("batch-ns", [
      { content: "TypeScript generics guide", metadata: { topic: "ts" } },
      { content: "Bun runtime performance tips", metadata: { topic: "bun" } },
      { content: "SQLite WAL mode explanation" },
    ]);
    expect(ids).toHaveLength(3);
    const tsResults = await memory.search("batch-ns", "TypeScript generics", 10);
    expect(tsResults).toHaveLength(1);
    expect(tsResults[0]?.metadata?.topic).toBe("ts");
    const bunResults = await memory.search("batch-ns", "Bun runtime", 10);
    expect(bunResults).toHaveLength(1);
    const sqlResults = await memory.search("batch-ns", "SQLite WAL", 10);
    expect(sqlResults).toHaveLength(1);
    expect(sqlResults[0]?.metadata).toBeUndefined();
  });

  test("embedBatch with empty array returns empty array", async () => {
    const ids = await memory.embedBatch("batch-ns", []);
    expect(ids).toEqual([]);
  });
});
