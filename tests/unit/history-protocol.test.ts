import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHistoryProtocol } from "../../src/history/protocol.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-history-protocol.db";
const stubContext = {
  workingDirectory: "/tmp",
  audit: { log: () => {} } as any,
  signal: { emit: async () => {} } as any,
  memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
  tools: new Map(),
};

describe("/history protocol", () => {
  let memory: SQLiteMemory;
  let protocol: ReturnType<typeof createHistoryProtocol>;

  beforeEach(async () => {
    memory = new SQLiteMemory(TEST_DB);
    protocol = createHistoryProtocol(memory);

    await memory.saveConversation({
      id: "sess-abc",
      startedAt: new Date("2026-01-15T10:00:00Z"),
      endedAt: new Date("2026-01-15T10:30:00Z"),
      provider: "grok",
      model: "grok-3",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hey boss!" },
      ],
    });
    await memory.saveConversation({
      id: "sess-def",
      startedAt: new Date("2026-01-16T14:00:00Z"),
      provider: "grok",
      model: "grok-3",
      messages: [
        { role: "user", content: "What is TypeScript?" },
        { role: "assistant", content: "TypeScript is..." },
        { role: "user", content: "Thanks" },
        { role: "assistant", content: "You're welcome!" },
      ],
    });
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB),
      unlink(`${TEST_DB}-wal`),
      unlink(`${TEST_DB}-shm`),
    ]);
  });

  test("list shows recent sessions", async () => {
    const result = await protocol.execute({ rawArgs: "list" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("sess-def");
    expect(result.summary).toContain("sess-abc");
    expect(result.summary).toContain("4 messages");
    expect(result.summary).toContain("2 messages");
  });

  test("default (no subcommand) shows list", async () => {
    const result = await protocol.execute({ rawArgs: "" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("sess-def");
  });

  test("show displays a specific session", async () => {
    const result = await protocol.execute({ rawArgs: "show sess-abc" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Hello");
    expect(result.summary).toContain("Hey boss!");
  });

  test("show without id returns usage error", async () => {
    const result = await protocol.execute({ rawArgs: "show" }, stubContext);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Usage");
  });

  test("show with unknown id returns error", async () => {
    const result = await protocol.execute({ rawArgs: "show unknown-id" }, stubContext);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("not found");
  });

  test("clear removes all conversations and reports count", async () => {
    const result = await protocol.execute({ rawArgs: "clear" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Cleared 2 conversation(s)");
    const listResult = await protocol.execute({ rawArgs: "list" }, stubContext);
    expect(listResult.summary).toContain("No conversation history");
  });

  test("list accepts optional count argument", async () => {
    const result = await protocol.execute({ rawArgs: "list 1" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Conversations (1)");
  });
});
