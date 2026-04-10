# Sensorium — Environment Awareness Design

## Overview

**Sensorium** is Friday's sensory network — a core subsystem that gives her continuous awareness of the machine, containers, and dev environment she's running on. Like JARVIS monitoring Stark Tower, Friday passively knows her environment, proactively alerts on anomalies, and can deep-dive on demand.

**MCU mapping:** Sensorium = Friday's sensor suite. Sees everything in the tower.

## Goals

- **Passive awareness** — Environment context injected into every system prompt so Friday naturally references system state
- **Proactive alerts** — Threshold-based monitoring emits signals, triggers notifications, and can fire directives
- **On-demand queries** — `/env` protocol for CLI access, `getEnvironmentStatus` tool for LLM-driven investigation
- **Full stack scope** — Machine stats, Docker containers, dev environment (Git, ports, runtimes)

## Architecture

### File Structure

```
src/sensorium/
├── types.ts          # SystemSnapshot, SensorConfig, AlertThreshold
├── sensors.ts        # Pure functions: gatherMachine(), gatherContainers(), gatherDev()
├── sensorium.ts      # Sensorium class — polling loop, snapshot management, alert evaluation
├── protocol.ts       # /env protocol (status, cpu, memory, docker, ports, git, watch)
└── tool.ts           # getEnvironmentStatus FridayTool
```

### Boot Order

Sensorium initializes after Cortex but before Modules:

```
...DirectiveStore/Engine → Memory → SMARTS → Cortex → Sensorium → Curator → Modules
```

### Data Flow

```
Polling Loop (30s fast / 5min slow)
    │
    ├─→ gatherMachine()      ─┐
    ├─→ gatherContainers()    ├─→ SystemSnapshot
    └─→ gatherDev()          ─┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            Context Block     Alert Evaluator   Snapshot Store
            (→ Cortex prompt) (→ SignalBus)     (currentSnapshot)
                                    │               │
                              ┌─────┴─────┐    ┌────┴────┐
                              ▼           ▼    ▼         ▼
                        Notifications  Directives  /env    Tool
                        (terminal)     (autonomous) (CLI)  (LLM)
```

## Data Model

### SystemSnapshot

```typescript
interface SystemSnapshot {
  timestamp: Date;

  // Machine layer (fast poll — 30s)
  machine: {
    platform: string;        // "darwin", "linux"
    arch: string;            // "arm64", "x64"
    hostname: string;
    osVersion: string;
    uptime: number;          // seconds
    cpus: { count: number; model: string; usage: number };  // usage 0-100%
    memory: { total: number; used: number; free: number };   // bytes
    loadAvg: [number, number, number];  // 1m, 5m, 15m
  };

  // Container layer (slow poll — 5min)
  containers: {
    runtime: "docker" | "podman" | "none";
    running: {
      id: string;
      name: string;
      image: string;
      cpu: number;
      memory: number;
      status: string;
    }[];
    stopped: number;  // count only
  };

  // Dev environment layer (slow poll — 5min)
  dev: {
    git?: {
      repo: string;
      branch: string;
      dirty: boolean;
      ahead: number;
      behind: number;
    };
    ports: { port: number; pid: number; process: string }[];
    runtimes: { name: string; version: string }[];  // bun, node, python, etc.
  };
}
```

### SensorConfig

```typescript
interface SensorConfig {
  fastPollInterval: number;   // ms, default 30_000
  slowPollInterval: number;   // ms, default 300_000
  thresholds: AlertThresholds;
  watchContainers: string[];  // container names to monitor for downtime
}
```

### AlertThresholds

```typescript
interface AlertThresholds {
  cpuHigh: number;          // default 85 (%)
  memoryHigh: number;       // default 80 (%)
  memoryCritical: number;   // default 95 (%)
  diskLow: number;          // default 10 (GB free)
  containerDown: string[];  // names to watch
}
```

## Sensor Functions

Pure functions in `sensors.ts` — no state, individually testable, each catches its own errors:

### gatherMachine()

Uses `node:os` APIs:
- `os.cpus()` — count, model, compute usage from idle/total ticks between polls
- `os.totalmem()` / `os.freemem()` — memory
- `os.loadavg()` — load averages
- `os.uptime()` — system uptime
- `os.platform()` / `os.arch()` / `os.hostname()` / `os.version()`

CPU usage requires comparing two samples (idle ticks delta / total ticks delta). The Sensorium stores the previous CPU times and passes them to `gatherMachine()` for accurate calculation.

### gatherContainers()

Shells out via `Bun.$`:
- `docker ps --format '{{json .}}'` — running containers
- `docker ps -a --filter status=exited -q | wc -l` — stopped count
- `docker stats --no-stream --format '{{json .}}'` — CPU/memory per container

Gracefully returns `{ runtime: "none", running: [], stopped: 0 }` if Docker/Podman is not installed or not running.

### gatherDev()

- `git rev-parse --show-toplevel` — detect repo
- `git status --porcelain` — dirty check
- `git branch -vv` — ahead/behind
- `lsof -iTCP -sTCP:LISTEN -nP` (macOS) / `ss -tlnp` (Linux) — listening ports
- `bun --version`, `node --version`, `python3 --version`, etc. — installed runtimes

Each check wrapped in try/catch — missing git, no listening ports, etc. are all safe states.

## Alert System

### Threshold Evaluation

After each snapshot, the Sensorium compares values against thresholds:

| Metric | Signal | Condition |
|--------|--------|-----------|
| CPU | `custom:env-cpu-high` | > cpuHigh for 2+ consecutive polls |
| Memory | `custom:env-memory-high` | > memoryHigh |
| Memory | `custom:env-memory-critical` | > memoryCritical |
| Disk | `custom:env-disk-low` | < diskLow GB free |
| Container | `custom:env-container-down` | watched container not in running list |

### Hysteresis

Alerts fire on state *transitions* only (normal → high), not on every poll while the condition persists. A corresponding clear event fires when the metric returns below threshold. This prevents alert spam.

### Three-Layer Surfacing

1. **Passive context** — `getContextBlock()` returns a compact 1-2 line summary appended to the system prompt. Friday naturally knows "memory is at 92%" without explicit alerts.

2. **Notifications** — Threshold crossings call `NotificationManager.notify()` with formatted terminal warnings between prompts.

3. **Signal-driven directives** — Emitted `custom:env-*` signals can trigger directives. Example: a directive that auto-prompts Friday with "Diagnose memory usage" when `custom:env-memory-critical` fires.

## Context Block

The `getContextBlock()` method returns a compact environment summary for system prompt injection:

```
[ENVIRONMENT] macOS 15.3 arm64 | 8 cores @ 12% | 14.2/32GB RAM (44%) |
Disk: 234GB free | Docker: 3 running (postgres, redis, nginx) |
Git: friday@main (clean) | Ports: 3000, 5432, 6379
```

Cortex's `buildSystemPrompt()` appends this after SMARTS knowledge, before the conversation. The block is regenerated on every `chat()` call from the latest snapshot.

## Protocol: `/env`

Direct CLI access, bypasses LLM:

| Subcommand | Description |
|------------|-------------|
| `/env` or `/env status` | Full snapshot summary (formatted, colored) |
| `/env cpu` | CPU details — per-core usage, load averages |
| `/env memory` | Memory breakdown — system usage |
| `/env docker` | Container list with resource usage |
| `/env ports` | Listening ports with owning processes |
| `/env git` | Git repo status (branch, dirty, ahead/behind) |
| `/env watch` | Toggle live monitoring — reprints status every poll cycle |

Aliases: `["environment", "sys"]`

## Tool: `getEnvironmentStatus`

LLM-callable tool for context-aware environment queries:

```typescript
{
  name: "getEnvironmentStatus",
  description: "Check system environment: CPU, memory, disk, containers, ports, git status",
  parameters: [
    { name: "section", type: "string", required: false, default: "all" }
    // "all", "cpu", "memory", "docker", "ports", "git"
  ],
  clearance: ["system"],
}
```

Returns structured `artifacts` (the full or partial SystemSnapshot) for LLM reasoning, plus a human-readable `output` string.

## Lifecycle

### Boot

1. Create `Sensorium` with config + SignalBus + NotificationManager
2. Run initial snapshot (synchronous gather, so first prompt has data)
3. Start fast poll interval (30s)
4. Start slow poll interval (5min)
5. Register `/env` protocol
6. Register `getEnvironmentStatus` tool on Cortex

### Shutdown

1. Clear both intervals
2. Log final snapshot to audit
3. No cleanup needed (no persistent state)

## Testing Strategy

- **`sensors.test.ts`** — Mock `node:os` returns, mock `Bun.$` shell outputs. Test each gather function independently. Test error paths (Docker not installed, not a git repo, lsof permission denied).
- **`sensorium.test.ts`** — Test snapshot storage, threshold evaluation, hysteresis (alert fires once not every poll), signal emission via stub SignalBus. Call poll method directly rather than using timers.
- **`protocol.test.ts`** — Same pattern as history-protocol tests. Feed raw args, assert output.
- **`tool.test.ts`** — Verify clearance check, artifacts structure, section filtering.
- **Runtime integration** — Boot with sensorium enabled, verify accessible, verify shutdown stops cleanly.

Estimated: ~12-15 new tests.

## YAGNI — Explicitly Out of Scope

- No historical trend storage in SQLite
- No web dashboard or UI
- No remote machine monitoring
- No custom sensor plugin system
- No process killing or resource management actions
- No disk I/O or network throughput metrics

These can be added later if needed. V1 is read-only environmental awareness.
