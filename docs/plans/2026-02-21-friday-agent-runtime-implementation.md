# Friday Agent Runtime — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve Friday from a simple chat wrapper into a full MCU-faithful Agent Runtime with Modules, Protocols, Directives, Signals, Clearance, Memory, Notifications, and Daemon mode.

**Architecture:** Bottom-up build — infrastructure layers first (Signal Bus, Clearance, Audit, Memory), then capability systems (Modules, Protocols), then the Cortex orchestrator, then autonomous behavior (Directives, Notifications), then the Runtime bootstrap and Daemon mode. Each layer is independently testable.

**Tech Stack:** Bun runtime, TypeScript strict mode, bun:test, bun:sqlite, Biome linting, Commander.js CLI, chalk/ora/boxen for output.

**Conventions:** Use `bun test` (not jest/vitest), `Bun.file()` (not fs), `bun:sqlite` (not better-sqlite3). All types centralized. Biome for lint/format. Two-space indentation, 100-char line width.

---

## Phase 1: Core Infrastructure

These three systems have no dependencies on each other and form the foundation everything else builds on.

---

### Task 1: Signal Bus (Event System)

**Files:**
- Create: `src/core/events.ts`
- Test: `tests/unit/events.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/events.test.ts
import { describe, test, expect, mock } from "bun:test";
import { SignalBus } from "../../src/core/events.ts";
import type { Signal, SignalName } from "../../src/core/events.ts";

describe("SignalBus", () => {
  test("emits a signal to registered listeners", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("session:start", handler);
    await bus.emit("session:start", "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("passes signal data to handler", async () => {
    const bus = new SignalBus();
    let received: Signal | undefined;
    bus.on("file:changed", (signal) => { received = signal; });
    await bus.emit("file:changed", "test", { path: "/foo.ts" });
    expect(received?.name).toBe("file:changed");
    expect(received?.source).toBe("test");
    expect(received?.data?.path).toBe("/foo.ts");
  });

  test("supports multiple listeners on same signal", async () => {
    const bus = new SignalBus();
    const h1 = mock(() => {});
    const h2 = mock(() => {});
    bus.on("test:passed", h1);
    bus.on("test:passed", h2);
    await bus.emit("test:passed", "test");
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test("off() removes a listener", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("session:end", handler);
    bus.off("session:end", handler);
    await bus.emit("session:end", "test");
    expect(handler).not.toHaveBeenCalled();
  });

  test("once() fires only once", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.once("error:unhandled", handler);
    await bus.emit("error:unhandled", "test");
    await bus.emit("error:unhandled", "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("supports custom signal names", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("custom:my-event" as SignalName, handler);
    await bus.emit("custom:my-event" as SignalName, "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/events.test.ts`
Expected: FAIL — cannot resolve `../../src/core/events.ts`

**Step 3: Write the implementation**

```typescript
// src/core/events.ts

export type SignalName =
  | "file:changed"
  | "file:created"
  | "file:deleted"
  | "test:passed"
  | "test:failed"
  | "command:pre-execute"
  | "command:post-execute"
  | "command:pre-commit"
  | "session:start"
  | "session:end"
  | "error:unhandled"
  | `custom:${string}`;

export interface Signal {
  name: SignalName;
  timestamp: Date;
  source: string;
  data?: Record<string, unknown>;
}

export type SignalHandler = (signal: Signal) => void | Promise<void>;

export interface SignalEmitter {
  emit(name: SignalName, source: string, data?: Record<string, unknown>): Promise<void>;
}

export class SignalBus implements SignalEmitter {
  private listeners = new Map<SignalName, Set<SignalHandler>>();

  on(name: SignalName, handler: SignalHandler): void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(handler);
  }

  off(name: SignalName, handler: SignalHandler): void {
    this.listeners.get(name)?.delete(handler);
  }

  once(name: SignalName, handler: SignalHandler): void {
    const wrapper: SignalHandler = async (signal) => {
      this.off(name, wrapper);
      await handler(signal);
    };
    this.on(name, wrapper);
  }

  async emit(name: SignalName, source: string, data?: Record<string, unknown>): Promise<void> {
    const signal: Signal = { name, timestamp: new Date(), source, data };
    const handlers = this.listeners.get(name);
    if (!handlers) return;
    for (const handler of handlers) {
      await handler(signal);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/events.test.ts`
Expected: 6 tests PASS

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/core/events.ts tests/unit/events.test.ts
git commit -m "feat: add Signal Bus event system

The foundation for Friday's reactive behavior. Signals are typed
events (file:changed, test:failed, etc.) that modules and directives
can listen to. Supports on/off/once/emit patterns."
```

---

### Task 2: Clearance System (Permissions)

**Files:**
- Create: `src/core/clearance.ts`
- Test: `tests/unit/clearance.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/clearance.test.ts
import { describe, test, expect } from "bun:test";
import { ClearanceManager } from "../../src/core/clearance.ts";
import type { ClearanceName } from "../../src/core/clearance.ts";

describe("ClearanceManager", () => {
  test("grants clearance when permission is in granted set", () => {
    const manager = new ClearanceManager(["read-fs", "git-read"]);
    const result = manager.check("read-fs");
    expect(result.granted).toBe(true);
  });

  test("denies clearance when permission is not granted", () => {
    const manager = new ClearanceManager(["read-fs"]);
    const result = manager.check("exec-shell");
    expect(result.granted).toBe(false);
    expect(result.reason).toContain("exec-shell");
  });

  test("checkAll passes when all permissions are granted", () => {
    const manager = new ClearanceManager(["read-fs", "write-fs", "git-read"]);
    const result = manager.checkAll(["read-fs", "git-read"]);
    expect(result.granted).toBe(true);
  });

  test("checkAll fails when any permission is missing", () => {
    const manager = new ClearanceManager(["read-fs"]);
    const result = manager.checkAll(["read-fs", "exec-shell"]);
    expect(result.granted).toBe(false);
    expect(result.reason).toContain("exec-shell");
  });

  test("grant adds a new clearance", () => {
    const manager = new ClearanceManager([]);
    manager.grant("network");
    expect(manager.check("network").granted).toBe(true);
  });

  test("revoke removes a clearance", () => {
    const manager = new ClearanceManager(["write-fs"]);
    manager.revoke("write-fs");
    expect(manager.check("write-fs").granted).toBe(false);
  });

  test("lists all granted clearances", () => {
    const manager = new ClearanceManager(["read-fs", "git-read"]);
    expect(manager.granted).toEqual(["read-fs", "git-read"]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/clearance.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Write the implementation**

```typescript
// src/core/clearance.ts

export type ClearanceName =
  | "read-fs"
  | "write-fs"
  | "delete-fs"
  | "exec-shell"
  | "network"
  | "git-read"
  | "git-write"
  | "provider"
  | "system";

export interface ClearanceCheck {
  granted: boolean;
  reason?: string;
}

export class ClearanceManager {
  private permissions: Set<ClearanceName>;

  constructor(granted: ClearanceName[] = []) {
    this.permissions = new Set(granted);
  }

  check(name: ClearanceName): ClearanceCheck {
    if (this.permissions.has(name)) {
      return { granted: true };
    }
    return { granted: false, reason: `Clearance denied: ${name} is not authorized` };
  }

  checkAll(names: ClearanceName[]): ClearanceCheck {
    for (const name of names) {
      const result = this.check(name);
      if (!result.granted) return result;
    }
    return { granted: true };
  }

  grant(name: ClearanceName): void {
    this.permissions.add(name);
  }

  revoke(name: ClearanceName): void {
    this.permissions.delete(name);
  }

  get granted(): ClearanceName[] {
    return [...this.permissions];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/clearance.test.ts`
Expected: 7 tests PASS

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/core/clearance.ts tests/unit/clearance.test.ts
git commit -m "feat: add Clearance permission system

Defines the security clearance levels (read-fs, write-fs, exec-shell,
network, etc.) that gate what modules and directives can do. The
ClearanceManager provides check/checkAll/grant/revoke operations."
```

---

### Task 3: Audit Logger

**Files:**
- Create: `src/audit/types.ts`
- Create: `src/audit/logger.ts`
- Test: `tests/unit/audit.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/audit.test.ts
import { describe, test, expect } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { AuditEntry } from "../../src/audit/types.ts";

describe("AuditLogger", () => {
  test("logs an entry and retrieves it", () => {
    const logger = new AuditLogger();
    logger.log({
      action: "tool:execute",
      source: "git-ops",
      detail: "Ran git status",
      success: true,
    });
    const entries = logger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("tool:execute");
    expect(entries[0]!.source).toBe("git-ops");
    expect(entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  test("stores multiple entries in order", () => {
    const logger = new AuditLogger();
    logger.log({ action: "protocol:execute", source: "core", detail: "first", success: true });
    logger.log({ action: "directive:fire", source: "core", detail: "second", success: false });
    const entries = logger.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.detail).toBe("first");
    expect(entries[1]!.detail).toBe("second");
  });

  test("filters entries by source", () => {
    const logger = new AuditLogger();
    logger.log({ action: "tool:execute", source: "git-ops", detail: "a", success: true });
    logger.log({ action: "tool:execute", source: "code-analysis", detail: "b", success: true });
    logger.log({ action: "tool:execute", source: "git-ops", detail: "c", success: true });
    const filtered = logger.entries({ source: "git-ops" });
    expect(filtered).toHaveLength(2);
  });

  test("clears all entries", () => {
    const logger = new AuditLogger();
    logger.log({ action: "tool:execute", source: "core", detail: "x", success: true });
    logger.clear();
    expect(logger.entries()).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audit.test.ts`
Expected: FAIL — cannot resolve modules

**Step 3: Write the types**

```typescript
// src/audit/types.ts

export interface AuditEntry {
  timestamp: Date;
  action: string;
  source: string;
  detail: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  source?: string;
  action?: string;
  since?: Date;
}
```

**Step 4: Write the implementation**

```typescript
// src/audit/logger.ts
import type { AuditEntry, AuditFilter } from "./types.ts";

export class AuditLogger {
  private logEntries: AuditEntry[] = [];

  log(entry: Omit<AuditEntry, "timestamp">): void {
    this.logEntries.push({ ...entry, timestamp: new Date() });
  }

  entries(filter?: AuditFilter): AuditEntry[] {
    let result = [...this.logEntries];
    if (filter?.source) {
      result = result.filter((e) => e.source === filter.source);
    }
    if (filter?.action) {
      result = result.filter((e) => e.action === filter.action);
    }
    if (filter?.since) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    return result;
  }

  clear(): void {
    this.logEntries = [];
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/audit.test.ts`
Expected: 4 tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/audit/types.ts src/audit/logger.ts tests/unit/audit.test.ts
git commit -m "feat: add Audit Logger for action tracking

Records all autonomous actions with timestamps, sources, and success
status. Supports filtering by source/action/time. This is Friday's
mission log — accountability for everything she does."
```

---

## Phase 2: Memory System

---

### Task 4: SQLite Memory — Key-Value Store

**Files:**
- Create: `src/core/memory.ts`
- Test: `tests/unit/memory.test.ts`

This task implements the key-value and conversation history parts of FridayMemory. Vector search is Task 5.

**Step 1: Write the failing tests**

```typescript
// tests/unit/memory.test.ts
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
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/memory.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Write the implementation**

```typescript
// src/core/memory.ts
import { Database } from "bun:sqlite";
import type { ConversationMessage } from "./types.ts";

export interface ConversationSession {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  provider: string;
  model: string;
  messages: ConversationMessage[];
  summary?: string;
}

export interface SemanticResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ScopedMemory {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export class SQLiteMemory {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        messages TEXT NOT NULL,
        summary TEXT
      );
    `);
  }

  async get<T>(namespace: string, key: string): Promise<T | undefined> {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        "SELECT value FROM kv WHERE namespace = ? AND key = ?",
      )
      .get(namespace, key);
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.db
      .query(
        "INSERT OR REPLACE INTO kv (namespace, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
      )
      .run(namespace, key, JSON.stringify(value));
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.db.query("DELETE FROM kv WHERE namespace = ? AND key = ?").run(namespace, key);
  }

  async list(namespace: string): Promise<string[]> {
    const rows = this.db
      .query<{ key: string }, [string]>("SELECT key FROM kv WHERE namespace = ?")
      .all(namespace);
    return rows.map((r) => r.key);
  }

  async saveConversation(session: ConversationSession): Promise<void> {
    this.db
      .query(
        "INSERT OR REPLACE INTO conversations (id, started_at, ended_at, provider, model, messages, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        session.startedAt.toISOString(),
        session.endedAt?.toISOString() ?? null,
        session.provider,
        session.model,
        JSON.stringify(session.messages),
        session.summary ?? null,
      );
  }

  async getConversationHistory(limit = 20): Promise<ConversationSession[]> {
    const rows = this.db
      .query<
        {
          id: string;
          started_at: string;
          ended_at: string | null;
          provider: string;
          model: string;
          messages: string;
          summary: string | null;
        },
        [number]
      >("SELECT * FROM conversations ORDER BY started_at DESC LIMIT ?")
      .all(limit);

    return rows.map((r) => ({
      id: r.id,
      startedAt: new Date(r.started_at),
      endedAt: r.ended_at ? new Date(r.ended_at) : undefined,
      provider: r.provider,
      model: r.model,
      messages: JSON.parse(r.messages) as ConversationMessage[],
      summary: r.summary ?? undefined,
    }));
  }

  scoped(namespace: string): ScopedMemory {
    return {
      get: <T>(key: string) => this.get<T>(namespace, key),
      set: <T>(key: string, value: T) => this.set(namespace, key, value),
      delete: (key: string) => this.delete(namespace, key),
      list: () => this.list(namespace),
    };
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/memory.test.ts`
Expected: 10 tests PASS

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/core/memory.ts tests/unit/memory.test.ts
git commit -m "feat: add SQLite-backed Memory system (key-value + conversations)

Friday's persistent memory using bun:sqlite. Namespaced key-value store
for module state, plus conversation history with reverse-chronological
retrieval. ScopedMemory interface gives modules an isolated view."
```

---

### Task 5: SQLite Memory — Semantic Search (FTS5)

**Files:**
- Modify: `src/core/memory.ts`
- Modify: `tests/unit/memory.test.ts`

**Step 1: Add failing tests for semantic search**

Append to `tests/unit/memory.test.ts`:

```typescript
describe("SQLiteMemory — Semantic Search", () => {
  let memory: SQLiteMemory;

  beforeEach(() => {
    memory = new SQLiteMemory(TEST_DB);
  });

  afterEach(() => {
    memory.close();
    try { unlinkSync(TEST_DB); } catch {}
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
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/memory.test.ts`
Expected: New tests FAIL — `embed` is not a function

**Step 3: Add FTS5 tables to migrate()**

Add to the `migrate()` method after existing tables:

```typescript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
    content,
    content_rowid='rowid'
  );
`);
```

**Step 4: Add embed/search/forget methods to SQLiteMemory**

```typescript
async embed(
  namespace: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  this.db
    .query("INSERT INTO embeddings (id, namespace, content, metadata) VALUES (?, ?, ?, ?)")
    .run(id, namespace, content, metadata ? JSON.stringify(metadata) : null);
  const row = this.db
    .query<{ rowid: number }, [string]>("SELECT rowid FROM embeddings WHERE id = ?")
    .get(id);
  if (row) {
    this.db
      .query("INSERT INTO embeddings_fts (rowid, content) VALUES (?, ?)")
      .run(row.rowid, content);
  }
  return id;
}

async search(namespace: string, query: string, limit = 5): Promise<SemanticResult[]> {
  const sanitized = query.replace(/['"*()]/g, " ").trim();
  if (!sanitized) return [];
  const terms = sanitized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const ftsQuery = terms.map((t) => `"${t}"*`).join(" OR ");

  try {
    const rows = this.db
      .query<
        { id: string; content: string; metadata: string | null; rank: number },
        [string, string, number]
      >(
        `SELECT e.id, e.content, e.metadata, fts.rank
         FROM embeddings_fts fts
         JOIN embeddings e ON e.rowid = fts.rowid
         WHERE embeddings_fts MATCH ?1 AND e.namespace = ?2
         ORDER BY fts.rank
         LIMIT ?3`,
      )
      .all(ftsQuery, namespace, limit);

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      similarity: Math.abs(r.rank),
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  } catch {
    return [];
  }
}

async forget(namespace: string, embeddingId: string): Promise<void> {
  const row = this.db
    .query<{ rowid: number }, [string]>("SELECT rowid FROM embeddings WHERE id = ?")
    .get(embeddingId);
  if (row) {
    this.db.query("DELETE FROM embeddings_fts WHERE rowid = ?").run(row.rowid);
  }
  this.db
    .query("DELETE FROM embeddings WHERE id = ? AND namespace = ?")
    .run(embeddingId, namespace);
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/memory.test.ts`
Expected: 15 tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/core/memory.ts tests/unit/memory.test.ts
git commit -m "feat: add semantic search to Memory via SQLite FTS5

Term-frequency search using FTS5 as a pragmatic v1 for the semantic
memory interface. Namespace-isolated, with metadata support."
```

---

## Phase 3: Module & Protocol Systems

---

### Task 6: Module Types and Loader

**Files:**
- Create: `src/modules/types.ts`
- Create: `src/modules/loader.ts`
- Test: `tests/unit/modules.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/modules.test.ts
import { describe, test, expect } from "bun:test";
import { validateModule } from "../../src/modules/loader.ts";
import type { FridayModule } from "../../src/modules/types.ts";

const validModule: FridayModule = {
  name: "test-module",
  description: "A test module",
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
};

describe("Module Validation", () => {
  test("accepts a valid module manifest", () => {
    const result = validateModule(validModule);
    expect(result.valid).toBe(true);
  });

  test("rejects module without name", () => {
    const mod = { ...validModule, name: "" };
    const result = validateModule(mod);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  test("rejects module without version", () => {
    const mod = { ...validModule, version: "" };
    const result = validateModule(mod);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("version");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/modules.test.ts`
Expected: FAIL — cannot resolve modules

**Step 3: Write the module types**

```typescript
// src/modules/types.ts
import type { ClearanceName } from "../core/clearance.ts";
import type { SignalName } from "../core/events.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalEmitter } from "../core/events.ts";
import type { ScopedMemory } from "../core/memory.ts";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolContext {
  workingDirectory: string;
  audit: AuditLogger;
  signal: SignalEmitter;
  memory: ScopedMemory;
}

export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: Record<string, unknown>;
}

export interface FridayTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface FridayProtocol {
  name: string;
  description: string;
  aliases: string[];
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(
    args: Record<string, unknown>,
    context: ProtocolContext,
  ): Promise<ProtocolResult>;
}

export interface ProtocolContext extends ToolContext {
  tools: Map<string, FridayTool>;
}

export interface ProtocolResult {
  success: boolean;
  summary: string;
  details?: string;
}

export interface FridayModule {
  name: string;
  description: string;
  version: string;
  tools: FridayTool[];
  protocols: FridayProtocol[];
  knowledge: string[];
  triggers: SignalName[];
  clearance: ClearanceName[];
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
}
```

**Step 4: Write the loader**

```typescript
// src/modules/loader.ts
import type { FridayModule } from "./types.ts";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateModule(mod: FridayModule): ValidationResult {
  if (!mod.name || mod.name.trim() === "") {
    return { valid: false, error: "Module must have a non-empty name" };
  }
  if (!mod.version || mod.version.trim() === "") {
    return { valid: false, error: "Module must have a non-empty version" };
  }
  if (!mod.description || mod.description.trim() === "") {
    return { valid: false, error: "Module must have a non-empty description" };
  }
  return { valid: true };
}

export async function discoverModules(modulesDir: string): Promise<FridayModule[]> {
  const modules: FridayModule[] = [];
  const { readdir } = await import("node:fs/promises");

  let entries: string[];
  try {
    entries = await readdir(modulesDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const indexPath = `${modulesDir}/${entry}/index.ts`;
    const file = Bun.file(indexPath);
    if (!(await file.exists())) continue;

    try {
      const mod = await import(indexPath);
      const manifest: FridayModule = mod.default ?? mod;
      const validation = validateModule(manifest);
      if (validation.valid) {
        modules.push(manifest);
      } else {
        console.warn(`Skipping invalid module at ${indexPath}: ${validation.error}`);
      }
    } catch (err) {
      console.warn(`Failed to load module at ${indexPath}:`, err);
    }
  }

  return modules;
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/modules.test.ts`
Expected: 3 tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/modules/types.ts src/modules/loader.ts tests/unit/modules.test.ts
git commit -m "feat: add Module type system and loader

Defines FridayModule, FridayTool, FridayProtocol interfaces and the
module discovery system. Modules are auto-discovered from subdirectories,
validated against the manifest contract, and loaded at runtime."
```

---

### Task 7: Protocol Registry

**Files:**
- Create: `src/protocols/types.ts`
- Create: `src/protocols/registry.ts`
- Test: `tests/unit/protocols.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/protocols.test.ts
import { describe, test, expect } from "bun:test";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import type { FridayProtocol, ProtocolResult } from "../../src/modules/types.ts";

function makeProtocol(name: string, aliases: string[] = []): FridayProtocol {
  return {
    name,
    description: `${name} protocol`,
    aliases,
    parameters: [],
    clearance: [],
    execute: async (): Promise<ProtocolResult> => ({
      success: true,
      summary: `${name} done`,
    }),
  };
}

describe("ProtocolRegistry", () => {
  test("registers and retrieves a protocol by name", () => {
    const registry = new ProtocolRegistry();
    const proto = makeProtocol("deploy");
    registry.register(proto);
    expect(registry.get("deploy")).toBe(proto);
  });

  test("retrieves by alias", () => {
    const registry = new ProtocolRegistry();
    const proto = makeProtocol("security-scan", ["scan", "sec"]);
    registry.register(proto);
    expect(registry.get("scan")).toBe(proto);
    expect(registry.get("sec")).toBe(proto);
  });

  test("returns undefined for unknown protocol", () => {
    const registry = new ProtocolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("lists all registered protocols", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    registry.register(makeProtocol("scan"));
    const names = registry.list().map((p) => p.name);
    expect(names).toContain("deploy");
    expect(names).toContain("scan");
  });

  test("isProtocol detects /command syntax", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    expect(registry.isProtocol("/deploy")).toBe(true);
    expect(registry.isProtocol("/unknown")).toBe(false);
    expect(registry.isProtocol("just a message")).toBe(false);
  });

  test("parseProtocolInput extracts name and args", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    const parsed = registry.parseProtocolInput("/deploy --env production");
    expect(parsed?.name).toBe("deploy");
    expect(parsed?.rawArgs).toBe("--env production");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/protocols.test.ts`
Expected: FAIL — cannot resolve modules

**Step 3: Write the types (re-export)**

```typescript
// src/protocols/types.ts
export type {
  FridayProtocol,
  ProtocolContext,
  ProtocolResult,
} from "../modules/types.ts";
```

**Step 4: Write the registry**

```typescript
// src/protocols/registry.ts
import type { FridayProtocol } from "./types.ts";

export interface ParsedProtocolInput {
  name: string;
  rawArgs: string;
}

export class ProtocolRegistry {
  private protocols = new Map<string, FridayProtocol>();
  private aliases = new Map<string, string>();

  register(protocol: FridayProtocol): void {
    this.protocols.set(protocol.name, protocol);
    for (const alias of protocol.aliases) {
      this.aliases.set(alias, protocol.name);
    }
  }

  get(nameOrAlias: string): FridayProtocol | undefined {
    return (
      this.protocols.get(nameOrAlias) ??
      this.protocols.get(this.aliases.get(nameOrAlias) ?? "")
    );
  }

  list(): FridayProtocol[] {
    return [...this.protocols.values()];
  }

  isProtocol(input: string): boolean {
    if (!input.startsWith("/")) return false;
    const name = input.slice(1).split(/\s+/)[0] ?? "";
    return this.get(name) !== undefined;
  }

  parseProtocolInput(input: string): ParsedProtocolInput | undefined {
    if (!input.startsWith("/")) return undefined;
    const parts = input.slice(1).split(/\s+/);
    const name = parts[0] ?? "";
    if (!this.get(name)) return undefined;
    return { name, rawArgs: parts.slice(1).join(" ") };
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/protocols.test.ts`
Expected: 6 tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/protocols/types.ts src/protocols/registry.ts tests/unit/protocols.test.ts
git commit -m "feat: add Protocol Registry for slash commands

Maps protocol names and aliases to handlers. Detects /command syntax,
parses input into name + args. Protocols bypass LLM reasoning for
direct execution."
```

---

## Phase 4: Notification System

---

### Task 8: Notification Channels

**Files:**
- Create: `src/core/notifications.ts`
- Test: `tests/unit/notifications.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/notifications.test.ts
import { describe, test, expect } from "bun:test";
import {
  NotificationManager,
  TerminalChannel,
  LogChannel,
} from "../../src/core/notifications.ts";
import type { NotificationChannel } from "../../src/core/notifications.ts";

describe("NotificationManager", () => {
  test("sends notification to all registered channels", async () => {
    const sent: string[] = [];
    const ch1: NotificationChannel = {
      name: "ch1",
      send: async (n) => { sent.push(`ch1:${n.title}`); },
    };
    const ch2: NotificationChannel = {
      name: "ch2",
      send: async (n) => { sent.push(`ch2:${n.title}`); },
    };
    const manager = new NotificationManager([ch1, ch2]);
    await manager.notify({
      level: "info",
      title: "Test",
      body: "hello",
      source: "test",
    });
    expect(sent).toEqual(["ch1:Test", "ch2:Test"]);
  });

  test("sends to specific channels only", async () => {
    const sent: string[] = [];
    const ch1: NotificationChannel = {
      name: "terminal",
      send: async () => { sent.push("terminal"); },
    };
    const ch2: NotificationChannel = {
      name: "slack",
      send: async () => { sent.push("slack"); },
    };
    const manager = new NotificationManager([ch1, ch2]);
    await manager.notify(
      { level: "info", title: "Test", body: "hello", source: "test" },
      ["terminal"],
    );
    expect(sent).toEqual(["terminal"]);
  });

  test("continues sending if one channel fails", async () => {
    const sent: string[] = [];
    const failing: NotificationChannel = {
      name: "failing",
      send: async () => { throw new Error("boom"); },
    };
    const working: NotificationChannel = {
      name: "working",
      send: async () => { sent.push("ok"); },
    };
    const manager = new NotificationManager([failing, working]);
    await manager.notify({
      level: "alert",
      title: "Test",
      body: "hello",
      source: "test",
    });
    expect(sent).toEqual(["ok"]);
  });
});

describe("TerminalChannel", () => {
  test("has name 'terminal'", () => {
    const channel = new TerminalChannel();
    expect(channel.name).toBe("terminal");
  });
});

describe("LogChannel", () => {
  test("has name 'log'", () => {
    const channel = new LogChannel("/tmp/friday-test-notifications.log");
    expect(channel.name).toBe("log");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/notifications.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Write the implementation**

```typescript
// src/core/notifications.ts
import chalk from "chalk";

export interface FridayNotification {
  level: "info" | "warning" | "alert";
  title: string;
  body: string;
  source: string;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  protocol: string;
  args?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  send(notification: FridayNotification): Promise<void>;
}

export class NotificationManager {
  private channels: Map<string, NotificationChannel>;

  constructor(channels: NotificationChannel[] = []) {
    this.channels = new Map(channels.map((c) => [c.name, c]));
  }

  addChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
  }

  async notify(
    notification: FridayNotification,
    channelNames?: string[],
  ): Promise<void> {
    const targets = channelNames
      ? (channelNames
          .map((n) => this.channels.get(n))
          .filter(Boolean) as NotificationChannel[])
      : [...this.channels.values()];

    for (const channel of targets) {
      try {
        await channel.send(notification);
      } catch (err) {
        console.error(`Notification channel '${channel.name}' failed:`, err);
      }
    }
  }
}

export class TerminalChannel implements NotificationChannel {
  name = "terminal";

  async send(notification: FridayNotification): Promise<void> {
    const prefix = {
      info: chalk.blue("[INFO]"),
      warning: chalk.yellow("[WARN]"),
      alert: chalk.red.bold("[ALERT]"),
    }[notification.level];
    console.log(
      `\n${prefix} ${chalk.bold(notification.title)}\n${notification.body}\n`,
    );
  }
}

export class LogChannel implements NotificationChannel {
  name = "log";
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async send(notification: FridayNotification): Promise<void> {
    const line = `[${new Date().toISOString()}] [${notification.level.toUpperCase()}] [${notification.source}] ${notification.title}: ${notification.body}\n`;
    const file = Bun.file(this.logPath);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(this.logPath, existing + line);
  }
}

export class WebhookChannel implements NotificationChannel {
  name = "webhook";
  private url: string;
  private headers: Record<string, string>;

  constructor(config: { url: string; headers?: Record<string, string> }) {
    this.url = config.url;
    this.headers = config.headers ?? {};
  }

  async send(notification: FridayNotification): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(notification),
    });
  }
}

export class SlackChannel implements NotificationChannel {
  name = "slack";
  private webhookUrl: string;

  constructor(config: { webhookUrl: string }) {
    this.webhookUrl = config.webhookUrl;
  }

  async send(notification: FridayNotification): Promise<void> {
    const emoji = {
      info: ":information_source:",
      warning: ":warning:",
      alert: ":rotating_light:",
    };
    await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${emoji[notification.level]} *${notification.title}*\n${notification.body}`,
      }),
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/notifications.test.ts`
Expected: 5 tests PASS

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/core/notifications.ts tests/unit/notifications.test.ts
git commit -m "feat: add Notification system with multi-channel support

NotificationManager dispatches alerts to Terminal, Log, Slack, and
Webhook channels. Channels are pluggable. Errors in one channel
don't block others."
```

---

## Phase 5: Directive Engine

---

### Task 9: Directive Types and Store

**Files:**
- Create: `src/directives/types.ts`
- Create: `src/directives/store.ts`
- Test: `tests/unit/directives.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/directives.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { DirectiveStore } from "../../src/directives/store.ts";
import type { FridayDirective } from "../../src/directives/types.ts";

function makeDirective(
  overrides: Partial<FridayDirective> = {},
): FridayDirective {
  return {
    id: crypto.randomUUID(),
    name: "test-directive",
    description: "A test directive",
    enabled: true,
    trigger: { type: "manual" },
    action: { type: "prompt", prompt: "Do something" },
    clearance: [],
    executionCount: 0,
    ...overrides,
  };
}

describe("DirectiveStore", () => {
  let store: DirectiveStore;

  beforeEach(() => {
    store = new DirectiveStore();
  });

  test("adds and retrieves a directive", () => {
    const d = makeDirective({ id: "d1", name: "lint-before-commit" });
    store.add(d);
    expect(store.get("d1")).toEqual(d);
  });

  test("lists all directives", () => {
    store.add(makeDirective({ id: "d1" }));
    store.add(makeDirective({ id: "d2" }));
    expect(store.list()).toHaveLength(2);
  });

  test("lists only enabled directives", () => {
    store.add(makeDirective({ id: "d1", enabled: true }));
    store.add(makeDirective({ id: "d2", enabled: false }));
    expect(store.listEnabled()).toHaveLength(1);
  });

  test("removes a directive", () => {
    store.add(makeDirective({ id: "d1" }));
    store.remove("d1");
    expect(store.get("d1")).toBeUndefined();
  });

  test("updates a directive", () => {
    store.add(makeDirective({ id: "d1", name: "old" }));
    store.update("d1", { name: "new" });
    expect(store.get("d1")?.name).toBe("new");
  });

  test("finds directives by signal trigger", () => {
    store.add(
      makeDirective({
        id: "d1",
        trigger: { type: "signal", signal: "file:changed" },
      }),
    );
    store.add(
      makeDirective({
        id: "d2",
        trigger: { type: "signal", signal: "test:failed" },
      }),
    );
    store.add(makeDirective({ id: "d3", trigger: { type: "manual" } }));
    const matched = store.findBySignal("file:changed");
    expect(matched).toHaveLength(1);
    expect(matched[0]!.id).toBe("d1");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/directives.test.ts`
Expected: FAIL — cannot resolve modules

**Step 3: Write the types**

```typescript
// src/directives/types.ts
import type { ClearanceName } from "../core/clearance.ts";
import type { SignalName } from "../core/events.ts";

export interface FridayDirective {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: DirectiveTrigger;
  action: DirectiveAction;
  clearance: ClearanceName[];
  executionCount: number;
  notify?: {
    channels: string[];
    level: "info" | "warning" | "alert";
  };
}

export type DirectiveTrigger =
  | { type: "signal"; signal: SignalName }
  | { type: "schedule"; cron: string }
  | { type: "pattern"; pattern: string }
  | { type: "manual" };

export type DirectiveAction =
  | { type: "protocol"; protocol: string; args?: Record<string, unknown> }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  | { type: "prompt"; prompt: string }
  | { type: "sequence"; steps: DirectiveAction[] };
```

**Step 4: Write the store**

```typescript
// src/directives/store.ts
import type { SignalName } from "../core/events.ts";
import type { FridayDirective } from "./types.ts";

export class DirectiveStore {
  private directives = new Map<string, FridayDirective>();

  add(directive: FridayDirective): void {
    this.directives.set(directive.id, directive);
  }

  get(id: string): FridayDirective | undefined {
    return this.directives.get(id);
  }

  remove(id: string): void {
    this.directives.delete(id);
  }

  update(id: string, updates: Partial<FridayDirective>): void {
    const existing = this.directives.get(id);
    if (existing) {
      this.directives.set(id, { ...existing, ...updates });
    }
  }

  list(): FridayDirective[] {
    return [...this.directives.values()];
  }

  listEnabled(): FridayDirective[] {
    return this.list().filter((d) => d.enabled);
  }

  findBySignal(signal: SignalName): FridayDirective[] {
    return this.listEnabled().filter(
      (d) => d.trigger.type === "signal" && d.trigger.signal === signal,
    );
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/directives.test.ts`
Expected: 6 tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/directives/types.ts src/directives/store.ts tests/unit/directives.test.ts
git commit -m "feat: add Directive types and in-memory store

Directives are persistent rules with trigger types (signal, schedule,
pattern, manual) and action types (protocol, tool, prompt, sequence).
The DirectiveStore manages CRUD and signal-based lookup."
```

---

### Task 10: Directive Engine (Execution)

**Files:**
- Create: `src/directives/engine.ts`
- Test: `tests/unit/directive-engine.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/directive-engine.test.ts
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { DirectiveEngine } from "../../src/directives/engine.ts";
import { DirectiveStore } from "../../src/directives/store.ts";
import { SignalBus } from "../../src/core/events.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import type { FridayDirective } from "../../src/directives/types.ts";

describe("DirectiveEngine", () => {
  let store: DirectiveStore;
  let signals: SignalBus;
  let audit: AuditLogger;
  let clearance: ClearanceManager;
  let engine: DirectiveEngine;

  beforeEach(() => {
    store = new DirectiveStore();
    signals = new SignalBus();
    audit = new AuditLogger();
    clearance = new ClearanceManager(["read-fs", "exec-shell", "provider"]);
    engine = new DirectiveEngine({ store, signals, audit, clearance });
  });

  test("fires a directive when its signal triggers", async () => {
    const executed = mock(() => {});
    const directive: FridayDirective = {
      id: "d1",
      name: "on-file-change",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "file:changed" },
      action: { type: "prompt", prompt: "Analyze the change" },
      clearance: ["read-fs"],
      executionCount: 0,
    };
    store.add(directive);
    engine.onDirectiveAction(executed);
    engine.start();
    await signals.emit("file:changed", "test", { path: "/foo.ts" });
    expect(executed).toHaveBeenCalledTimes(1);
  });

  test("does not fire disabled directives", async () => {
    const executed = mock(() => {});
    store.add({
      id: "d1",
      name: "disabled",
      description: "Test",
      enabled: false,
      trigger: { type: "signal", signal: "file:changed" },
      action: { type: "prompt", prompt: "test" },
      clearance: [],
      executionCount: 0,
    });
    engine.onDirectiveAction(executed);
    engine.start();
    await signals.emit("file:changed", "test");
    expect(executed).not.toHaveBeenCalled();
  });

  test("blocks directive when clearance denied", async () => {
    const executed = mock(() => {});
    const restrictedClearance = new ClearanceManager([]);
    const restrictedEngine = new DirectiveEngine({
      store,
      signals,
      audit,
      clearance: restrictedClearance,
    });
    store.add({
      id: "d1",
      name: "needs-shell",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "test:failed" },
      action: { type: "tool", tool: "shell.exec" },
      clearance: ["exec-shell"],
      executionCount: 0,
    });
    restrictedEngine.onDirectiveAction(executed);
    restrictedEngine.start();
    await signals.emit("test:failed", "test");
    expect(executed).not.toHaveBeenCalled();
    expect(audit.entries().some((e) => !e.success)).toBe(true);
  });

  test("increments execution count", async () => {
    const directive: FridayDirective = {
      id: "d1",
      name: "counter",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "session:start" },
      action: { type: "prompt", prompt: "hello" },
      clearance: [],
      executionCount: 0,
    };
    store.add(directive);
    engine.onDirectiveAction(() => {});
    engine.start();
    await signals.emit("session:start", "test");
    expect(store.get("d1")?.executionCount).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/directive-engine.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Write the implementation**

```typescript
// src/directives/engine.ts
import type { SignalBus, Signal, SignalName } from "../core/events.ts";
import type { ClearanceManager } from "../core/clearance.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { DirectiveStore } from "./store.ts";
import type { FridayDirective, DirectiveAction } from "./types.ts";

export interface DirectiveEngineConfig {
  store: DirectiveStore;
  signals: SignalBus;
  audit: AuditLogger;
  clearance: ClearanceManager;
}

export type DirectiveActionHandler = (
  directive: FridayDirective,
  action: DirectiveAction,
) => void | Promise<void>;

export class DirectiveEngine {
  private store: DirectiveStore;
  private signals: SignalBus;
  private audit: AuditLogger;
  private clearance: ClearanceManager;
  private actionHandler?: DirectiveActionHandler;

  constructor(config: DirectiveEngineConfig) {
    this.store = config.store;
    this.signals = config.signals;
    this.audit = config.audit;
    this.clearance = config.clearance;
  }

  onDirectiveAction(handler: DirectiveActionHandler): void {
    this.actionHandler = handler;
  }

  start(): void {
    const signalTypes: SignalName[] = [
      "file:changed",
      "file:created",
      "file:deleted",
      "test:passed",
      "test:failed",
      "command:pre-execute",
      "command:post-execute",
      "command:pre-commit",
      "session:start",
      "session:end",
      "error:unhandled",
    ];

    for (const signalName of signalTypes) {
      this.signals.on(signalName, (signal) => this.handleSignal(signal));
    }
  }

  private async handleSignal(signal: Signal): Promise<void> {
    const directives = this.store.findBySignal(signal.name);
    for (const directive of directives) {
      await this.executeDirective(directive, signal);
    }
  }

  private async executeDirective(
    directive: FridayDirective,
    signal: Signal,
  ): Promise<void> {
    if (directive.clearance.length > 0) {
      const check = this.clearance.checkAll(directive.clearance);
      if (!check.granted) {
        this.audit.log({
          action: "directive:blocked",
          source: directive.name,
          detail: `Clearance denied: ${check.reason}`,
          success: false,
        });
        return;
      }
    }

    this.store.update(directive.id, {
      executionCount: directive.executionCount + 1,
    });

    this.audit.log({
      action: "directive:fire",
      source: directive.name,
      detail: `Triggered by ${signal.name}`,
      success: true,
      metadata: { signal: signal.name, directiveId: directive.id },
    });

    if (this.actionHandler) {
      await this.actionHandler(directive, directive.action);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/directive-engine.test.ts`
Expected: 4 tests PASS

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/directives/engine.ts tests/unit/directive-engine.test.ts
git commit -m "feat: add Directive Engine for autonomous rule execution

The DirectiveEngine listens to signals, matches them against active
directives, checks clearance, and fires actions. Tracks execution
count and logs all activity to the audit system."
```

---

## Phase 6: Cortex (Evolve FridayCore)

---

### Task 11: Rename FridayCore to Cortex and add tool registration

**Files:**
- Create: `src/core/cortex.ts` (new file based on friday.ts)
- Delete: `src/core/friday.ts` (replaced by cortex.ts)
- Modify: `src/cli/commands/chat.ts` (update import)
- Modify: `tests/unit/friday.test.ts` (update import and test names)

**Step 1: Update tests to use Cortex**

```typescript
// tests/unit/friday.test.ts
import { describe, test, expect } from "bun:test";
import { SYSTEM_PROMPT } from "../../src/core/prompts.ts";
import { Cortex } from "../../src/core/cortex.ts";

describe("Cortex", () => {
  test("system prompt is defined and non-empty", () => {
    expect(SYSTEM_PROMPT).toBeDefined();
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(SYSTEM_PROMPT).toContain("Friday");
  });

  test("defaults to anthropic provider", () => {
    const cortex = new Cortex();
    expect(cortex.providerName).toBe("anthropic");
  });

  test("defaults to claude-sonnet-4-20250514 model", () => {
    const cortex = new Cortex();
    expect(cortex.modelName).toBe("claude-sonnet-4-20250514");
  });

  test("accepts custom model", () => {
    const cortex = new Cortex({ model: "claude-haiku-4-5-20251001" });
    expect(cortex.modelName).toBe("claude-haiku-4-5-20251001");
  });

  test("exposes available tools (empty by default)", () => {
    const cortex = new Cortex();
    expect(cortex.availableTools).toEqual([]);
  });

  test("registers tools", () => {
    const cortex = new Cortex();
    cortex.registerTool({
      name: "test-tool",
      description: "A test tool",
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, output: "done" }),
    });
    expect(cortex.availableTools).toHaveLength(1);
    expect(cortex.availableTools[0]!.name).toBe("test-tool");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — cannot resolve `cortex.ts`

**Step 3: Create `src/core/cortex.ts`**

```typescript
// src/core/cortex.ts
import type { FridayConfig, ConversationMessage } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
} from "../providers/index.ts";
import type { FridayTool } from "../modules/types.ts";

export class Cortex {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];
  private tools: Map<string, FridayTool>;

  constructor(config: Partial<FridayConfig> = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
    this.tools = new Map();
  }

  get providerName(): string {
    return this.provider.name;
  }

  get modelName(): string {
    return this.model;
  }

  get availableTools(): FridayTool[] {
    return [...this.tools.values()];
  }

  registerTool(tool: FridayTool): void {
    this.tools.set(tool.name, tool);
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    const assistantMessage = await this.provider.chat(
      SYSTEM_PROMPT,
      this.conversationHistory,
      { model: this.model, maxTokens: this.maxTokens },
    );

    this.conversationHistory.push({ role: "assistant", content: assistantMessage });
    return assistantMessage;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  get historyLength(): number {
    return this.conversationHistory.length;
  }
}

export { Cortex as FridayCore };
```

**Step 4: Delete `src/core/friday.ts`**

```bash
rm src/core/friday.ts
```

**Step 5: Update `src/cli/commands/chat.ts` import**

Change:
```typescript
import { FridayCore } from "../../core/friday.ts";
```
To:
```typescript
import { Cortex } from "../../core/cortex.ts";
```
And change `new FridayCore(...)` to `new Cortex(...)`.

**Step 6: Run all tests to verify they pass**

Run: `bun test`
Expected: All tests PASS

**Step 7: Lint and commit**

```bash
bun run lint:fix
git add -A
git commit -m "feat: evolve FridayCore into Cortex with tool registration

Renames FridayCore to Cortex (Friday's brain). Adds tool registration
for modules. Maintains backwards compat via re-export. Deletes old
friday.ts."
```

---

## Phase 7: Runtime Bootstrap

---

### Task 12: FridayRuntime — Wire everything together

**Files:**
- Create: `src/core/runtime.ts`
- Test: `tests/unit/runtime.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/runtime.test.ts
import { describe, test, expect } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";

describe("FridayRuntime", () => {
  test("boots with default configuration", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    expect(runtime.isBooted).toBe(true);
  });

  test("exposes cortex after boot", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    expect(runtime.cortex).toBeDefined();
    expect(runtime.cortex.providerName).toBe("anthropic");
  });

  test("exposes protocol registry after boot", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    expect(runtime.protocols).toBeDefined();
  });

  test("exposes signal bus after boot", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    expect(runtime.signals).toBeDefined();
  });

  test("process routes protocol input to protocol handler", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    runtime.protocols.register({
      name: "test",
      description: "test",
      aliases: [],
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, summary: "Protocol executed" }),
    });
    const result = await runtime.process("/test");
    expect(result.output).toContain("Protocol executed");
  });

  test("non-protocol input is not detected as protocol", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    expect(runtime.protocols.isProtocol("hello")).toBe(false);
  });

  test("shutdown completes cleanly", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot();
    await runtime.shutdown();
    expect(runtime.isBooted).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Write the implementation**

```typescript
// src/core/runtime.ts
import type { FridayConfig } from "./types.ts";
import { Cortex } from "./cortex.ts";
import { SignalBus } from "./events.ts";
import { ClearanceManager } from "./clearance.ts";
import { AuditLogger } from "../audit/logger.ts";
import { ProtocolRegistry } from "../protocols/registry.ts";
import { DirectiveStore } from "../directives/store.ts";
import { DirectiveEngine } from "../directives/engine.ts";
import { NotificationManager, TerminalChannel } from "./notifications.ts";
import { discoverModules } from "../modules/loader.ts";
import type { FridayModule } from "../modules/types.ts";

export interface RuntimeConfig extends Partial<FridayConfig> {
  modulesDir?: string;
}

export interface ProcessResult {
  output: string;
  source: "protocol" | "cortex";
}

export class FridayRuntime {
  private _cortex!: Cortex;
  private _signals!: SignalBus;
  private _clearance!: ClearanceManager;
  private _audit!: AuditLogger;
  private _protocols!: ProtocolRegistry;
  private _directives!: DirectiveStore;
  private _directiveEngine!: DirectiveEngine;
  private _notifications!: NotificationManager;
  private _modules: FridayModule[] = [];
  private _booted = false;

  get isBooted(): boolean {
    return this._booted;
  }

  get cortex(): Cortex {
    return this._cortex;
  }

  get protocols(): ProtocolRegistry {
    return this._protocols;
  }

  get signals(): SignalBus {
    return this._signals;
  }

  get audit(): AuditLogger {
    return this._audit;
  }

  async boot(config: RuntimeConfig = {}): Promise<void> {
    this._signals = new SignalBus();
    this._clearance = new ClearanceManager([
      "read-fs",
      "write-fs",
      "exec-shell",
      "network",
      "git-read",
      "git-write",
      "provider",
    ]);
    this._audit = new AuditLogger();
    this._notifications = new NotificationManager([new TerminalChannel()]);
    this._protocols = new ProtocolRegistry();
    this._directives = new DirectiveStore();
    this._directiveEngine = new DirectiveEngine({
      store: this._directives,
      signals: this._signals,
      audit: this._audit,
      clearance: this._clearance,
    });
    this._directiveEngine.start();
    this._cortex = new Cortex(config);

    if (config.modulesDir) {
      this._modules = await discoverModules(config.modulesDir);
      for (const mod of this._modules) {
        for (const tool of mod.tools) {
          this._cortex.registerTool(tool);
        }
        for (const protocol of mod.protocols) {
          this._protocols.register(protocol);
        }
        if (mod.onLoad) {
          await mod.onLoad();
        }
      }
    }

    await this._signals.emit("session:start", "runtime");
    this._booted = true;

    this._audit.log({
      action: "runtime:boot",
      source: "runtime",
      detail: `Friday online. Provider: ${this._cortex.providerName}, Modules: ${this._modules.length}`,
      success: true,
    });
  }

  async process(input: string): Promise<ProcessResult> {
    if (this._protocols.isProtocol(input)) {
      const parsed = this._protocols.parseProtocolInput(input);
      if (parsed) {
        const protocol = this._protocols.get(parsed.name);
        if (protocol) {
          const result = await protocol.execute(
            {},
            {
              workingDirectory: process.cwd(),
              audit: this._audit,
              signal: this._signals,
              memory: {
                get: async () => undefined,
                set: async () => {},
                delete: async () => {},
                list: async () => [],
              },
              tools: new Map(),
            },
          );
          return { output: result.summary, source: "protocol" };
        }
      }
    }

    const response = await this._cortex.chat(input);
    await this._signals.emit("command:post-execute", "cortex");
    return { output: response, source: "cortex" };
  }

  async shutdown(): Promise<void> {
    await this._signals.emit("session:end", "runtime");
    for (const mod of this._modules) {
      if (mod.onUnload) {
        await mod.onUnload();
      }
    }
    this._audit.log({
      action: "runtime:shutdown",
      source: "runtime",
      detail: "Friday going offline",
      success: true,
    });
    this._booted = false;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: 6 tests PASS

**Step 5: Run ALL tests**

Run: `bun test`
Expected: All tests PASS

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/core/runtime.ts tests/unit/runtime.test.ts
git commit -m "feat: add FridayRuntime boot and process orchestrator

Wires together Cortex, SignalBus, ClearanceManager, AuditLogger,
ProtocolRegistry, DirectiveEngine, and NotificationManager. Routes
/protocol input directly, everything else through Cortex reasoning."
```

---

## Phase 8: CLI Integration

---

### Task 13: Update CLI to use FridayRuntime

**Files:**
- Modify: `src/cli/commands/chat.ts`

**Step 1: Rewrite chat.ts to use FridayRuntime**

Replace the full content with the version that uses `FridayRuntime` instead of `FridayCore`/`Cortex` directly:

```typescript
// src/cli/commands/chat.ts
import type { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { FridayRuntime } from "../../core/runtime.ts";
import type { ProviderName } from "../../core/types.ts";

export function chatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session with Friday")
    .option(
      "-p, --provider <provider>",
      "LLM provider to use (anthropic, grok)",
      "anthropic",
    )
    .option("-m, --model <model>", "Model to use (defaults per provider)")
    .action(async (options) => {
      const runtime = new FridayRuntime();
      try {
        await runtime.boot({
          provider: options.provider as ProviderName,
          model: options.model,
        });
      } catch (error) {
        if (error instanceof Error) {
          console.error(chalk.red(`\n${error.message}\n`));
        }
        process.exit(1);
      }

      const providerLabel = chalk.dim(
        `(${runtime.cortex.providerName}: ${runtime.cortex.modelName})`,
      );
      console.log(
        chalk.cyan(
          `\nHey boss! What can I help you with? ${providerLabel}\n`,
        ),
      );
      console.log(
        chalk.dim(
          "Type 'exit' or 'quit' to end the session. Use /command for protocols.\n",
        ),
      );

      while (true) {
        const { message } = await inquirer.prompt<{ message: string }>([
          {
            type: "input",
            name: "message",
            message: chalk.green("You >"),
            validate: (input: string) =>
              input.trim().length > 0 || "Please enter a message",
          },
        ]);

        if (
          ["exit", "quit", "bye"].includes(message.toLowerCase().trim())
        ) {
          await runtime.shutdown();
          console.log(chalk.cyan("\nSee you later, boss! \u{1F44B}\n"));
          break;
        }

        const spinner = ora({
          text: chalk.dim("Friday is thinking..."),
          spinner: "dots",
        }).start();

        try {
          const result = await runtime.process(message);
          spinner.stop();
          const prefix =
            result.source === "protocol"
              ? chalk.magenta("Protocol >")
              : chalk.cyan("Friday >");
          console.log(`\n${prefix} ${result.output}\n`);
        } catch (error) {
          spinner.fail(chalk.red("Something went wrong"));
          if (error instanceof Error) {
            console.error(chalk.red(`Error: ${error.message}\n`));
          }
        }
      }
    });
}
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 3: Typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Lint and commit**

```bash
bun run lint:fix
git add src/cli/commands/chat.ts
git commit -m "feat: wire CLI to FridayRuntime with protocol routing

Chat command now boots the full FridayRuntime. Supports /protocol
commands with distinct output prefix. Calls runtime.shutdown() on exit."
```

---

## Phase 9: Cleanup and Documentation

---

### Task 14: Clean up core types

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Remove old FridayTool and FridayAgent from core types**

These are now superseded by the richer versions in `src/modules/types.ts`.

Update `src/core/types.ts` to only contain config and conversation types:

```typescript
// src/core/types.ts

/** Supported LLM provider names */
export type ProviderName = "anthropic" | "grok";

/** Configuration for FridayCore */
export interface FridayConfig {
  /** Which LLM provider to use */
  provider: ProviderName;
  /** Model identifier (provider-specific) */
  model: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}

/** A single message in the conversation history */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}
```

**Step 2: Search for any remaining imports of old types**

Run: Search for `FridayTool` or `FridayAgent` imports from `core/types`. Fix any found.

**Step 3: Run all tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: All pass

**Step 4: Commit**

```bash
bun run lint:fix
git add src/core/types.ts
git commit -m "refactor: remove old FridayTool/FridayAgent from core types

The rich tool/agent interfaces now live in src/modules/types.ts.
Core types focused on configuration and conversation primitives."
```

---

### Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture section**

Update the architecture diagram to reflect the new Agent Runtime structure with Cortex, Modules, Protocols, Directives, Signals, Clearance, Memory, Audit, and Notifications. Update the key design patterns section.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Agent Runtime architecture"
```

---

## Phase 10: Full Verification

---

### Task 16: Full test suite, typecheck, and lint verification

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS (should be ~60 tests across 9 test files)

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: Clean

**Step 4: Smoke test CLI**

Run: `bun run start chat --provider anthropic`
Expected: Friday boots with provider info, accepts input, responds

**Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: verification pass — all tests, types, and lint clean"
```

---

## Summary

| Phase | Tasks | What It Builds |
|---|---|---|
| 1 | Tasks 1-3 | Signal Bus, Clearance, Audit Logger |
| 2 | Tasks 4-5 | Memory (KV + Semantic Search) |
| 3 | Tasks 6-7 | Module Loader + Protocol Registry |
| 4 | Task 8 | Notification System |
| 5 | Tasks 9-10 | Directive Types, Store, Engine |
| 6 | Task 11 | Cortex (FridayCore evolution) |
| 7 | Task 12 | Runtime Bootstrap |
| 8 | Task 13 | CLI Integration |
| 9 | Tasks 14-15 | Type Cleanup + CLAUDE.md |
| 10 | Task 16 | Full Verification |

**Total: 16 tasks, ~60 tests, 15+ new files**

Each task is independently committable and testable. Dependencies flow bottom-up: infrastructure -> capabilities -> orchestration -> CLI.
