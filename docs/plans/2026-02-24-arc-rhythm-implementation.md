# Arc Rhythm Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Arc Rhythm, Friday's autonomous scheduled task execution subsystem — a background daemon with SQLite persistence, built-in cron parser, and full Cortex integration for headless LLM reasoning tasks.

**Architecture:** Core subsystem in `src/arc-rhythm/` (not a module). RhythmStore persists to SQLite, RhythmScheduler ticks every 60s, RhythmExecutor dispatches prompt/tool/protocol actions through Cortex. Boots after Cortex in FridayRuntime, exposes `/arc` protocol and `manage_rhythm` Cortex tool.

**Tech Stack:** TypeScript, bun:sqlite, bun:test, existing FridayRuntime subsystems (SignalBus, ClearanceManager, NotificationManager, Cortex, ProtocolRegistry, AuditLogger)

**Design Doc:** `docs/plans/2026-02-24-arc-rhythm-scheduling-design.md`

---

### Task 1: Types

**Files:**
- Create: `src/arc-rhythm/types.ts`
- Test: `tests/unit/arc-rhythm-types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/arc-rhythm-types.test.ts
import { describe, test, expect } from "bun:test";
import type {
  Rhythm,
  RhythmAction,
  RhythmExecution,
} from "../../src/arc-rhythm/types.ts";

describe("Arc Rhythm types", () => {
  test("Rhythm interface accepts prompt action", () => {
    const rhythm: Rhythm = {
      id: "r1",
      name: "Morning Check",
      description: "Check git repos",
      cron: "0 9 * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "Check stale PRs" },
      nextRun: new Date(),
      runCount: 0,
      consecutiveFailures: 0,
      clearance: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(rhythm.id).toBe("r1");
    expect(rhythm.action.type).toBe("prompt");
  });

  test("Rhythm interface accepts tool action", () => {
    const action: RhythmAction = {
      type: "tool",
      tool: "getEnvironmentStatus",
      args: { section: "cpu" },
    };
    expect(action.type).toBe("tool");
  });

  test("Rhythm interface accepts protocol action", () => {
    const action: RhythmAction = {
      type: "protocol",
      protocol: "git",
      args: { rawArgs: "status" },
    };
    expect(action.type).toBe("protocol");
  });

  test("RhythmExecution tracks running state", () => {
    const exec: RhythmExecution = {
      id: "e1",
      rhythmId: "r1",
      startedAt: new Date(),
      status: "running",
    };
    expect(exec.status).toBe("running");
    expect(exec.completedAt).toBeUndefined();
  });

  test("RhythmExecution tracks failure with error", () => {
    const exec: RhythmExecution = {
      id: "e2",
      rhythmId: "r1",
      startedAt: new Date(),
      completedAt: new Date(),
      status: "failure",
      error: "Timeout exceeded",
    };
    expect(exec.status).toBe("failure");
    expect(exec.error).toBe("Timeout exceeded");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-types.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/types.ts`

**Step 3: Write the types**

```typescript
// src/arc-rhythm/types.ts
import type { ClearanceName } from "../core/clearance.ts";

export interface Rhythm {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  origin: "user" | "friday";
  action: RhythmAction;
  lastRun?: Date;
  lastResult?: "success" | "failure";
  nextRun: Date;
  runCount: number;
  consecutiveFailures: number;
  clearance: ClearanceName[];
  createdAt: Date;
  updatedAt: Date;
}

export type RhythmAction =
  | { type: "prompt"; prompt: string }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  | { type: "protocol"; protocol: string; args?: Record<string, unknown> };

export interface RhythmExecution {
  id: string;
  rhythmId: string;
  startedAt: Date;
  completedAt?: Date;
  status: "running" | "success" | "failure";
  result?: string;
  error?: string;
}

export const MAX_CONSECUTIVE_FAILURES = 5;

export const ACTION_TIMEOUTS = {
  prompt: 5 * 60 * 1000,
  tool: 30 * 1000,
  protocol: 30 * 1000,
} as const;

export const DEFAULT_TICK_INTERVAL = 60_000;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-types.test.ts`
Expected: PASS (5 tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/types.ts tests/unit/arc-rhythm-types.test.ts
git commit -m "feat(arc-rhythm): add core type definitions"
```

---

### Task 2: Cron Parser

**Files:**
- Create: `src/arc-rhythm/cron.ts`
- Test: `tests/unit/arc-rhythm-cron.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-cron.test.ts
import { describe, test, expect } from "bun:test";
import {
  nextOccurrence,
  validate,
  describe as describeCron,
} from "../../src/arc-rhythm/cron.ts";

describe("cron parser", () => {
  describe("validate()", () => {
    test("accepts standard 5-field expressions", () => {
      expect(validate("0 9 * * *").valid).toBe(true);
      expect(validate("*/15 * * * *").valid).toBe(true);
      expect(validate("0 0 1 1 *").valid).toBe(true);
    });

    test("accepts ranges", () => {
      expect(validate("0 9-17 * * MON-FRI").valid).toBe(true);
    });

    test("accepts lists", () => {
      expect(validate("0,30 * * * *").valid).toBe(true);
    });

    test("accepts steps", () => {
      expect(validate("*/5 * * * *").valid).toBe(true);
      expect(validate("1-30/5 * * * *").valid).toBe(true);
    });

    test("accepts named days", () => {
      expect(validate("0 9 * * MON").valid).toBe(true);
      expect(validate("0 9 * * MON,WED,FRI").valid).toBe(true);
    });

    test("accepts named months", () => {
      expect(validate("0 0 1 JAN *").valid).toBe(true);
      expect(validate("0 0 1 JAN-MAR *").valid).toBe(true);
    });

    test("accepts shorthands", () => {
      expect(validate("@hourly").valid).toBe(true);
      expect(validate("@daily").valid).toBe(true);
      expect(validate("@weekly").valid).toBe(true);
      expect(validate("@monthly").valid).toBe(true);
    });

    test("rejects invalid expressions", () => {
      expect(validate("").valid).toBe(false);
      expect(validate("* *").valid).toBe(false);
      expect(validate("60 * * * *").valid).toBe(false);
      expect(validate("* 25 * * *").valid).toBe(false);
      expect(validate("* * 32 * *").valid).toBe(false);
      expect(validate("* * * 13 *").valid).toBe(false);
      expect(validate("* * * * 8").valid).toBe(false);
      expect(validate("@bogus").valid).toBe(false);
    });

    test("returns error message on invalid", () => {
      const result = validate("60 * * * *");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("nextOccurrence()", () => {
    test("daily at 9am from before 9am", () => {
      const after = new Date("2026-02-24T08:00:00Z");
      const next = nextOccurrence("0 9 * * *", after);
      expect(next.getUTCHours()).toBe(9);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next.getUTCDate()).toBe(24);
    });

    test("daily at 9am from after 9am advances to next day", () => {
      const after = new Date("2026-02-24T10:00:00Z");
      const next = nextOccurrence("0 9 * * *", after);
      expect(next.getUTCHours()).toBe(9);
      expect(next.getUTCDate()).toBe(25);
    });

    test("every 15 minutes", () => {
      const after = new Date("2026-02-24T10:03:00Z");
      const next = nextOccurrence("*/15 * * * *", after);
      expect(next.getUTCMinutes()).toBe(15);
      expect(next.getUTCHours()).toBe(10);
    });

    test("specific day of week (MON)", () => {
      const after = new Date("2026-02-24T00:00:00Z");
      const next = nextOccurrence("0 9 * * MON", after);
      expect(next.getUTCDay()).toBe(1);
      expect(next.getUTCDate()).toBe(2); // March 2, 2026
    });

    test("monthly on the 1st", () => {
      const after = new Date("2026-02-24T00:00:00Z");
      const next = nextOccurrence("0 0 1 * *", after);
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCMonth()).toBe(2); // March
    });

    test("handles month boundary rollover", () => {
      const after = new Date("2026-01-31T23:59:00Z");
      const next = nextOccurrence("0 0 * * *", after);
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCMonth()).toBe(1); // February
    });

    test("@hourly shorthand", () => {
      const after = new Date("2026-02-24T10:30:00Z");
      const next = nextOccurrence("@hourly", after);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next.getUTCHours()).toBe(11);
    });

    test("@daily shorthand", () => {
      const after = new Date("2026-02-24T10:00:00Z");
      const next = nextOccurrence("@daily", after);
      expect(next.getUTCHours()).toBe(0);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next.getUTCDate()).toBe(25);
    });

    test("defaults to Date.now() when no after provided", () => {
      const next = nextOccurrence("0 0 * * *");
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    test("range 9-17 weekdays", () => {
      const after = new Date("2026-02-24T18:00:00Z"); // Tuesday 6pm
      const next = nextOccurrence("0 9-17 * * 1-5", after);
      expect(next.getUTCHours()).toBe(9);
      expect(next.getUTCDate()).toBe(25); // Wednesday
    });

    test("list of minutes 0,15,30,45", () => {
      const after = new Date("2026-02-24T10:16:00Z");
      const next = nextOccurrence("0,15,30,45 * * * *", after);
      expect(next.getUTCMinutes()).toBe(30);
      expect(next.getUTCHours()).toBe(10);
    });
  });

  describe("describe()", () => {
    test("describes daily cron", () => {
      const desc = describeCron("0 9 * * *");
      expect(desc).toContain("9");
      expect(desc.toLowerCase()).toContain("day");
    });

    test("describes @hourly", () => {
      const desc = describeCron("@hourly");
      expect(desc.toLowerCase()).toContain("hour");
    });

    test("describes @daily", () => {
      const desc = describeCron("@daily");
      expect(desc.toLowerCase()).toContain("day");
    });

    test("describes @weekly", () => {
      const desc = describeCron("@weekly");
      expect(desc.toLowerCase()).toContain("week");
    });

    test("describes @monthly", () => {
      const desc = describeCron("@monthly");
      expect(desc.toLowerCase()).toContain("month");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-cron.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/cron.ts`

**Step 3: Implement the cron parser**

Create `src/arc-rhythm/cron.ts`. The implementation needs:

1. **`validate(expr: string): { valid: boolean; error?: string }`** — Parse and validate 5-field cron or shorthands. Check ranges: minute 0-59, hour 0-23, day 1-31, month 1-12, dow 0-7.

2. **`nextOccurrence(expr: string, after?: Date): Date`** — Expand shorthands, parse each field into a set of valid values, then iterate forward from `after` (minute-by-minute conceptually, but optimized by jumping to the next valid value in each field). Start from `after + 1 minute` (floor to minute), check each field top-down (month -> day -> dow -> hour -> minute), advance the smallest non-matching field. Safety limit: 4 years to prevent infinite loops.

3. **`describe(expr: string): string`** — Human-readable description. Map shorthands directly. For custom expressions, compose from parsed fields.

Key implementation details:
- Named days: `SUN=0, MON=1, ..., SAT=6` (also accept `7` as Sunday)
- Named months: `JAN=1, ..., DEC=12`
- Shorthands: `@hourly` -> `0 * * * *`, `@daily` -> `0 0 * * *`, `@weekly` -> `0 0 * * 0`, `@monthly` -> `0 0 1 * *`

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-cron.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/cron.ts tests/unit/arc-rhythm-cron.test.ts
git commit -m "feat(arc-rhythm): implement built-in cron parser"
```

---

### Task 3: RhythmStore

**Files:**
- Create: `src/arc-rhythm/store.ts`
- Test: `tests/unit/arc-rhythm-store.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-store.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-rhythm.db";

let db: Database;
let store: RhythmStore;

beforeEach(() => {
  db = new Database(TEST_DB, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  store = new RhythmStore(db);
});

afterEach(async () => {
  db.close();
  await Promise.allSettled([
    unlink(TEST_DB),
    unlink(`${TEST_DB}-wal`),
    unlink(`${TEST_DB}-shm`),
  ]);
});

describe("RhythmStore CRUD", () => {
  test("create() returns a rhythm with generated id", () => {
    const rhythm = store.create({
      name: "Morning Check",
      description: "Check stale PRs",
      cron: "0 9 * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "Check my repos for stale PRs" },
      nextRun: new Date("2026-02-25T09:00:00Z"),
      clearance: [],
    });
    expect(rhythm.id).toBeDefined();
    expect(rhythm.name).toBe("Morning Check");
    expect(rhythm.runCount).toBe(0);
    expect(rhythm.consecutiveFailures).toBe(0);
  });

  test("get() retrieves a created rhythm", () => {
    const created = store.create({
      name: "Test",
      description: "",
      cron: "0 0 * * *",
      enabled: true,
      origin: "friday",
      action: { type: "tool", tool: "getEnvironmentStatus" },
      nextRun: new Date("2026-02-25T00:00:00Z"),
      clearance: ["system"],
    });
    const fetched = store.get(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Test");
    expect(fetched!.clearance).toEqual(["system"]);
  });

  test("get() returns undefined for missing id", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  test("list() returns all rhythms", () => {
    store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: false, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
    expect(store.list().length).toBe(2);
  });

  test("list() filters by enabled", () => {
    store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: false, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
    expect(store.list({ enabled: true }).length).toBe(1);
    expect(store.list({ enabled: false }).length).toBe(1);
  });

  test("list() filters by origin", () => {
    store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
    expect(store.list({ origin: "user" }).length).toBe(1);
    expect(store.list({ origin: "friday" }).length).toBe(1);
  });

  test("update() modifies rhythm fields", () => {
    const created = store.create({ name: "Old", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const updated = store.update(created.id, { name: "New", enabled: false });
    expect(updated.name).toBe("New");
    expect(updated.enabled).toBe(false);
  });

  test("update() throws on missing id", () => {
    expect(() => store.update("nonexistent", { name: "X" })).toThrow();
  });

  test("remove() deletes a rhythm", () => {
    const created = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.remove(created.id);
    expect(store.get(created.id)).toBeUndefined();
  });
});

describe("RhythmStore execution tracking", () => {
  test("logExecution() creates an execution record", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const exec = store.logExecution({
      rhythmId: rhythm.id,
      startedAt: new Date(),
      status: "running",
    });
    expect(exec.id).toBeDefined();
    expect(exec.status).toBe("running");
  });

  test("completeExecution() updates status and timestamps", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const exec = store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "running" });
    store.completeExecution(exec.id, "success", "All clear");
    const history = store.getHistory(rhythm.id);
    expect(history[0].status).toBe("success");
    expect(history[0].result).toBe("All clear");
    expect(history[0].completedAt).toBeDefined();
  });

  test("getHistory() returns executions in reverse chronological order", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.logExecution({ rhythmId: rhythm.id, startedAt: new Date("2026-02-24T10:00:00Z"), status: "success" });
    store.logExecution({ rhythmId: rhythm.id, startedAt: new Date("2026-02-24T11:00:00Z"), status: "failure" });
    const history = store.getHistory(rhythm.id);
    expect(history.length).toBe(2);
    expect(history[0].startedAt.getTime()).toBeGreaterThan(history[1].startedAt.getTime());
  });

  test("getHistory() respects limit", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    for (let i = 0; i < 5; i++) {
      store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(Date.now() + i * 1000), status: "success" });
    }
    expect(store.getHistory(rhythm.id, 3).length).toBe(3);
  });

  test("getHistory() without rhythmId returns all executions", () => {
    const r1 = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const r2 = store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
    store.logExecution({ rhythmId: r1.id, startedAt: new Date(), status: "success" });
    store.logExecution({ rhythmId: r2.id, startedAt: new Date(), status: "success" });
    expect(store.getHistory(undefined, 10).length).toBe(2);
  });
});

describe("RhythmStore scheduling state", () => {
  test("markExecuted() updates lastRun, lastResult, nextRun, and increments runCount", () => {
    const nextRun = new Date("2026-02-25T09:00:00Z");
    const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date("2026-02-24T09:00:00Z"), clearance: [] });
    store.markExecuted(rhythm.id, "success", nextRun);
    const updated = store.get(rhythm.id)!;
    expect(updated.lastResult).toBe("success");
    expect(updated.lastRun).toBeDefined();
    expect(updated.nextRun.toISOString()).toBe(nextRun.toISOString());
    expect(updated.runCount).toBe(1);
    expect(updated.consecutiveFailures).toBe(0);
  });

  test("markExecuted() with failure increments consecutiveFailures", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.markExecuted(rhythm.id, "failure", new Date());
    store.markExecuted(rhythm.id, "failure", new Date());
    const updated = store.get(rhythm.id)!;
    expect(updated.consecutiveFailures).toBe(2);
  });

  test("markExecuted() with success resets consecutiveFailures", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.markExecuted(rhythm.id, "failure", new Date());
    store.markExecuted(rhythm.id, "failure", new Date());
    store.markExecuted(rhythm.id, "success", new Date());
    expect(store.get(rhythm.id)!.consecutiveFailures).toBe(0);
  });

  test("getDueRhythms() returns enabled rhythms past nextRun", () => {
    const past = new Date("2026-02-23T00:00:00Z");
    const future = new Date("2026-02-26T00:00:00Z");
    store.create({ name: "Due", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: past, clearance: [] });
    store.create({ name: "NotDue", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "b" }, nextRun: future, clearance: [] });
    store.create({ name: "Disabled", description: "", cron: "0 0 * * *", enabled: false, origin: "user", action: { type: "prompt", prompt: "c" }, nextRun: past, clearance: [] });
    const now = new Date("2026-02-24T12:00:00Z");
    const due = store.getDueRhythms(now);
    expect(due.length).toBe(1);
    expect(due[0].name).toBe("Due");
  });

  test("remove() cascades to rhythm_executions", () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "success" });
    store.remove(rhythm.id);
    expect(store.getHistory(rhythm.id).length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-store.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/store.ts`

**Step 3: Implement RhythmStore**

Create `src/arc-rhythm/store.ts`:
- Constructor takes `Database` (bun:sqlite), runs migration (CREATE TABLE rhythms, rhythm_executions, indexes)
- `create()` — generate id with `crypto.randomUUID()`, INSERT, return hydrated Rhythm
- `get()` — SELECT by id, deserialize JSON columns (action_data, clearance), map to Rhythm
- `list()` — SELECT with optional WHERE clauses for enabled/origin
- `update()` — SELECT + UPDATE (only provided fields), update `updated_at`
- `remove()` — DELETE (cascade handles executions via FK)
- `logExecution()` — INSERT into rhythm_executions, return RhythmExecution
- `completeExecution()` — UPDATE status, completed_at, result, error
- `getHistory()` — SELECT from rhythm_executions ORDER BY started_at DESC, optional WHERE rhythm_id, LIMIT
- `markExecuted()` — UPDATE rhythms SET last_run, last_result, next_run, run_count+1, consecutive_failures (reset on success, increment on failure)
- `getDueRhythms()` — SELECT WHERE enabled=1 AND next_run <= ? (ISO string)

Pattern: Follow `SQLiteMemory` style — `.query<RowType, ParamTypes>()` with explicit types. Use `db.transaction(() => { ... })()` where atomicity is needed. Serialize/deserialize JSON for action_data and clearance columns.

Schema (from design doc):
```sql
CREATE TABLE IF NOT EXISTS rhythms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL CHECK(origin IN ('user', 'friday')),
  action_type TEXT NOT NULL CHECK(action_type IN ('prompt', 'tool', 'protocol')),
  action_data TEXT NOT NULL,
  last_run TEXT,
  last_result TEXT CHECK(last_result IN ('success', 'failure')),
  next_run TEXT NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  clearance TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rhythm_executions (
  id TEXT PRIMARY KEY,
  rhythm_id TEXT NOT NULL REFERENCES rhythms(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failure')),
  result TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_rhythm_executions_rhythm_id ON rhythm_executions(rhythm_id);
CREATE INDEX IF NOT EXISTS idx_rhythm_executions_started_at ON rhythm_executions(started_at);
CREATE INDEX IF NOT EXISTS idx_rhythms_next_run ON rhythms(next_run);
CREATE INDEX IF NOT EXISTS idx_rhythms_enabled ON rhythms(enabled);
```

Important: Enable foreign keys with `PRAGMA foreign_keys=ON;` for cascade deletes to work.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-store.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/store.ts tests/unit/arc-rhythm-store.test.ts
git commit -m "feat(arc-rhythm): implement RhythmStore with SQLite persistence"
```

---

### Task 4: RhythmExecutor

**Files:**
- Create: `src/arc-rhythm/executor.ts`
- Test: `tests/unit/arc-rhythm-executor.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-executor.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { stubProvider } from "../helpers/stubs.ts";
import type { Rhythm } from "../../src/arc-rhythm/types.ts";

let executor: RhythmExecutor;
let cortex: Cortex;
let protocols: ProtocolRegistry;
let clearance: ClearanceManager;
let audit: AuditLogger;

function makeRhythm(overrides: Partial<Rhythm> = {}): Rhythm {
  return {
    id: "r1",
    name: "Test Rhythm",
    description: "test",
    cron: "0 0 * * *",
    enabled: true,
    origin: "user",
    action: { type: "prompt", prompt: "Hello" },
    nextRun: new Date(),
    runCount: 0,
    consecutiveFailures: 0,
    clearance: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  clearance = new ClearanceManager(["system", "read-fs", "network", "provider"]);
  audit = new AuditLogger();
  cortex = new Cortex({ injectedProvider: stubProvider });
  protocols = new ProtocolRegistry();
  executor = new RhythmExecutor({ cortex, protocols, clearance, audit });
});

describe("RhythmExecutor", () => {
  test("executes prompt action via Cortex", async () => {
    const rhythm = makeRhythm({
      action: { type: "prompt", prompt: "Check status" },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("success");
    expect(result.result).toBeDefined();
  });

  test("executes tool action", async () => {
    cortex.registerTool({
      name: "test_tool",
      description: "test",
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, output: "tool ran" }),
    });
    const rhythm = makeRhythm({
      action: { type: "tool", tool: "test_tool", args: {} },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("success");
    expect(result.result).toContain("tool ran");
  });

  test("executes protocol action", async () => {
    protocols.register({
      name: "test-proto",
      description: "test",
      aliases: [],
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, summary: "proto ran" }),
    });
    const rhythm = makeRhythm({
      action: { type: "protocol", protocol: "test-proto", args: { rawArgs: "" } },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("success");
    expect(result.result).toContain("proto ran");
  });

  test("returns failure when clearance is denied", async () => {
    const restrictedClearance = new ClearanceManager([]);
    const restrictedExecutor = new RhythmExecutor({
      cortex, protocols, clearance: restrictedClearance, audit,
    });
    const rhythm = makeRhythm({ clearance: ["system"] });
    const result = await restrictedExecutor.execute(rhythm);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("Clearance denied");
  });

  test("returns failure when tool is not found", async () => {
    const rhythm = makeRhythm({
      action: { type: "tool", tool: "nonexistent_tool" },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("nonexistent_tool");
  });

  test("returns failure when protocol is not found", async () => {
    const rhythm = makeRhythm({
      action: { type: "protocol", protocol: "nonexistent" },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("nonexistent");
  });

  test("catches and wraps execution errors", async () => {
    cortex.registerTool({
      name: "failing_tool",
      description: "test",
      parameters: [],
      clearance: [],
      execute: async () => { throw new Error("boom"); },
    });
    const rhythm = makeRhythm({
      action: { type: "tool", tool: "failing_tool" },
    });
    const result = await executor.execute(rhythm);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("boom");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-executor.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/executor.ts`

**Step 3: Implement RhythmExecutor**

Create `src/arc-rhythm/executor.ts`:

- Constructor takes `{ cortex: Cortex, protocols: ProtocolRegistry, clearance: ClearanceManager, audit: AuditLogger }`
- `execute(rhythm: Rhythm)` method:
  1. Check clearance: `clearance.checkAll(rhythm.clearance)` — if denied, return failure
  2. Dispatch based on `rhythm.action.type`:
     - **prompt**: Call `cortex.chat(rhythm.action.prompt)` — wrap in try/catch, return text response as `result`
     - **tool**: Look up tool from `cortex.availableTools`, build a `ToolContext` stub, call `tool.execute(args, context)`. Return `output` as `result`
     - **protocol**: Look up protocol from `protocols.get(name)`, build `ProtocolContext` stub, call `protocol.execute(args, context)`. Return `summary` as `result`
  3. Wrap everything in try/catch — on error, return `{ status: "failure", error: err.message }`
  4. Audit log all executions

Reference: Follow `DirectiveEngine.executeDirective()` for clearance check pattern. Follow `recall-tool.ts` for ToolContext stub pattern.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-executor.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/executor.ts tests/unit/arc-rhythm-executor.test.ts
git commit -m "feat(arc-rhythm): implement RhythmExecutor with prompt/tool/protocol dispatch"
```

---

### Task 5: RhythmScheduler

**Files:**
- Create: `src/arc-rhythm/scheduler.ts`
- Test: `tests/unit/arc-rhythm-scheduler.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-scheduler.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RhythmScheduler } from "../../src/arc-rhythm/scheduler.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { stubProvider } from "../helpers/stubs.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-scheduler.db";

let db: Database;
let store: RhythmStore;
let executor: RhythmExecutor;
let scheduler: RhythmScheduler;
let signals: SignalBus;
let notifications: NotificationManager;
let audit: AuditLogger;

beforeEach(() => {
  db = new Database(TEST_DB, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  store = new RhythmStore(db);

  signals = new SignalBus();
  notifications = new NotificationManager();
  audit = new AuditLogger();

  const clearance = new ClearanceManager(["system", "read-fs", "network", "provider"]);
  const cortex = new Cortex({ injectedProvider: stubProvider });
  const protocols = new ProtocolRegistry();
  executor = new RhythmExecutor({ cortex, protocols, clearance, audit });

  scheduler = new RhythmScheduler({
    store,
    executor,
    signals,
    notifications,
    audit,
    tickInterval: 100,
  });
});

afterEach(async () => {
  await scheduler.stop();
  db.close();
  await Promise.allSettled([
    unlink(TEST_DB),
    unlink(`${TEST_DB}-wal`),
    unlink(`${TEST_DB}-shm`),
  ]);
});

describe("RhythmScheduler", () => {
  test("start and stop manage running state", () => {
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  test("tick executes due rhythms", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    store.create({
      name: "Due",
      description: "",
      cron: "* * * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "hello" },
      nextRun: pastDate,
      clearance: [],
    });

    await scheduler.tick();

    const rhythms = store.list();
    expect(rhythms[0].runCount).toBe(1);
    expect(rhythms[0].lastResult).toBe("success");
  });

  test("tick skips non-due rhythms", async () => {
    const futureDate = new Date(Date.now() + 3_600_000);
    store.create({
      name: "NotDue",
      description: "",
      cron: "0 0 * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "hello" },
      nextRun: futureDate,
      clearance: [],
    });

    await scheduler.tick();

    const rhythms = store.list();
    expect(rhythms[0].runCount).toBe(0);
  });

  test("tick skips disabled rhythms", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    store.create({
      name: "Disabled",
      description: "",
      cron: "* * * * *",
      enabled: false,
      origin: "user",
      action: { type: "prompt", prompt: "hello" },
      nextRun: pastDate,
      clearance: [],
    });

    await scheduler.tick();

    const rhythms = store.list();
    expect(rhythms[0].runCount).toBe(0);
  });

  test("tick emits success signal", async () => {
    const emitted: string[] = [];
    signals.on("custom:arc-rhythm-executed", (sig) => {
      emitted.push(sig.name);
    });

    const pastDate = new Date(Date.now() - 60_000);
    store.create({
      name: "A",
      description: "",
      cron: "* * * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "hello" },
      nextRun: pastDate,
      clearance: [],
    });

    await scheduler.tick();
    expect(emitted).toContain("custom:arc-rhythm-executed");
  });

  test("tick emits failure signal on error", async () => {
    const emitted: string[] = [];
    signals.on("custom:arc-rhythm-failed", (sig) => {
      emitted.push(sig.name);
    });

    const pastDate = new Date(Date.now() - 60_000);
    store.create({
      name: "Fail",
      description: "",
      cron: "* * * * *",
      enabled: true,
      origin: "user",
      action: { type: "tool", tool: "nonexistent" },
      nextRun: pastDate,
      clearance: [],
    });

    await scheduler.tick();
    expect(emitted).toContain("custom:arc-rhythm-failed");
  });

  test("auto-pauses after MAX_CONSECUTIVE_FAILURES", async () => {
    const emitted: string[] = [];
    signals.on("custom:arc-rhythm-paused", (sig) => {
      emitted.push(sig.name);
    });

    const rhythm = store.create({
      name: "Fragile",
      description: "",
      cron: "* * * * *",
      enabled: true,
      origin: "user",
      action: { type: "tool", tool: "nonexistent" },
      nextRun: new Date(Date.now() - 60_000),
      clearance: [],
    });

    for (let i = 0; i < 5; i++) {
      // Re-enable and set nextRun to past for each tick
      db.query("UPDATE rhythms SET enabled = 1, next_run = ? WHERE id = ?").run(
        new Date(Date.now() - 60_000).toISOString(),
        rhythm.id,
      );
      await scheduler.tick();
    }

    const updated = store.get(rhythm.id)!;
    expect(updated.enabled).toBe(false);
    expect(emitted).toContain("custom:arc-rhythm-paused");
  });

  test("reentrant guard skips rhythm that is already running", async () => {
    const clearance = new ClearanceManager(["system", "provider"]);
    const slowCortex = new Cortex({
      injectedProvider: {
        ...stubProvider,
        chat: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { type: "text" as const, text: "done" };
        },
      },
    });
    const slowExecutor = new RhythmExecutor({
      cortex: slowCortex,
      protocols: new ProtocolRegistry(),
      clearance,
      audit,
    });
    const slowScheduler = new RhythmScheduler({
      store, executor: slowExecutor, signals, notifications, audit, tickInterval: 100,
    });

    const pastDate = new Date(Date.now() - 60_000);
    store.create({
      name: "Slow",
      description: "",
      cron: "* * * * *",
      enabled: true,
      origin: "user",
      action: { type: "prompt", prompt: "slow" },
      nextRun: pastDate,
      clearance: [],
    });

    const tickPromise = slowScheduler.tick();
    await slowScheduler.tick();
    await tickPromise;

    const rhythms = store.list();
    expect(rhythms[0].runCount).toBe(1);

    await slowScheduler.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-scheduler.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/scheduler.ts`

**Step 3: Implement RhythmScheduler**

Create `src/arc-rhythm/scheduler.ts`:

- Constructor takes `{ store, executor, signals, notifications, audit, tickInterval? }`
- Private state: `_timer`, `_running`, `_inflight: Set<string>` (rhythm IDs currently executing)
- `start()` — Set `_running = true`, fire missed rhythms, start `setInterval(tick, tickInterval)`
- `stop()` — Clear interval, set `_running = false`, await all in-flight (10s timeout)
- `tick()` — Public for testability. Get due rhythms from store, for each:
  1. Skip if in `_inflight` set (reentrant guard)
  2. Add to `_inflight`
  3. Log execution start, execute via executor
  4. On completion: `store.markExecuted()`, `store.completeExecution()`, compute `nextOccurrence()`, emit signal, send notification, check auto-pause
  5. Remove from `_inflight`
- Auto-pause: After failure, check `consecutiveFailures >= MAX_CONSECUTIVE_FAILURES`, disable and notify

Pattern: Follow Sensorium's start/stop/isRunning pattern. Use `nextOccurrence()` from `cron.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-scheduler.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/scheduler.ts tests/unit/arc-rhythm-scheduler.test.ts
git commit -m "feat(arc-rhythm): implement RhythmScheduler with polling loop and auto-pause"
```

---

### Task 6: RhythmProtocol

**Files:**
- Create: `src/arc-rhythm/protocol.ts`
- Test: `tests/unit/arc-rhythm-protocol.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-protocol.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createArcProtocol } from "../../src/arc-rhythm/protocol.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { RhythmScheduler } from "../../src/arc-rhythm/scheduler.ts";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { stubProvider } from "../helpers/stubs.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-protocol.db";

let db: Database;
let store: RhythmStore;
let scheduler: RhythmScheduler;

const stubContext: ProtocolContext = {
  workingDirectory: "/tmp",
  audit: { log: () => {} } as unknown as ProtocolContext["audit"],
  signal: { emit: async () => {} } as unknown as ProtocolContext["signal"],
  memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
  tools: new Map(),
};

beforeEach(() => {
  db = new Database(TEST_DB, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  store = new RhythmStore(db);

  const clearance = new ClearanceManager(["system", "provider"]);
  const cortex = new Cortex({ injectedProvider: stubProvider });
  const protocols = new ProtocolRegistry();
  const executor = new RhythmExecutor({ cortex, protocols, clearance, audit: new AuditLogger() });

  scheduler = new RhythmScheduler({
    store, executor,
    signals: new SignalBus(),
    notifications: new NotificationManager(),
    audit: new AuditLogger(),
  });
});

afterEach(async () => {
  await scheduler.stop();
  db.close();
  await Promise.allSettled([
    unlink(TEST_DB),
    unlink(`${TEST_DB}-wal`),
    unlink(`${TEST_DB}-shm`),
  ]);
});

describe("/arc protocol", () => {
  test("has correct name and aliases", () => {
    const proto = createArcProtocol(store, scheduler);
    expect(proto.name).toBe("arc");
    expect(proto.aliases).toContain("rhythm");
  });

  test("list shows 'No rhythms' when empty", async () => {
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: "list" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("No rhythms");
  });

  test("list shows created rhythms", async () => {
    store.create({ name: "Morning", description: "check", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "hi" }, nextRun: new Date(), clearance: [] });
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: "list" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Morning");
  });

  test("show returns rhythm details", async () => {
    const rhythm = store.create({ name: "Morning", description: "check PRs", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "hi" }, nextRun: new Date(), clearance: [] });
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: `show ${rhythm.id}` }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Morning");
    expect(result.summary).toContain("0 9 * * *");
  });

  test("show returns error for missing id", async () => {
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: "show nonexistent" }, stubContext);
    expect(result.success).toBe(false);
  });

  test("create makes a new rhythm", async () => {
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute(
      { rawArgs: 'create "0 9 * * *" Check stale PRs' },
      stubContext,
    );
    expect(result.success).toBe(true);
    expect(store.list().length).toBe(1);
    expect(store.list()[0].cron).toBe("0 9 * * *");
  });

  test("create rejects invalid cron", async () => {
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute(
      { rawArgs: 'create "invalid" Do something' },
      stubContext,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Invalid");
  });

  test("pause disables a rhythm", async () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const proto = createArcProtocol(store, scheduler);
    await proto.execute({ rawArgs: `pause ${rhythm.id}` }, stubContext);
    expect(store.get(rhythm.id)!.enabled).toBe(false);
  });

  test("resume enables a rhythm", async () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: false, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const proto = createArcProtocol(store, scheduler);
    await proto.execute({ rawArgs: `resume ${rhythm.id}` }, stubContext);
    expect(store.get(rhythm.id)!.enabled).toBe(true);
  });

  test("delete removes a rhythm", async () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const proto = createArcProtocol(store, scheduler);
    await proto.execute({ rawArgs: `delete ${rhythm.id}` }, stubContext);
    expect(store.get(rhythm.id)).toBeUndefined();
  });

  test("history shows execution log", async () => {
    const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "success" });
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: "history" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("success");
  });

  test("unknown subcommand returns error", async () => {
    const proto = createArcProtocol(store, scheduler);
    const result = await proto.execute({ rawArgs: "bogus" }, stubContext);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-protocol.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/protocol.ts`

**Step 3: Implement RhythmProtocol**

Create `src/arc-rhythm/protocol.ts`:

- `createArcProtocol(store: RhythmStore, scheduler: RhythmScheduler): FridayProtocol`
- Parse `rawArgs` to get subcommand + remaining args
- Switch on subcommand: list, show, create, pause, resume, delete, history, run
- `create` parsing: extract cron in quotes (`"0 9 * * *"`), remaining text is name/description. Default action type is `prompt` with the description as the prompt. Validate cron before creating.
- `run` subcommand: expose a `runOne(rhythmId)` on scheduler or call tick logic directly
- Format output with table-like columns for `list`, detail view for `show`

Pattern: Follow `createEnvProtocol()` — factory function returning `FridayProtocol`, switch on subcommand.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-protocol.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/protocol.ts tests/unit/arc-rhythm-protocol.test.ts
git commit -m "feat(arc-rhythm): implement /arc protocol with CRUD subcommands"
```

---

### Task 7: Cortex Tool (manage_rhythm)

**Files:**
- Create: `src/arc-rhythm/tool.ts`
- Test: `tests/unit/arc-rhythm-tool.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-tool.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createManageRhythmTool } from "../../src/arc-rhythm/tool.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-tool.db";

let db: Database;
let store: RhythmStore;

const stubContext: ToolContext = {
  workingDirectory: "/tmp",
  audit: { log: () => {} } as unknown as ToolContext["audit"],
  signal: { emit: async () => {} } as unknown as ToolContext["signal"],
  memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
};

beforeEach(() => {
  db = new Database(TEST_DB, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  store = new RhythmStore(db);
});

afterEach(async () => {
  db.close();
  await Promise.allSettled([
    unlink(TEST_DB),
    unlink(`${TEST_DB}-wal`),
    unlink(`${TEST_DB}-shm`),
  ]);
});

describe("manage_rhythm tool", () => {
  test("has correct name and clearance", () => {
    const tool = createManageRhythmTool(store);
    expect(tool.name).toBe("manage_rhythm");
    expect(tool.clearance).toEqual(["system"]);
  });

  test("create operation makes a new rhythm", async () => {
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({
      operation: "create",
      name: "Morning Check",
      cron: "0 9 * * *",
      action_type: "prompt",
      action_config: JSON.stringify({ prompt: "Check PRs" }),
    }, stubContext);
    expect(result.success).toBe(true);
    expect(store.list().length).toBe(1);
  });

  test("create validates cron expression", async () => {
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({
      operation: "create",
      name: "Bad",
      cron: "not-valid",
      action_type: "prompt",
      action_config: JSON.stringify({ prompt: "x" }),
    }, stubContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid");
  });

  test("list operation returns rhythms", async () => {
    store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({ operation: "list" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("A");
  });

  test("update operation modifies rhythm", async () => {
    const rhythm = store.create({ name: "Old", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({
      operation: "update",
      rhythm_id: rhythm.id,
      name: "New",
    }, stubContext);
    expect(result.success).toBe(true);
    expect(store.get(rhythm.id)!.name).toBe("New");
  });

  test("delete operation removes rhythm", async () => {
    const rhythm = store.create({ name: "Gone", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({
      operation: "delete",
      rhythm_id: rhythm.id,
    }, stubContext);
    expect(result.success).toBe(true);
    expect(store.get(rhythm.id)).toBeUndefined();
  });

  test("unknown operation returns error", async () => {
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({ operation: "bogus" }, stubContext);
    expect(result.success).toBe(false);
  });

  test("create missing required fields returns error", async () => {
    const tool = createManageRhythmTool(store);
    const result = await tool.execute({ operation: "create" }, stubContext);
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-tool.test.ts`
Expected: FAIL — cannot resolve `../../src/arc-rhythm/tool.ts`

**Step 3: Implement manage_rhythm tool**

Create `src/arc-rhythm/tool.ts`:

- `createManageRhythmTool(store: RhythmStore): FridayTool`
- Pattern: Follow `createRecallTool()` and `createEnvironmentTool()` style
- Operations: create, list, update, delete
- Create: validate cron, parse action_config JSON, compute nextOccurrence, call store.create() with `origin: "friday"` (this tool is used by Friday herself)
- List: store.list(), format as text output
- Update: store.update() with provided fields, recompute nextRun if cron changed
- Delete: store.remove()
- clearance: `["system"]`

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-tool.test.ts`
Expected: PASS (all tests)

**Step 5: Lint and commit**

```bash
bun run lint:fix
git add src/arc-rhythm/tool.ts tests/unit/arc-rhythm-tool.test.ts
git commit -m "feat(arc-rhythm): implement manage_rhythm Cortex tool"
```

---

### Task 8: FridayRuntime Integration

**Files:**
- Modify: `src/core/runtime.ts` (add Arc Rhythm boot/shutdown)
- Modify: `src/core/memory.ts` (expose database getter)
- Test: `tests/unit/arc-rhythm-runtime.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/arc-rhythm-runtime.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { stubProvider } from "../helpers/stubs.ts";
import { rm } from "node:fs/promises";

const TEST_DATA_DIR = "/tmp/friday-test-arc-runtime";

let runtime: FridayRuntime;

beforeEach(() => {
  runtime = new FridayRuntime();
});

afterEach(async () => {
  if (runtime.isBooted) await runtime.shutdown();
  await Promise.allSettled([
    rm(TEST_DATA_DIR, { recursive: true }),
  ]);
});

describe("FridayRuntime + Arc Rhythm", () => {
  test("boots with Arc Rhythm when dataDir is provided", async () => {
    await runtime.boot({
      injectedProvider: stubProvider,
      dataDir: TEST_DATA_DIR,
      enableSensorium: false,
    });
    expect(runtime.isBooted).toBe(true);
    expect(runtime.protocols.isProtocol("/arc")).toBe(true);
  });

  test("Arc Rhythm protocol responds to /arc list", async () => {
    await runtime.boot({
      injectedProvider: stubProvider,
      dataDir: TEST_DATA_DIR,
      enableSensorium: false,
    });
    const result = await runtime.process("/arc list");
    expect(result.source).toBe("protocol");
    expect(result.output).toContain("No rhythms");
  });

  test("manage_rhythm tool is registered on Cortex", async () => {
    await runtime.boot({
      injectedProvider: stubProvider,
      dataDir: TEST_DATA_DIR,
      enableSensorium: false,
    });
    const tools = runtime.cortex.availableTools;
    const rhythmTool = tools.find((t) => t.name === "manage_rhythm");
    expect(rhythmTool).toBeDefined();
  });

  test("shutdown stops Arc Rhythm gracefully", async () => {
    await runtime.boot({
      injectedProvider: stubProvider,
      dataDir: TEST_DATA_DIR,
      enableSensorium: false,
    });
    await runtime.shutdown();
    expect(runtime.isBooted).toBe(false);
  });

  test("boots without Arc Rhythm when dataDir is not provided", async () => {
    await runtime.boot({
      injectedProvider: stubProvider,
      enableSensorium: false,
    });
    expect(runtime.isBooted).toBe(true);
    expect(runtime.protocols.isProtocol("/arc")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/arc-rhythm-runtime.test.ts`
Expected: FAIL — `/arc` protocol not registered

**Step 3: Integrate Arc Rhythm into FridayRuntime**

Modify `src/core/memory.ts`:
- Add a `get database(): Database` getter that returns `this.db`

Modify `src/core/runtime.ts`:
1. Add imports for Arc Rhythm components
2. Add private fields: `_rhythmStore?`, `_rhythmScheduler?`
3. In `boot()`, after Recall Tool registration, before Modules:
   - Create RhythmStore with shared database (`this._memory.database`)
   - Create RhythmExecutor wired to Cortex, protocols, clearance, audit
   - Create RhythmScheduler wired to store, executor, signals, notifications, audit
   - Register `/arc` protocol
   - Register `manage_rhythm` tool on Cortex
   - Start scheduler
4. In `shutdown()`, before Sensorium stop:
   - Stop scheduler, await in-flight
   - Clear references
5. Update `ShutdownStep` to include `"arc-rhythm"`
6. Add Arc Rhythm cleanup to error rollback in `boot()`

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/arc-rhythm-runtime.test.ts`
Expected: PASS (all tests)

**Step 5: Run all existing tests to verify no regressions**

Run: `bun test`
Expected: All tests pass

**Step 6: Lint and commit**

```bash
bun run lint:fix
git add src/core/runtime.ts src/core/memory.ts tests/unit/arc-rhythm-runtime.test.ts
git commit -m "feat(arc-rhythm): integrate into FridayRuntime boot/shutdown"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture tree** — Add `arc-rhythm/` directory

**Step 2: Add Key Design Patterns entry** — Describe Arc Rhythm subsystem

**Step 3: Update boot order** — Include Arc Rhythm after Recall Tool

**Step 4: Update test count** — Reflect new tests

**Step 5: Add design doc reference** — `docs/plans/2026-02-24-arc-rhythm-scheduling-design.md`

**Step 6: Add MCU concept** — `Arc Rhythm=heartbeat/scheduler`

**Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Arc Rhythm subsystem"
```

---

### Task 10: Final Verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (previous ~646 + new ~80-100)

**Step 2: Type check**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Lint check**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit any remaining fixes**

If any issues found, fix and commit.
