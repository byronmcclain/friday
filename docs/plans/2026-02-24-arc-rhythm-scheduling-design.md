# Arc Rhythm — Scheduled Task System Design

**Date**: 2026-02-24
**Status**: Approved
**MCU Concept**: Arc Rhythm is Friday's heartbeat — autonomous scheduled task execution.

## Overview

Arc Rhythm gives Friday the ability to execute tasks on a schedule. Like a heartbeat that keeps her proactive even when you're not talking to her. Three sources of tasks:

1. **Friday-created** — she observes patterns and schedules work autonomously (full autonomy, no approval gate)
2. **User-created via protocol** — `/arc create "0 9 * * *" "check stale PRs"`
3. **User-created via conversation** — "every morning at 9am, check my repos for stale PRs"

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Execution model | Background daemon | Ticks while Friday is alive; missed tasks queue on next boot |
| Autonomy | Full | Friday creates/manages her own rhythms freely |
| Task power | Full Cortex + tools | Tasks are headless reasoning sessions |
| Reporting | Notification channels | Results flow through NotificationManager (terminal, Slack, webhook) |
| Interface | `/arc` protocol + natural language | Direct CRUD + conversational scheduling |
| Chaining | Independent only | No DAGs or dependencies; one task = one action |
| Architecture | Core subsystem | Lives in `src/arc-rhythm/`, not a module — needs direct Cortex access |
| Cron parsing | Built-in | 5-field standard cron, no external dependency |

## Data Model

### Rhythm

The fundamental unit — a scheduled task with identity, timing, and execution config.

```typescript
interface Rhythm {
  id: string;                          // nanoid
  name: string;                        // human-readable label
  description: string;                 // what this rhythm does
  cron: string;                        // cron expression ("0 9 * * *")
  enabled: boolean;                    // can be paused

  // Provenance
  origin: "user" | "friday";           // who created it

  // What to do when it fires
  action: RhythmAction;

  // Execution state
  lastRun?: Date;
  lastResult?: "success" | "failure";
  nextRun: Date;                       // pre-computed from cron
  runCount: number;
  consecutiveFailures: number;         // for auto-pause logic

  // Metadata
  clearance: ClearanceName[];          // permissions needed
  createdAt: Date;
  updatedAt: Date;
}

type RhythmAction =
  | { type: "prompt"; prompt: string }                                      // LLM reasoning — headless Cortex conversation
  | { type: "tool"; tool: string; args?: Record<string, unknown> }          // direct tool execution
  | { type: "protocol"; protocol: string; args?: Record<string, unknown> }; // slash command dispatch
```

### RhythmExecution

Execution history — one row per run, accumulates over time.

```typescript
interface RhythmExecution {
  id: string;                          // nanoid
  rhythmId: string;                    // FK to rhythm
  startedAt: Date;
  completedAt?: Date;
  status: "running" | "success" | "failure";
  result?: string;                     // summary of what happened
  error?: string;                      // if failed
}
```

### Action Types

- **`prompt`** — The star. Friday sends a prompt to Cortex and gets a full reasoning + tool-use loop, headless. This powers "check my stale PRs every morning" — she thinks, uses git tools, and produces a summary.
- **`tool`** — Direct tool execution via the registered tool's `execute()` method. Same dispatch path as Directives. Deterministic, fast.
- **`protocol`** — Direct protocol dispatch via ProtocolRegistry. Same as Directives. For things like `/git status` on a schedule.

### SQLite Schema

Two tables in the existing Friday SQLite database:

```sql
CREATE TABLE IF NOT EXISTS rhythms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL CHECK(origin IN ('user', 'friday')),
  action_type TEXT NOT NULL CHECK(action_type IN ('prompt', 'tool', 'protocol')),
  action_data TEXT NOT NULL,           -- JSON: { prompt } | { tool, args } | { protocol, args }
  last_run TEXT,                       -- ISO 8601
  last_result TEXT CHECK(last_result IN ('success', 'failure')),
  next_run TEXT NOT NULL,              -- ISO 8601, pre-computed
  run_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  clearance TEXT NOT NULL DEFAULT '[]', -- JSON array of ClearanceName
  created_at TEXT NOT NULL,            -- ISO 8601
  updated_at TEXT NOT NULL             -- ISO 8601
);

CREATE TABLE IF NOT EXISTS rhythm_executions (
  id TEXT PRIMARY KEY,
  rhythm_id TEXT NOT NULL REFERENCES rhythms(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,            -- ISO 8601
  completed_at TEXT,                   -- ISO 8601
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failure')),
  result TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_rhythm_executions_rhythm_id ON rhythm_executions(rhythm_id);
CREATE INDEX IF NOT EXISTS idx_rhythm_executions_started_at ON rhythm_executions(started_at);
CREATE INDEX IF NOT EXISTS idx_rhythms_next_run ON rhythms(next_run);
CREATE INDEX IF NOT EXISTS idx_rhythms_enabled ON rhythms(enabled);
```

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────┐
│                FridayRuntime                 │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌────────────┐  │
│  │ Cortex  │◄─┤ArcRhythm│──┤ SignalBus  │  │
│  │ (brain) │  │Scheduler │  │ (events)   │  │
│  └────▲────┘  └────┬────┘  └────────────┘  │
│       │            │                        │
│       │       ┌────▼────┐  ┌────────────┐  │
│       │       │ Rhythm  │  │Notification│  │
│       └───────┤Executor │──┤ Manager    │  │
│               └────┬────┘  └────────────┘  │
│                    │                        │
│               ┌────▼────┐                   │
│               │ Rhythm  │ (SQLite)          │
│               │ Store   │                   │
│               └─────────┘                   │
└─────────────────────────────────────────────┘
```

### File Structure

```
src/arc-rhythm/
├── types.ts          # Rhythm, RhythmExecution, RhythmAction interfaces
├── cron.ts           # Built-in cron parser (nextOccurrence, validate)
├── store.ts          # RhythmStore — SQLite CRUD + execution history
├── scheduler.ts      # RhythmScheduler — polling loop, tick logic
├── executor.ts       # RhythmExecutor — dispatches prompt/tool/protocol actions
├── protocol.ts       # /arc protocol — user-facing CRUD subcommands
└── tool.ts           # manage_rhythm tool — registered on Cortex for Friday's autonomous use
```

### RhythmStore (`store.ts`)

SQLite-backed persistence with columnar schema for queryability.

**Responsibilities:**
- CRUD for rhythms (create, get, list, update, remove)
- Execution history logging (logExecution, getHistory)
- Boot-time loading of enabled rhythms
- Missed run detection (rhythms where `nextRun < now`)

**API:**

```typescript
class RhythmStore {
  constructor(db: Database);

  // Rhythm CRUD
  create(rhythm: Omit<Rhythm, "id" | "createdAt" | "updatedAt" | "runCount" | "consecutiveFailures">): Rhythm;
  get(id: string): Rhythm | undefined;
  list(filter?: { enabled?: boolean; origin?: "user" | "friday" }): Rhythm[];
  update(id: string, patch: Partial<Pick<Rhythm, "name" | "description" | "cron" | "enabled" | "action" | "clearance">>): Rhythm;
  remove(id: string): void;

  // Execution tracking
  logExecution(execution: Omit<RhythmExecution, "id">): RhythmExecution;
  completeExecution(id: string, status: "success" | "failure", result?: string, error?: string): void;
  getHistory(rhythmId?: string, limit?: number): RhythmExecution[];

  // Scheduling state
  markExecuted(id: string, result: "success" | "failure", nextRun: Date): void;
  getDueRhythms(now: Date): Rhythm[];
  getMissedRhythms(now: Date): Rhythm[];
}
```

### RhythmScheduler (`scheduler.ts`)

The heartbeat — a 60-second polling loop.

**Tick cadence:** 60 seconds. Cron's minimum granularity is 1 minute, so polling faster wastes cycles.

**Tick logic:**
1. `getDueRhythms(now)` — all enabled rhythms where `nextRun <= now`
2. For each due rhythm, check reentrant guard (skip if already running)
3. Fire `executor.execute(rhythm)` — async, does not block the tick
4. On completion: update `lastRun`, `lastResult`, recompute `nextRun`, log execution
5. Emit signal: `custom:arc-rhythm-executed` or `custom:arc-rhythm-failed`
6. Send notification through NotificationManager

**Missed runs on boot:**
When Friday starts, `getMissedRhythms(now)` finds rhythms whose `nextRun` is in the past. Each gets one immediate makeup execution, then `nextRun` advances to the next future occurrence. No catch-up for every missed interval.

**API:**

```typescript
class RhythmScheduler {
  constructor(config: {
    store: RhythmStore;
    executor: RhythmExecutor;
    signals: SignalBus;
    notifications: NotificationManager;
    audit: AuditLogger;
    tickInterval?: number;   // default: 60_000ms
  });

  start(): void;              // begin polling + fire missed
  stop(): Promise<void>;      // stop polling, await in-flight executions (with timeout)
  isRunning(): boolean;
}
```

### RhythmExecutor (`executor.ts`)

Dispatches rhythm actions through the appropriate subsystem.

**Dispatch by action type:**
- **`prompt`** → Create a temporary Cortex conversation, send the prompt, collect the final response. This is a headless reasoning loop — Friday thinks, uses tools, produces a result. The Cortex instance is the same one used for interactive chat, but the conversation is ephemeral (not persisted to history).
- **`tool`** → Look up the tool by name from Cortex's registered tools, execute with args and a constructed ToolContext. Same path as DirectiveEngine.
- **`protocol`** → Dispatch through ProtocolRegistry with args and a constructed ProtocolContext. Same path as DirectiveEngine.

**All paths:**
- Check clearance before execution
- Wrap in try/catch with timeout
- Return a `RhythmExecution` result

**API:**

```typescript
class RhythmExecutor {
  constructor(config: {
    cortex: Cortex;
    protocols: ProtocolRegistry;
    clearance: ClearanceManager;
    audit: AuditLogger;
  });

  execute(rhythm: Rhythm): Promise<{ status: "success" | "failure"; result?: string; error?: string }>;
}
```

**Timeouts:**
- `prompt` actions: 5 minutes (LLM reasoning can be slow)
- `tool` actions: 30 seconds
- `protocol` actions: 30 seconds

### RhythmProtocol (`protocol.ts`)

User-facing `/arc` protocol (aliases: `/rhythm`).

| Subcommand | Args | Description |
|------------|------|-------------|
| `list` | `[--all]` | Show enabled rhythms (or all with `--all`), columns: name, cron, next run, last result, origin |
| `show <id>` | rhythm ID | Detail view + last 10 executions |
| `create <cron> <description>` | cron + natural text | Create a rhythm. Description is parsed to determine action type. |
| `pause <id>` | rhythm ID | Disable without deleting |
| `resume <id>` | rhythm ID | Re-enable a paused rhythm |
| `delete <id>` | rhythm ID | Remove a rhythm permanently |
| `history [id]` | optional rhythm ID | Execution log (all or per-rhythm), last 20 entries |
| `run <id>` | rhythm ID | Force-execute now, regardless of schedule |

### Cortex Tool (`tool.ts`)

`manage_rhythm` — registered on Cortex so Friday can autonomously create, modify, and delete rhythms during any conversation.

```typescript
const manageRhythmTool: FridayTool = {
  name: "manage_rhythm",
  description: "Create, update, or delete scheduled tasks (Arc Rhythm). Use this to schedule recurring work.",
  parameters: [
    { name: "operation", type: "string", required: true, description: "create | update | delete | list" },
    { name: "name", type: "string", required: false, description: "Human-readable name for the rhythm" },
    { name: "cron", type: "string", required: false, description: "Cron expression (e.g., '0 9 * * *' for daily at 9am)" },
    { name: "action_type", type: "string", required: false, description: "prompt | tool | protocol" },
    { name: "action_config", type: "string", required: false, description: "JSON: the action payload" },
    { name: "rhythm_id", type: "string", required: false, description: "ID for update/delete operations" },
  ],
  clearance: ["system"],
  execute: async (args, context) => { /* dispatch to RhythmStore */ },
};
```

## Boot Integration

Arc Rhythm boots in FridayRuntime **after Cortex** (needs it for prompt actions) and **before Modules**:

```
SignalBus → ClearanceManager → AuditLogger → NotificationManager →
ProtocolRegistry → DirectiveStore/Engine → Memory → SmartsStore →
Sensorium → Cortex → Recall Tool → **Arc Rhythm** → Modules → Forge
```

**Boot sequence:**
1. Create RhythmStore (uses existing SQLite database from Memory)
2. Create RhythmExecutor (wired to Cortex, ProtocolRegistry, ClearanceManager)
3. Create RhythmScheduler (wired to Store, Executor, SignalBus, NotificationManager)
4. Register `/arc` protocol on ProtocolRegistry
5. Register `manage_rhythm` tool on Cortex
6. Start scheduler (begins polling + fires missed rhythms)

**Shutdown sequence** (before Sensorium stop):
1. Stop scheduler (halts polling)
2. Await in-flight executions (10-second timeout, then force-kill)
3. RhythmStore is closed when Memory closes (shared SQLite database)

## Cron Parser

Built-in, no external dependencies. Supports standard 5-field cron:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12 or JAN-DEC)
│ │ │ │ ┌───────────── day of week (0-7 or SUN-SAT, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Supported syntax:**
- Wildcards: `*`
- Values: `0`, `15`, `MON`
- Ranges: `1-5`, `MON-FRI`
- Steps: `*/15`, `1-30/5`
- Lists: `1,3,5`, `MON,WED,FRI`
- Shorthands: `@hourly`, `@daily`, `@weekly`, `@monthly`

**API:**

```typescript
function nextOccurrence(cron: string, after?: Date): Date;
function validate(cron: string): { valid: boolean; error?: string };
function describe(cron: string): string;  // human-readable: "Every day at 9:00 AM"
```

## Error Handling & Resilience

### Execution Isolation
Each rhythm executes in its own try/catch. A failing rhythm never takes down the scheduler or other rhythms. Same isolation pattern as SignalBus handlers.

### Timeouts
- `prompt` actions: 5 minutes (configurable)
- `tool` actions: 30 seconds (configurable)
- `protocol` actions: 30 seconds (configurable)
- Exceeded timeout → killed, logged as `failure`, next run scheduled normally

### Reentrant Guard
If a rhythm is still running when its next tick comes due, it's skipped for that cycle. No queuing, no pile-up. The skip is logged as a warning.

### Missed Runs on Boot
Rhythms whose `nextRun` is in the past get one immediate makeup execution, then advance to next future occurrence. No catch-up for every missed interval.

### Consecutive Failure Auto-Pause
RhythmStore tracks `consecutiveFailures`. After 5 consecutive failures:
- Rhythm is auto-paused (`enabled = false`)
- Notification sent at `alert` level
- Friday can re-enable autonomously if she diagnoses the issue
- User can `/arc resume <id>` manually

### Signals Emitted
- `custom:arc-rhythm-executed` — on successful completion (data: `{ rhythmId, rhythmName, result }`)
- `custom:arc-rhythm-failed` — on failure (data: `{ rhythmId, rhythmName, error }`)
- `custom:arc-rhythm-paused` — on auto-pause from consecutive failures

## Directive Integration

The existing `DirectiveTrigger` type already declares `{ type: "schedule"; cron: string }` but it's unimplemented. With Arc Rhythm in place, DirectiveEngine can delegate schedule triggers:

- On boot, DirectiveEngine finds directives with `schedule` triggers
- For each, it creates a corresponding Rhythm with `action` matching the directive's action
- The Rhythm's `origin` is `"friday"` (system-managed)
- DirectiveEngine doesn't need its own cron loop — Arc Rhythm handles all scheduling

This is a future enhancement, not part of the initial build.

## Testing Strategy

### Unit Tests (~80-120 tests across 6-8 files)

**`cron.test.ts`** — Cron parser
- Next occurrence: basic patterns, edge cases (month boundaries, leap year Feb 29, DST transitions)
- Validation: valid expressions pass, malformed reject with error message
- Shorthands: `@daily` → `0 0 * * *`, etc.
- `describe()`: human-readable output
- Steps, ranges, lists, named days/months

**`store.test.ts`** — RhythmStore
- CRUD: create/get/list/update/remove
- Execution history: log, complete, query by rhythm, query all
- `getDueRhythms()`: returns only enabled rhythms past their nextRun
- `getMissedRhythms()`: same as getDue, used at boot
- `markExecuted()`: updates lastRun, lastResult, nextRun, runCount
- Consecutive failure tracking and auto-pause
- SQLite cleanup: unlink db/wal/shm in afterEach

**`scheduler.test.ts`** — RhythmScheduler
- Tick fires due rhythms
- Reentrant guard skips already-running rhythms
- Missed-on-boot fires once then advances
- Stop awaits in-flight with timeout
- Signal emission on success/failure
- Auto-pause after 5 consecutive failures

**`executor.test.ts`** — RhythmExecutor
- Prompt action: uses injectedProvider stub, collects response
- Tool action: dispatches to registered tool, returns result
- Protocol action: dispatches to ProtocolRegistry, returns result
- Clearance rejection: action blocked if clearance not granted
- Timeout: long-running action killed after threshold

**`protocol.test.ts`** — RhythmProtocol
- Each subcommand: list, show, create, pause, resume, delete, history, run
- Argument parsing and validation
- Output formatting

**`tool.test.ts`** — manage_rhythm Cortex tool
- Create/update/delete/list operations
- Validation of cron expressions before creation
- Error cases (missing args, invalid IDs)

### Test Patterns
- Use `injectedProvider` (stubProvider) for prompt-type executor tests
- SQLite cleanup: unlink `db`, `db-wal`, `db-shm` in afterEach
- Mock `Date.now()` / timers for scheduler tick tests
- Reuse `stubProvider` from `tests/helpers/stubs.ts`
