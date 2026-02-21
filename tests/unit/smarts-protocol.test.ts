import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSmartProtocol } from "../../src/smarts/protocol.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink, mkdir, writeFile, rm } from "node:fs/promises";
import type { ProtocolContext } from "../../src/modules/types.ts";

const TEST_DB = "/tmp/friday-test-smart-proto.db";
const TEST_DIR = "/tmp/friday-test-smart-proto";

const FIXTURE = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Validate all input.`;

function makeContext(): ProtocolContext {
  return {
    workingDirectory: "/tmp",
    audit: { log: () => {} } as any,
    signal: { emit: async () => {} } as any,
    memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    tools: new Map(),
  };
}

describe("/smart protocol", () => {
  let store: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(`${TEST_DIR}/security-basics.md`, FIXTURE);
    memory = new SQLiteMemory(TEST_DB);
    store = new SmartsStore();
    await store.initialize(
      { smartsDir: TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB),
      unlink(`${TEST_DB}-wal`),
      unlink(`${TEST_DB}-shm`),
      rm(TEST_DIR, { recursive: true }),
    ]);
  });

  test("list returns all SMARTS entries", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "list" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security-basics");
  });

  test("show displays a specific entry", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "show security-basics" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Validate all input");
  });

  test("show returns error for unknown entry", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "show nonexistent" }, makeContext());
    expect(result.success).toBe(false);
    expect(result.summary).toContain("not found");
  });

  test("domains lists all domains", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "domains" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security");
  });

  test("search returns FTS5 results", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "search xss injection" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security-basics");
  });

  test("reload re-indexes the directory", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "reload" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("reindex");
  });

  test("unknown subcommand returns help", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "invalid" }, makeContext());
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown");
  });

  test("empty args returns help", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "" }, makeContext());
    expect(result.success).toBe(false);
  });
});
