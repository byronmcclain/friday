# Sensorium Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Friday environmental awareness — a Sensorium subsystem that passively senses the machine, containers, and dev environment, proactively alerts on anomalies, and supports on-demand deep dives.

**Architecture:** Core subsystem in `src/sensorium/` following the same pattern as SMARTS (`src/smarts/`). Polling-based with two cadences (fast 30s for machine stats, slow 5min for Docker/Git/ports). Integrates with Cortex (system prompt injection), SignalBus (alert signals), and NotificationManager (terminal warnings). Exposed via `/env` protocol and `getEnvironmentStatus` tool.

**Tech Stack:** TypeScript (strict), Bun runtime, `node:os` for machine stats, `Bun.$` for shell commands (Docker, Git, lsof), `bun:test` for testing.

**Design Doc:** `docs/plans/2026-02-21-sensorium-environment-awareness-design.md`

---

### Task 1: Types & Constants

Define all Sensorium types and default configuration constants.

**Files:**
- Create: `src/sensorium/types.ts`
- Test: `tests/unit/sensorium-types.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import {
  SENSORIUM_DEFAULTS,
  type SystemSnapshot,
  type SensorConfig,
  type AlertThresholds,
  type AlertState,
} from "../../src/sensorium/types.ts";

describe("Sensorium types", () => {
  test("SENSORIUM_DEFAULTS has expected default values", () => {
    expect(SENSORIUM_DEFAULTS.fastPollInterval).toBe(30_000);
    expect(SENSORIUM_DEFAULTS.slowPollInterval).toBe(300_000);
    expect(SENSORIUM_DEFAULTS.thresholds.cpuHigh).toBe(85);
    expect(SENSORIUM_DEFAULTS.thresholds.memoryHigh).toBe(80);
    expect(SENSORIUM_DEFAULTS.thresholds.memoryCritical).toBe(95);
    expect(SENSORIUM_DEFAULTS.thresholds.diskLow).toBe(10);
    expect(SENSORIUM_DEFAULTS.thresholds.watchContainers).toEqual([]);
  });

  test("AlertState enum values are correct", () => {
    expect(AlertState.Normal).toBe("normal");
    expect(AlertState.High).toBe("high");
    expect(AlertState.Critical).toBe("critical");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensorium-types.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/sensorium/types.ts

export interface CpuSnapshot {
  count: number;
  model: string;
  usage: number; // 0-100%
}

export interface MemorySnapshot {
  total: number;  // bytes
  used: number;
  free: number;
}

export interface MachineSnapshot {
  platform: string;
  arch: string;
  hostname: string;
  osVersion: string;
  uptime: number; // seconds
  cpus: CpuSnapshot;
  memory: MemorySnapshot;
  loadAvg: [number, number, number];
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  cpu: number;
  memory: number;
  status: string;
}

export interface ContainerSnapshot {
  runtime: "docker" | "podman" | "none";
  running: ContainerInfo[];
  stopped: number;
}

export interface GitStatus {
  repo: string;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface PortInfo {
  port: number;
  pid: number;
  process: string;
}

export interface RuntimeInfo {
  name: string;
  version: string;
}

export interface DevSnapshot {
  git?: GitStatus;
  ports: PortInfo[];
  runtimes: RuntimeInfo[];
}

export interface SystemSnapshot {
  timestamp: Date;
  machine: MachineSnapshot;
  containers: ContainerSnapshot;
  dev: DevSnapshot;
}

export interface AlertThresholds {
  cpuHigh: number;
  memoryHigh: number;
  memoryCritical: number;
  diskLow: number;
  watchContainers: string[];
}

export interface SensorConfig {
  fastPollInterval: number;
  slowPollInterval: number;
  thresholds: AlertThresholds;
}

export enum AlertState {
  Normal = "normal",
  High = "high",
  Critical = "critical",
}

export const SENSORIUM_DEFAULTS: SensorConfig = {
  fastPollInterval: 30_000,
  slowPollInterval: 300_000,
  thresholds: {
    cpuHigh: 85,
    memoryHigh: 80,
    memoryCritical: 95,
    diskLow: 10,
    watchContainers: [],
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensorium-types.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/sensorium/types.ts tests/unit/sensorium-types.test.ts
git commit -m "feat(sensorium): add types and default config constants"
```

---

### Task 2: Machine Sensor

Pure function `gatherMachine()` that reads CPU, memory, load, and OS info from `node:os`. CPU usage calculation requires comparing two tick samples — the function accepts an optional previous reading for delta calculation.

**Files:**
- Create: `src/sensorium/sensors.ts`
- Test: `tests/unit/sensors.test.ts`

**Context:**
- `node:os` provides `cpus()`, `totalmem()`, `freemem()`, `loadavg()`, `uptime()`, `platform()`, `arch()`, `hostname()`, `version()`
- CPU usage = `1 - (idleDelta / totalDelta)` across all cores between two samples
- First call (no previous sample) returns `usage: 0` since we can't compute a delta yet
- Function must never throw — wrap everything in try/catch, return safe defaults

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { gatherMachine, type CpuTimes } from "../../src/sensorium/sensors.ts";

describe("gatherMachine", () => {
  test("returns valid machine snapshot", async () => {
    const result = await gatherMachine();
    expect(result.platform).toBeTruthy();
    expect(result.arch).toBeTruthy();
    expect(result.hostname).toBeTruthy();
    expect(result.cpus.count).toBeGreaterThan(0);
    expect(result.memory.total).toBeGreaterThan(0);
    expect(result.memory.free).toBeGreaterThan(0);
    expect(result.memory.used).toBe(result.memory.total - result.memory.free);
    expect(result.loadAvg).toHaveLength(3);
    expect(result.uptime).toBeGreaterThan(0);
  });

  test("returns 0 CPU usage on first call (no previous sample)", async () => {
    const result = await gatherMachine();
    expect(result.cpus.usage).toBe(0);
  });

  test("computes CPU usage delta when previous sample provided", async () => {
    // Simulate previous sample: all idle
    const prevTimes: CpuTimes = { idle: 1000, total: 2000 };
    // Simulate current sample: less idle (higher usage)
    // gatherMachine reads real OS data so usage will be >= 0
    const result = await gatherMachine(prevTimes);
    expect(result.cpus.usage).toBeGreaterThanOrEqual(0);
    expect(result.cpus.usage).toBeLessThanOrEqual(100);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensors.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/sensorium/sensors.ts
import {
  cpus,
  totalmem,
  freemem,
  loadavg,
  uptime,
  platform,
  arch,
  hostname,
  version,
} from "node:os";
import type {
  MachineSnapshot,
  ContainerSnapshot,
  DevSnapshot,
} from "./types.ts";

export interface CpuTimes {
  idle: number;
  total: number;
}

export function getCpuTimes(): CpuTimes {
  const cores = cpus();
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.times.idle;
    total += core.times.user + core.times.nice + core.times.sys + core.times.irq + core.times.idle;
  }
  return { idle, total };
}

export async function gatherMachine(prevCpuTimes?: CpuTimes): Promise<MachineSnapshot & { cpuTimes: CpuTimes }> {
  try {
    const cores = cpus();
    const currentTimes = getCpuTimes();

    let usage = 0;
    if (prevCpuTimes) {
      const idleDelta = currentTimes.idle - prevCpuTimes.idle;
      const totalDelta = currentTimes.total - prevCpuTimes.total;
      if (totalDelta > 0) {
        usage = Math.round((1 - idleDelta / totalDelta) * 100);
      }
    }

    const total = totalmem();
    const free = freemem();
    const load = loadavg() as [number, number, number];

    return {
      platform: platform(),
      arch: arch(),
      hostname: hostname(),
      osVersion: version(),
      uptime: uptime(),
      cpus: {
        count: cores.length,
        model: cores[0]?.model ?? "unknown",
        usage,
      },
      memory: { total, used: total - free, free },
      loadAvg: load,
      cpuTimes: currentTimes,
    };
  } catch {
    const currentTimes = { idle: 0, total: 0 };
    return {
      platform: "unknown",
      arch: "unknown",
      hostname: "unknown",
      osVersion: "unknown",
      uptime: 0,
      cpus: { count: 0, model: "unknown", usage: 0 },
      memory: { total: 0, used: 0, free: 0 },
      loadAvg: [0, 0, 0],
      cpuTimes: currentTimes,
    };
  }
}
```

Note: `gatherMachine()` returns `MachineSnapshot & { cpuTimes: CpuTimes }`. The Sensorium class stores `cpuTimes` internally and passes only the `MachineSnapshot` portion into the `SystemSnapshot`. The `cpuTimes` are passed back into the next `gatherMachine()` call for delta calculation.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensors.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/sensorium/sensors.ts tests/unit/sensors.test.ts
git commit -m "feat(sensorium): add gatherMachine sensor with CPU delta calculation"
```

---

### Task 3: Container Sensor

Pure function `gatherContainers()` that shells out to Docker/Podman to get running container info. Gracefully handles Docker not being installed.

**Files:**
- Modify: `src/sensorium/sensors.ts`
- Modify: `tests/unit/sensors.test.ts`

**Context:**
- Use `Bun.$` for shell commands (per CLAUDE.md: prefer `Bun.$\`cmd\`` over execa)
- `docker ps --format '{{json .}}'` returns one JSON object per line
- `docker stats --no-stream --format '{{json .}}'` returns CPU/memory per container
- Must handle: Docker not installed, Docker daemon not running, empty output
- Return `{ runtime: "none", running: [], stopped: 0 }` on any failure

**Step 1: Write the failing tests**

Add to `tests/unit/sensors.test.ts`:

```typescript
import { gatherContainers } from "../../src/sensorium/sensors.ts";

describe("gatherContainers", () => {
  test("returns a valid container snapshot", async () => {
    const result = await gatherContainers();
    expect(result.runtime).toMatch(/^(docker|podman|none)$/);
    expect(Array.isArray(result.running)).toBe(true);
    expect(typeof result.stopped).toBe("number");
  });

  test("each running container has required fields", async () => {
    const result = await gatherContainers();
    for (const c of result.running) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.image).toBeTruthy();
      expect(typeof c.cpu).toBe("number");
      expect(typeof c.memory).toBe("number");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensors.test.ts`
Expected: FAIL — `gatherContainers` not exported

**Step 3: Write minimal implementation**

Add to `src/sensorium/sensors.ts`:

```typescript
export async function gatherContainers(): Promise<ContainerSnapshot> {
  try {
    // Check if docker is available
    const check = await Bun.$`docker info 2>/dev/null`.quiet().nothrow();
    if (check.exitCode !== 0) {
      return { runtime: "none", running: [], stopped: 0 };
    }

    // Get running containers
    const psResult = await Bun.$`docker ps --format '{{json .}}'`.quiet().nothrow();
    const running: ContainerSnapshot["running"] = [];

    if (psResult.exitCode === 0 && psResult.stdout.length > 0) {
      const lines = psResult.stdout.toString().trim().split("\n").filter(Boolean);

      // Get stats for CPU/memory
      const statsResult = await Bun.$`docker stats --no-stream --format '{{json .}}'`.quiet().nothrow();
      const statsMap = new Map<string, { cpu: number; memory: number }>();

      if (statsResult.exitCode === 0 && statsResult.stdout.length > 0) {
        for (const line of statsResult.stdout.toString().trim().split("\n").filter(Boolean)) {
          try {
            const stat = JSON.parse(line);
            statsMap.set(stat.ID || stat.Container, {
              cpu: parseFloat(stat.CPUPerc) || 0,
              memory: parseFloat(stat.MemPerc) || 0,
            });
          } catch { /* skip malformed lines */ }
        }
      }

      for (const line of lines) {
        try {
          const c = JSON.parse(line);
          const id = c.ID ?? "";
          const stats = statsMap.get(id) ?? { cpu: 0, memory: 0 };
          running.push({
            id,
            name: c.Names ?? "",
            image: c.Image ?? "",
            cpu: stats.cpu,
            memory: stats.memory,
            status: c.Status ?? "",
          });
        } catch { /* skip malformed lines */ }
      }
    }

    // Count stopped containers
    const stoppedResult = await Bun.$`docker ps -a --filter status=exited -q`.quiet().nothrow();
    const stopped = stoppedResult.exitCode === 0
      ? stoppedResult.stdout.toString().trim().split("\n").filter(Boolean).length
      : 0;

    return { runtime: "docker", running, stopped };
  } catch {
    return { runtime: "none", running: [], stopped: 0 };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensors.test.ts`
Expected: PASS (5 tests). If Docker is not installed, `runtime` will be `"none"` and tests still pass.

**Step 5: Commit**

```bash
git add src/sensorium/sensors.ts tests/unit/sensors.test.ts
git commit -m "feat(sensorium): add gatherContainers sensor with Docker support"
```

---

### Task 4: Dev Environment Sensor

Pure function `gatherDev()` that checks Git status, listening ports, and installed runtimes.

**Files:**
- Modify: `src/sensorium/sensors.ts`
- Modify: `tests/unit/sensors.test.ts`

**Context:**
- Git: `git rev-parse --show-toplevel` (detect repo), `git status --porcelain` (dirty check), `git rev-parse --abbrev-ref HEAD` (branch), `git rev-list --left-right --count HEAD...@{upstream}` (ahead/behind)
- Ports: `lsof -iTCP -sTCP:LISTEN -nP -Fp -Fn` on macOS — outputs `p<pid>` and `n*:<port>` lines
- On Linux: `ss -tlnp` instead — parse differently based on `os.platform()`
- Runtimes: `bun --version`, `node --version`, `python3 --version`, `go version` — each wrapped in try/catch
- Every subsection must catch errors independently — no git repo, no listening ports, etc. are all safe states

**Step 1: Write the failing tests**

Add to `tests/unit/sensors.test.ts`:

```typescript
import { gatherDev } from "../../src/sensorium/sensors.ts";

describe("gatherDev", () => {
  test("returns valid dev snapshot", async () => {
    const result = await gatherDev();
    expect(Array.isArray(result.ports)).toBe(true);
    expect(Array.isArray(result.runtimes)).toBe(true);
  });

  test("detects git repo when in one", async () => {
    // Test is run from the friday repo, so git should be detected
    const result = await gatherDev();
    expect(result.git).toBeDefined();
    expect(result.git!.branch).toBeTruthy();
    expect(typeof result.git!.dirty).toBe("boolean");
  });

  test("detects bun runtime", async () => {
    const result = await gatherDev();
    const bun = result.runtimes.find((r) => r.name === "bun");
    expect(bun).toBeDefined();
    expect(bun!.version).toBeTruthy();
  });

  test("port entries have required fields", async () => {
    const result = await gatherDev();
    for (const p of result.ports) {
      expect(typeof p.port).toBe("number");
      expect(typeof p.pid).toBe("number");
      expect(typeof p.process).toBe("string");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensors.test.ts`
Expected: FAIL — `gatherDev` not exported

**Step 3: Write minimal implementation**

Add to `src/sensorium/sensors.ts`:

```typescript
import { platform as osPlatform } from "node:os";

export async function gatherDev(): Promise<DevSnapshot> {
  const [git, ports, runtimes] = await Promise.all([
    gatherGit(),
    gatherPorts(),
    gatherRuntimes(),
  ]);
  return { git, ports, runtimes };
}

async function gatherGit(): Promise<DevSnapshot["git"]> {
  try {
    const topLevel = await Bun.$`git rev-parse --show-toplevel 2>/dev/null`.quiet().nothrow();
    if (topLevel.exitCode !== 0) return undefined;

    const repo = topLevel.stdout.toString().trim().split("/").pop() ?? "";
    const branchResult = await Bun.$`git rev-parse --abbrev-ref HEAD`.quiet().nothrow();
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() : "unknown";

    const statusResult = await Bun.$`git status --porcelain`.quiet().nothrow();
    const dirty = statusResult.exitCode === 0 && statusResult.stdout.toString().trim().length > 0;

    let ahead = 0;
    let behind = 0;
    const countResult = await Bun.$`git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null`.quiet().nothrow();
    if (countResult.exitCode === 0) {
      const parts = countResult.stdout.toString().trim().split(/\s+/);
      ahead = parseInt(parts[0] ?? "0", 10) || 0;
      behind = parseInt(parts[1] ?? "0", 10) || 0;
    }

    return { repo, branch, dirty, ahead, behind };
  } catch {
    return undefined;
  }
}

async function gatherPorts(): Promise<DevSnapshot["ports"]> {
  try {
    const ports: DevSnapshot["ports"] = [];
    const plat = osPlatform();

    if (plat === "darwin") {
      const result = await Bun.$`lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null`.quiet().nothrow();
      if (result.exitCode !== 0) return [];
      const lines = result.stdout.toString().trim().split("\n").slice(1); // skip header
      const seen = new Set<number>();
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const proc = parts[0] ?? "";
        const pid = parseInt(parts[1] ?? "0", 10) || 0;
        const nameField = parts[8] ?? "";
        const portMatch = nameField.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1]!, 10);
          if (!seen.has(port)) {
            seen.add(port);
            ports.push({ port, pid, process: proc });
          }
        }
      }
    } else {
      // Linux: ss -tlnp
      const result = await Bun.$`ss -tlnp 2>/dev/null`.quiet().nothrow();
      if (result.exitCode !== 0) return [];
      const lines = result.stdout.toString().trim().split("\n").slice(1);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const addrField = parts[3] ?? "";
        const portMatch = addrField.match(/:(\d+)$/);
        const pidMatch = (parts[5] ?? "").match(/pid=(\d+)/);
        const procMatch = (parts[5] ?? "").match(/\("([^"]+)"/);
        if (portMatch) {
          ports.push({
            port: parseInt(portMatch[1]!, 10),
            pid: pidMatch ? parseInt(pidMatch[1]!, 10) : 0,
            process: procMatch ? procMatch[1]! : "",
          });
        }
      }
    }

    return ports;
  } catch {
    return [];
  }
}

async function gatherRuntimes(): Promise<DevSnapshot["runtimes"]> {
  const runtimes: DevSnapshot["runtimes"] = [];
  const checks = [
    { name: "bun", cmd: () => Bun.$`bun --version`.quiet().nothrow() },
    { name: "node", cmd: () => Bun.$`node --version`.quiet().nothrow() },
    { name: "python3", cmd: () => Bun.$`python3 --version`.quiet().nothrow() },
    { name: "go", cmd: () => Bun.$`go version`.quiet().nothrow() },
    { name: "rust", cmd: () => Bun.$`rustc --version`.quiet().nothrow() },
  ];

  const results = await Promise.all(
    checks.map(async ({ name, cmd }) => {
      try {
        const result = await cmd();
        if (result.exitCode === 0) {
          const output = result.stdout.toString().trim();
          // Extract version number from various formats
          const vMatch = output.match(/(\d+\.\d+[\w.-]*)/);
          return { name, version: vMatch ? vMatch[1]! : output };
        }
      } catch { /* not installed */ }
      return null;
    }),
  );

  for (const r of results) {
    if (r) runtimes.push(r);
  }
  return runtimes;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensors.test.ts`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add src/sensorium/sensors.ts tests/unit/sensors.test.ts
git commit -m "feat(sensorium): add gatherDev sensor (git, ports, runtimes)"
```

---

### Task 5: Sensorium Class

The main `Sensorium` class that owns the polling loop, stores the current snapshot, evaluates alert thresholds with hysteresis, and provides `getContextBlock()` for Cortex integration.

**Files:**
- Create: `src/sensorium/sensorium.ts`
- Test: `tests/unit/sensorium.test.ts`

**Context:**
- Follows the same pattern as `SmartsStore` — initialize with config, provide query methods
- Two polling cadences: fast (30s) for machine stats, slow (5min) for containers + dev
- Alert evaluation uses hysteresis: only emit on state *transitions* (normal→high, high→normal)
- `getContextBlock()` returns a compact 1-2 line string for system prompt injection
- Needs `SignalBus` for emitting alert signals, `NotificationManager` for terminal warnings
- `start()` begins polling, `stop()` clears intervals
- `poll()` is public so tests can call it directly without waiting on intervals

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";

describe("Sensorium", () => {
  let signals: SignalBus;
  let notifications: NotificationManager;
  let sensorium: Sensorium;

  beforeEach(() => {
    signals = new SignalBus();
    notifications = new NotificationManager();
    sensorium = new Sensorium({
      config: SENSORIUM_DEFAULTS,
      signals,
      notifications,
    });
  });

  test("initial snapshot is null before poll", () => {
    expect(sensorium.currentSnapshot).toBeNull();
  });

  test("poll populates snapshot", async () => {
    await sensorium.poll();
    const snap = sensorium.currentSnapshot;
    expect(snap).not.toBeNull();
    expect(snap!.timestamp).toBeInstanceOf(Date);
    expect(snap!.machine.cpus.count).toBeGreaterThan(0);
  });

  test("getContextBlock returns empty string before first poll", () => {
    expect(sensorium.getContextBlock()).toBe("");
  });

  test("getContextBlock returns formatted string after poll", async () => {
    await sensorium.poll();
    const block = sensorium.getContextBlock();
    expect(block).toContain("[ENVIRONMENT]");
    expect(block).toContain("cores");
    expect(block).toContain("RAM");
  });

  test("start and stop manage polling intervals", async () => {
    sensorium.start();
    expect(sensorium.isRunning).toBe(true);
    sensorium.stop();
    expect(sensorium.isRunning).toBe(false);
  });

  test("stop is idempotent", () => {
    sensorium.stop();
    sensorium.stop();
    expect(sensorium.isRunning).toBe(false);
  });

  test("emits signal on memory high transition", async () => {
    const emitted: string[] = [];
    signals.on("custom:env-memory-high", (sig) => {
      emitted.push(sig.name);
    });

    // Force a snapshot with high memory usage
    await sensorium.poll();
    // Directly test threshold evaluation
    sensorium.evaluateAlerts({
      ...sensorium.currentSnapshot!,
      machine: {
        ...sensorium.currentSnapshot!.machine,
        memory: { total: 100, used: 85, free: 15 },
      },
    });

    expect(emitted).toContain("custom:env-memory-high");
  });

  test("hysteresis: does not re-emit on consecutive high readings", async () => {
    const emitted: string[] = [];
    signals.on("custom:env-memory-high", () => {
      emitted.push("high");
    });

    await sensorium.poll();
    const highSnap = {
      ...sensorium.currentSnapshot!,
      machine: {
        ...sensorium.currentSnapshot!.machine,
        memory: { total: 100, used: 85, free: 15 },
      },
    };

    sensorium.evaluateAlerts(highSnap);
    sensorium.evaluateAlerts(highSnap);
    sensorium.evaluateAlerts(highSnap);

    expect(emitted).toHaveLength(1); // Only fires once
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensorium.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/sensorium/sensorium.ts
import type { SignalBus } from "../core/events.ts";
import type { NotificationManager } from "../core/notifications.ts";
import type { SystemSnapshot, SensorConfig } from "./types.ts";
import { AlertState } from "./types.ts";
import { gatherMachine, gatherContainers, gatherDev, type CpuTimes } from "./sensors.ts";

export interface SensoriumOptions {
  config: SensorConfig;
  signals: SignalBus;
  notifications: NotificationManager;
}

export class Sensorium {
  private config: SensorConfig;
  private signals: SignalBus;
  private notifications: NotificationManager;
  private _snapshot: SystemSnapshot | null = null;
  private _prevCpuTimes?: CpuTimes;
  private _fastTimer?: ReturnType<typeof setInterval>;
  private _slowTimer?: ReturnType<typeof setInterval>;
  private _running = false;

  // Hysteresis state
  private _alertStates = {
    cpu: AlertState.Normal,
    memory: AlertState.Normal,
    disk: AlertState.Normal,
    containers: new Set<string>(), // names currently alerted as down
  };
  // CPU high requires 2 consecutive readings
  private _cpuHighCount = 0;

  constructor(options: SensoriumOptions) {
    this.config = options.config;
    this.signals = options.signals;
    this.notifications = options.notifications;
  }

  get currentSnapshot(): SystemSnapshot | null {
    return this._snapshot;
  }

  get isRunning(): boolean {
    return this._running;
  }

  async poll(): Promise<void> {
    const machineResult = await gatherMachine(this._prevCpuTimes);
    this._prevCpuTimes = machineResult.cpuTimes;

    const { cpuTimes: _, ...machine } = machineResult;

    const [containers, dev] = await Promise.all([
      gatherContainers(),
      gatherDev(),
    ]);

    this._snapshot = {
      timestamp: new Date(),
      machine,
      containers,
      dev,
    };

    this.evaluateAlerts(this._snapshot);
  }

  async pollFast(): Promise<void> {
    if (!this._snapshot) {
      await this.poll();
      return;
    }

    const machineResult = await gatherMachine(this._prevCpuTimes);
    this._prevCpuTimes = machineResult.cpuTimes;

    const { cpuTimes: _, ...machine } = machineResult;

    this._snapshot = {
      ...this._snapshot,
      timestamp: new Date(),
      machine,
    };

    this.evaluateAlerts(this._snapshot);
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._fastTimer = setInterval(() => this.pollFast(), this.config.fastPollInterval);
    this._slowTimer = setInterval(() => this.poll(), this.config.slowPollInterval);
  }

  stop(): void {
    if (this._fastTimer) clearInterval(this._fastTimer);
    if (this._slowTimer) clearInterval(this._slowTimer);
    this._fastTimer = undefined;
    this._slowTimer = undefined;
    this._running = false;
  }

  evaluateAlerts(snapshot: SystemSnapshot): void {
    const { thresholds } = this.config;
    const memPercent = snapshot.machine.memory.total > 0
      ? (snapshot.machine.memory.used / snapshot.machine.memory.total) * 100
      : 0;

    // Memory alerts
    if (memPercent >= thresholds.memoryCritical) {
      if (this._alertStates.memory !== AlertState.Critical) {
        this._alertStates.memory = AlertState.Critical;
        this.signals.emit("custom:env-memory-critical", "sensorium", {
          usage: memPercent,
        });
        this.notifications.notify({
          level: "alert",
          title: "Memory Critical",
          body: `Memory usage at ${memPercent.toFixed(0)}% (${formatBytes(snapshot.machine.memory.used)}/${formatBytes(snapshot.machine.memory.total)})`,
          source: "sensorium",
        });
      }
    } else if (memPercent >= thresholds.memoryHigh) {
      if (this._alertStates.memory !== AlertState.High) {
        this._alertStates.memory = AlertState.High;
        this.signals.emit("custom:env-memory-high", "sensorium", {
          usage: memPercent,
        });
        this.notifications.notify({
          level: "warning",
          title: "Memory High",
          body: `Memory usage at ${memPercent.toFixed(0)}% (${formatBytes(snapshot.machine.memory.used)}/${formatBytes(snapshot.machine.memory.total)})`,
          source: "sensorium",
        });
      }
    } else if (this._alertStates.memory !== AlertState.Normal) {
      this._alertStates.memory = AlertState.Normal;
    }

    // CPU alerts (requires 2 consecutive high readings)
    if (snapshot.machine.cpus.usage >= thresholds.cpuHigh) {
      this._cpuHighCount++;
      if (this._cpuHighCount >= 2 && this._alertStates.cpu !== AlertState.High) {
        this._alertStates.cpu = AlertState.High;
        this.signals.emit("custom:env-cpu-high", "sensorium", {
          usage: snapshot.machine.cpus.usage,
        });
        this.notifications.notify({
          level: "warning",
          title: "CPU High",
          body: `CPU usage at ${snapshot.machine.cpus.usage}% (sustained)`,
          source: "sensorium",
        });
      }
    } else {
      this._cpuHighCount = 0;
      if (this._alertStates.cpu !== AlertState.Normal) {
        this._alertStates.cpu = AlertState.Normal;
      }
    }

    // Container down alerts
    if (thresholds.watchContainers.length > 0) {
      const runningNames = new Set(snapshot.containers.running.map((c) => c.name));
      for (const name of thresholds.watchContainers) {
        if (!runningNames.has(name) && !this._alertStates.containers.has(name)) {
          this._alertStates.containers.add(name);
          this.signals.emit("custom:env-container-down", "sensorium", { container: name });
          this.notifications.notify({
            level: "alert",
            title: "Container Down",
            body: `Watched container "${name}" is not running`,
            source: "sensorium",
          });
        } else if (runningNames.has(name) && this._alertStates.containers.has(name)) {
          this._alertStates.containers.delete(name);
        }
      }
    }
  }

  getContextBlock(): string {
    if (!this._snapshot) return "";
    const s = this._snapshot;
    const memUsed = formatBytes(s.machine.memory.used);
    const memTotal = formatBytes(s.machine.memory.total);
    const memPercent = s.machine.memory.total > 0
      ? Math.round((s.machine.memory.used / s.machine.memory.total) * 100)
      : 0;

    const parts: string[] = [
      `${s.machine.osVersion} ${s.machine.arch}`,
      `${s.machine.cpus.count} cores @ ${s.machine.cpus.usage}%`,
      `${memUsed}/${memTotal} RAM (${memPercent}%)`,
    ];

    if (s.containers.runtime !== "none" && s.containers.running.length > 0) {
      const names = s.containers.running.map((c) => c.name).join(", ");
      parts.push(`Docker: ${s.containers.running.length} running (${names})`);
    }

    if (s.dev.git) {
      const dirtyFlag = s.dev.git.dirty ? ", dirty" : ", clean";
      parts.push(`Git: ${s.dev.git.repo}@${s.dev.git.branch}${dirtyFlag}`);
    }

    if (s.dev.ports.length > 0) {
      const portList = s.dev.ports.map((p) => p.port).join(", ");
      parts.push(`Ports: ${portList}`);
    }

    return `[ENVIRONMENT] ${parts.join(" | ")}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)}${units[i]}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensorium.test.ts`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/sensorium/sensorium.ts tests/unit/sensorium.test.ts
git commit -m "feat(sensorium): add Sensorium class with polling, alerts, and context block"
```

---

### Task 6: `/env` Protocol

Create the `/env` protocol for direct CLI access to environment data. Follows the same factory pattern as `createHistoryProtocol()` and `createSmartProtocol()`.

**Files:**
- Create: `src/sensorium/protocol.ts`
- Test: `tests/unit/sensorium-protocol.test.ts`

**Context:**
- Protocol factory takes a `Sensorium` instance, returns a `FridayProtocol`
- Subcommands: `status` (default), `cpu`, `memory`, `docker`, `ports`, `git`
- `/env watch` is deferred (YAGNI for v1 — it would need async terminal control)
- Each subcommand returns formatted text from the current snapshot
- If no snapshot available (pre-poll), return "No environment data available yet."
- Follow the same pattern as `src/history/protocol.ts` — switch on subcommand, helper functions per subcommand

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createEnvProtocol } from "../../src/sensorium/protocol.ts";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";

const stubContext = {
  workingDirectory: "/tmp",
  audit: { log: () => {} } as any,
  signal: { emit: async () => {} } as any,
  memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
  tools: new Map(),
};

describe("/env protocol", () => {
  let sensorium: Sensorium;
  let protocol: ReturnType<typeof createEnvProtocol>;

  beforeEach(async () => {
    sensorium = new Sensorium({
      config: SENSORIUM_DEFAULTS,
      signals: new SignalBus(),
      notifications: new NotificationManager(),
    });
    await sensorium.poll();
    protocol = createEnvProtocol(sensorium);
  });

  test("protocol has correct name and aliases", () => {
    expect(protocol.name).toBe("env");
    expect(protocol.aliases).toContain("environment");
    expect(protocol.aliases).toContain("sys");
  });

  test("default (no subcommand) shows status", async () => {
    const result = await protocol.execute({ rawArgs: "" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("CPU");
    expect(result.summary).toContain("Memory");
  });

  test("status subcommand shows full summary", async () => {
    const result = await protocol.execute({ rawArgs: "status" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("CPU");
  });

  test("cpu subcommand shows CPU details", async () => {
    const result = await protocol.execute({ rawArgs: "cpu" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("cores");
    expect(result.summary).toContain("Load");
  });

  test("memory subcommand shows memory details", async () => {
    const result = await protocol.execute({ rawArgs: "memory" }, stubContext);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Total");
    expect(result.summary).toContain("Used");
    expect(result.summary).toContain("Free");
  });

  test("git subcommand shows git info", async () => {
    const result = await protocol.execute({ rawArgs: "git" }, stubContext);
    expect(result.success).toBe(true);
    // Running from friday repo, should show branch
    expect(result.summary).toContain("Branch");
  });

  test("unknown subcommand returns error", async () => {
    const result = await protocol.execute({ rawArgs: "invalid" }, stubContext);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown subcommand");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensorium-protocol.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/sensorium/protocol.ts
import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../modules/types.ts";
import type { Sensorium } from "./sensorium.ts";

export function createEnvProtocol(sensorium: Sensorium): FridayProtocol {
  return {
    name: "env",
    description: "View system environment: CPU, memory, containers, ports, git",
    aliases: ["environment", "sys"],
    parameters: [],
    clearance: [],
    execute: async (args: Record<string, unknown>, _context: ProtocolContext): Promise<ProtocolResult> => {
      const rawArgs = (args.rawArgs as string) ?? "";
      const parts = rawArgs.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";

      const snap = sensorium.currentSnapshot;
      if (!snap) {
        return { success: false, summary: "No environment data available yet." };
      }

      switch (subcommand) {
        case "":
        case "status":
          return handleStatus(sensorium);
        case "cpu":
          return handleCpu(sensorium);
        case "memory":
        case "mem":
          return handleMemory(sensorium);
        case "docker":
        case "containers":
          return handleDocker(sensorium);
        case "ports":
          return handlePorts(sensorium);
        case "git":
          return handleGit(sensorium);
        default:
          return {
            success: false,
            summary: `Unknown subcommand: "${subcommand}". Available: status, cpu, memory, docker, ports, git`,
          };
      }
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)}${units[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function handleStatus(sensorium: Sensorium): ProtocolResult {
  const s = sensorium.currentSnapshot!;
  const m = s.machine;
  const memPercent = m.memory.total > 0
    ? Math.round((m.memory.used / m.memory.total) * 100)
    : 0;

  const lines: string[] = [
    `System: ${m.osVersion} ${m.arch} (${m.hostname})`,
    `Uptime: ${formatUptime(m.uptime)}`,
    `CPU: ${m.cpus.count} cores (${m.cpus.model}) @ ${m.cpus.usage}%`,
    `Memory: ${formatBytes(m.memory.used)}/${formatBytes(m.memory.total)} (${memPercent}%)`,
    `Load: ${m.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
  ];

  if (s.containers.runtime !== "none") {
    lines.push(`Containers: ${s.containers.running.length} running, ${s.containers.stopped} stopped (${s.containers.runtime})`);
  }

  if (s.dev.git) {
    const dirty = s.dev.git.dirty ? "dirty" : "clean";
    lines.push(`Git: ${s.dev.git.repo}@${s.dev.git.branch} (${dirty})`);
  }

  if (s.dev.ports.length > 0) {
    lines.push(`Ports: ${s.dev.ports.map((p) => `${p.port} (${p.process})`).join(", ")}`);
  }

  if (s.dev.runtimes.length > 0) {
    lines.push(`Runtimes: ${s.dev.runtimes.map((r) => `${r.name} ${r.version}`).join(", ")}`);
  }

  return { success: true, summary: lines.join("\n") };
}

function handleCpu(sensorium: Sensorium): ProtocolResult {
  const m = sensorium.currentSnapshot!.machine;
  const lines = [
    `CPU: ${m.cpus.count} cores (${m.cpus.model})`,
    `Usage: ${m.cpus.usage}%`,
    `Load averages: ${m.loadAvg[0].toFixed(2)} (1m) ${m.loadAvg[1].toFixed(2)} (5m) ${m.loadAvg[2].toFixed(2)} (15m)`,
  ];
  return { success: true, summary: lines.join("\n") };
}

function handleMemory(sensorium: Sensorium): ProtocolResult {
  const m = sensorium.currentSnapshot!.machine.memory;
  const percent = m.total > 0 ? Math.round((m.used / m.total) * 100) : 0;
  const lines = [
    `Total: ${formatBytes(m.total)}`,
    `Used:  ${formatBytes(m.used)} (${percent}%)`,
    `Free:  ${formatBytes(m.free)}`,
  ];
  return { success: true, summary: lines.join("\n") };
}

function handleDocker(sensorium: Sensorium): ProtocolResult {
  const c = sensorium.currentSnapshot!.containers;
  if (c.runtime === "none") {
    return { success: true, summary: "Docker/Podman not detected." };
  }
  if (c.running.length === 0) {
    return { success: true, summary: `${c.runtime}: No running containers. ${c.stopped} stopped.` };
  }
  const lines = [
    `${c.runtime}: ${c.running.length} running, ${c.stopped} stopped`,
    "",
    ...c.running.map((r) =>
      `  ${r.name}  ${r.image}  CPU:${r.cpu.toFixed(1)}%  MEM:${r.memory.toFixed(1)}%  ${r.status}`
    ),
  ];
  return { success: true, summary: lines.join("\n") };
}

function handlePorts(sensorium: Sensorium): ProtocolResult {
  const ports = sensorium.currentSnapshot!.dev.ports;
  if (ports.length === 0) {
    return { success: true, summary: "No listening ports detected." };
  }
  const lines = ports.map((p) => `  :${p.port}  PID:${p.pid}  ${p.process}`);
  return { success: true, summary: `Listening ports (${ports.length}):\n${lines.join("\n")}` };
}

function handleGit(sensorium: Sensorium): ProtocolResult {
  const git = sensorium.currentSnapshot!.dev.git;
  if (!git) {
    return { success: true, summary: "Not in a Git repository." };
  }
  const lines = [
    `Repo: ${git.repo}`,
    `Branch: ${git.branch}`,
    `Status: ${git.dirty ? "dirty (uncommitted changes)" : "clean"}`,
    `Ahead: ${git.ahead}  Behind: ${git.behind}`,
  ];
  return { success: true, summary: lines.join("\n") };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensorium-protocol.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/sensorium/protocol.ts tests/unit/sensorium-protocol.test.ts
git commit -m "feat(sensorium): add /env protocol with status, cpu, memory, docker, ports, git subcommands"
```

---

### Task 7: `getEnvironmentStatus` Tool

Create the LLM-callable tool that lets Friday proactively query environment data.

**Files:**
- Create: `src/sensorium/tool.ts`
- Test: `tests/unit/sensorium-tool.test.ts`

**Context:**
- Follows the `FridayTool` interface from `src/modules/types.ts`
- Takes a `Sensorium` instance, returns a `FridayTool`
- `section` parameter: "all", "cpu", "memory", "docker", "ports", "git"
- Returns human-readable `output` + structured `artifacts` for LLM reasoning
- Requires `["system"]` clearance (defined in `src/core/clearance.ts` but not yet granted by runtime — we'll add it in Task 8)

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createEnvironmentTool } from "../../src/sensorium/tool.ts";
import { Sensorium } from "../../src/sensorium/sensorium.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { SENSORIUM_DEFAULTS } from "../../src/sensorium/types.ts";
import type { FridayTool, ToolContext } from "../../src/modules/types.ts";

const stubToolContext: ToolContext = {
  workingDirectory: "/tmp",
  audit: { log: () => {} } as any,
  signal: { emit: async () => {} } as any,
  memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
};

describe("getEnvironmentStatus tool", () => {
  let sensorium: Sensorium;
  let tool: FridayTool;

  beforeEach(async () => {
    sensorium = new Sensorium({
      config: SENSORIUM_DEFAULTS,
      signals: new SignalBus(),
      notifications: new NotificationManager(),
    });
    await sensorium.poll();
    tool = createEnvironmentTool(sensorium);
  });

  test("tool has correct metadata", () => {
    expect(tool.name).toBe("getEnvironmentStatus");
    expect(tool.clearance).toContain("system");
    expect(tool.parameters).toHaveLength(1);
    expect(tool.parameters[0]!.name).toBe("section");
  });

  test("returns full snapshot when section is 'all'", async () => {
    const result = await tool.execute({ section: "all" }, stubToolContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("CPU");
    expect(result.output).toContain("Memory");
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.machine).toBeDefined();
  });

  test("returns CPU section only", async () => {
    const result = await tool.execute({ section: "cpu" }, stubToolContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("cores");
    expect(result.artifacts!.cpu).toBeDefined();
  });

  test("returns memory section only", async () => {
    const result = await tool.execute({ section: "memory" }, stubToolContext);
    expect(result.success).toBe(true);
    expect(result.artifacts!.memory).toBeDefined();
  });

  test("defaults to 'all' when no section provided", async () => {
    const result = await tool.execute({}, stubToolContext);
    expect(result.success).toBe(true);
    expect(result.artifacts!.machine).toBeDefined();
  });

  test("returns error when no snapshot available", async () => {
    const emptySensorium = new Sensorium({
      config: SENSORIUM_DEFAULTS,
      signals: new SignalBus(),
      notifications: new NotificationManager(),
    });
    const emptyTool = createEnvironmentTool(emptySensorium);
    const result = await emptyTool.execute({}, stubToolContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("No environment data");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sensorium-tool.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/sensorium/tool.ts
import type { FridayTool, ToolContext, ToolResult } from "../modules/types.ts";
import type { Sensorium } from "./sensorium.ts";

export function createEnvironmentTool(sensorium: Sensorium): FridayTool {
  return {
    name: "getEnvironmentStatus",
    description: "Check system environment: CPU, memory, disk, containers, ports, git status. Use this to understand the current state of the machine Friday is running on.",
    parameters: [
      {
        name: "section",
        type: "string",
        description: "Which section to query: 'all', 'cpu', 'memory', 'docker', 'ports', 'git'. Defaults to 'all'.",
        required: false,
        default: "all",
      },
    ],
    clearance: ["system"],
    execute: async (args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> => {
      const snap = sensorium.currentSnapshot;
      if (!snap) {
        return { success: false, output: "No environment data available yet." };
      }

      const section = (args.section as string) ?? "all";

      switch (section) {
        case "cpu":
          return {
            success: true,
            output: `CPU: ${snap.machine.cpus.count} cores (${snap.machine.cpus.model}) @ ${snap.machine.cpus.usage}%\nLoad: ${snap.machine.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
            artifacts: {
              cpu: snap.machine.cpus,
              loadAvg: snap.machine.loadAvg,
            },
          };

        case "memory":
        case "mem": {
          const m = snap.machine.memory;
          const percent = m.total > 0 ? Math.round((m.used / m.total) * 100) : 0;
          return {
            success: true,
            output: `Memory: ${formatBytes(m.used)}/${formatBytes(m.total)} (${percent}% used), ${formatBytes(m.free)} free`,
            artifacts: { memory: m },
          };
        }

        case "docker":
        case "containers":
          return {
            success: true,
            output: snap.containers.runtime === "none"
              ? "Docker/Podman not detected."
              : `${snap.containers.runtime}: ${snap.containers.running.length} running, ${snap.containers.stopped} stopped\n${snap.containers.running.map((c) => `  ${c.name} (${c.image}) CPU:${c.cpu.toFixed(1)}% MEM:${c.memory.toFixed(1)}%`).join("\n")}`,
            artifacts: { containers: snap.containers },
          };

        case "ports":
          return {
            success: true,
            output: snap.dev.ports.length === 0
              ? "No listening ports."
              : snap.dev.ports.map((p) => `:${p.port} (PID:${p.pid} ${p.process})`).join("\n"),
            artifacts: { ports: snap.dev.ports },
          };

        case "git":
          return {
            success: true,
            output: snap.dev.git
              ? `${snap.dev.git.repo}@${snap.dev.git.branch} (${snap.dev.git.dirty ? "dirty" : "clean"}) ahead:${snap.dev.git.ahead} behind:${snap.dev.git.behind}`
              : "Not in a Git repository.",
            artifacts: { git: snap.dev.git ?? null },
          };

        case "all":
        default: {
          const m = snap.machine.memory;
          const memPercent = m.total > 0 ? Math.round((m.used / m.total) * 100) : 0;
          const lines = [
            `System: ${snap.machine.osVersion} ${snap.machine.arch} (${snap.machine.hostname}), uptime ${formatUptime(snap.machine.uptime)}`,
            `CPU: ${snap.machine.cpus.count} cores @ ${snap.machine.cpus.usage}%, load ${snap.machine.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
            `Memory: ${formatBytes(m.used)}/${formatBytes(m.total)} (${memPercent}%), ${formatBytes(m.free)} free`,
          ];

          if (snap.containers.runtime !== "none") {
            lines.push(`Containers: ${snap.containers.running.length} running, ${snap.containers.stopped} stopped`);
          }
          if (snap.dev.git) {
            lines.push(`Git: ${snap.dev.git.repo}@${snap.dev.git.branch} (${snap.dev.git.dirty ? "dirty" : "clean"})`);
          }
          if (snap.dev.ports.length > 0) {
            lines.push(`Ports: ${snap.dev.ports.map((p) => `:${p.port}`).join(", ")}`);
          }
          if (snap.dev.runtimes.length > 0) {
            lines.push(`Runtimes: ${snap.dev.runtimes.map((r) => `${r.name} ${r.version}`).join(", ")}`);
          }

          return {
            success: true,
            output: lines.join("\n"),
            artifacts: {
              machine: snap.machine,
              containers: snap.containers,
              dev: snap.dev,
            },
          };
        }
      }
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)}${units[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/sensorium-tool.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/sensorium/tool.ts tests/unit/sensorium-tool.test.ts
git commit -m "feat(sensorium): add getEnvironmentStatus LLM tool"
```

---

### Task 8: Wire Sensorium into FridayRuntime

Integrate Sensorium into the runtime boot/shutdown lifecycle and inject the context block into Cortex's system prompt.

**Files:**
- Modify: `src/core/runtime.ts` (add `_sensorium` field, boot/shutdown wiring)
- Modify: `src/core/cortex.ts` (add `sensorium` to CortexConfig, use in `buildSystemPrompt()`)
- Modify: `tests/unit/runtime.test.ts` (add Sensorium integration tests)
- Modify: `tests/unit/friday.test.ts` (test Cortex with sensorium context block)

**Context:**
- Boot order: after Cortex construction, before Curator. Create Sensorium → run initial poll → start polling → register protocol → register tool on Cortex.
- Shutdown: stop polling before cleanup. Add between conversation save and curator extraction.
- `RuntimeConfig` gets `enableSensorium?: boolean` (default true in chat command, but tests can opt out)
- Cortex `buildSystemPrompt()` appends sensorium context block after SMARTS knowledge section.
- Grant `"system"` clearance in ClearanceManager's default list.
- Runtime exposes `get sensorium(): Sensorium | undefined`.

**Step 1: Write the failing tests**

Add to `tests/unit/runtime.test.ts`:

```typescript
describe("FridayRuntime — Sensorium integration", () => {
  test("boots with sensorium enabled by default", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    expect(runtime.sensorium).toBeDefined();
    expect(runtime.sensorium!.currentSnapshot).not.toBeNull();
    expect(runtime.sensorium!.isRunning).toBe(true);
    await runtime.shutdown();
  });

  test("sensorium disabled when enableSensorium is false", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider, enableSensorium: false });
    expect(runtime.sensorium).toBeUndefined();
    await runtime.shutdown();
  });

  test("shutdown stops sensorium polling", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    expect(runtime.sensorium!.isRunning).toBe(true);
    await runtime.shutdown();
    // After shutdown, runtime is not booted so sensorium is stopped
  });

  test("/env protocol is registered when sensorium is enabled", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    const envProtocol = runtime.protocols.get("env");
    expect(envProtocol).toBeDefined();
    expect(envProtocol!.name).toBe("env");
    await runtime.shutdown();
  });
});
```

Add to `tests/unit/friday.test.ts`:

```typescript
test("system prompt includes environment context when sensorium provided", async () => {
  // Create a Sensorium and poll it
  const { Sensorium } = await import("../../src/sensorium/sensorium.ts");
  const { SignalBus } = await import("../../src/core/events.ts");
  const { NotificationManager } = await import("../../src/core/notifications.ts");
  const { SENSORIUM_DEFAULTS } = await import("../../src/sensorium/types.ts");

  const sensorium = new Sensorium({
    config: SENSORIUM_DEFAULTS,
    signals: new SignalBus(),
    notifications: new NotificationManager(),
  });
  await sensorium.poll();

  // Create a provider that captures the system prompt
  let capturedPrompt = "";
  const capturingProvider: LLMProvider = {
    name: "capturing",
    defaultModel: "capture",
    chat: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return "ok";
    },
  };

  const cortex = new Cortex({ injectedProvider: capturingProvider, sensorium });
  await cortex.chat("Hello");

  expect(capturedPrompt).toContain("[ENVIRONMENT]");
  expect(capturedPrompt).toContain("cores");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/runtime.test.ts tests/unit/friday.test.ts`
Expected: FAIL — `sensorium` property/config not found

**Step 3: Write minimal implementation**

**Modify `src/core/cortex.ts`:**

Add `sensorium` to `CortexConfig`:

```typescript
import type { Sensorium } from "../sensorium/sensorium.ts";

export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  smartsStore?: SmartsStore;
  sensorium?: Sensorium;
}
```

Store it in the constructor:

```typescript
private sensorium?: Sensorium;

constructor(config: CortexConfig = {}) {
  // ... existing code ...
  this.sensorium = config.sensorium;
}
```

Modify `buildSystemPrompt()` to append environment context:

```typescript
private async buildSystemPrompt(userMessage: string): Promise<string> {
  let prompt = SYSTEM_PROMPT;

  // SMARTS knowledge enrichment
  if (this.smartsStore) {
    const sections: string[] = [];
    // ... existing SMARTS code ...
    if (sections.length > 0) {
      prompt = `${prompt}\n\n## Active Knowledge\n\n...${sections.join("\n\n")}`;
    }
  }

  // Sensorium environment context
  if (this.sensorium) {
    const envBlock = this.sensorium.getContextBlock();
    if (envBlock) {
      prompt = `${prompt}\n\n## Environment\n\n${envBlock}`;
    }
  }

  return prompt;
}
```

**Modify `src/core/runtime.ts`:**

Add imports and fields:

```typescript
import { Sensorium } from "../sensorium/sensorium.ts";
import { createEnvProtocol } from "../sensorium/protocol.ts";
import { createEnvironmentTool } from "../sensorium/tool.ts";
import { SENSORIUM_DEFAULTS } from "../sensorium/types.ts";

export interface RuntimeConfig extends Partial<FridayConfig> {
  // ... existing ...
  enableSensorium?: boolean;
}
```

Add to class fields:

```typescript
private _sensorium?: Sensorium;

get sensorium(): Sensorium | undefined {
  return this._sensorium;
}
```

Add to `boot()` — after Cortex construction, before Curator:

```typescript
// Sensorium — after Cortex so we can register the tool
if (config.enableSensorium !== false) {
  this._sensorium = new Sensorium({
    config: SENSORIUM_DEFAULTS,
    signals: this._signals,
    notifications: this._notifications,
  });
  await this._sensorium.poll(); // Initial snapshot
  this._sensorium.start();      // Begin polling
  this._protocols.register(createEnvProtocol(this._sensorium));
  this._cortex.registerTool(createEnvironmentTool(this._sensorium));
}
```

Modify Cortex construction to pass sensorium:

```typescript
this._cortex = new Cortex({
  ...config,
  injectedProvider: config.injectedProvider,
  smartsStore: this._smarts,
  sensorium: this._sensorium,
});
```

Wait — the Cortex needs the sensorium reference, but Sensorium is created AFTER Cortex. Two options:
1. Create Sensorium before Cortex (but then we can't register the tool until after Cortex)
2. Use a setter on Cortex to inject sensorium after construction

Better approach: Create Sensorium before Cortex (it doesn't depend on Cortex). Register the tool on Cortex after construction. This means:

```typescript
// Sensorium — before Cortex
if (config.enableSensorium !== false) {
  this._sensorium = new Sensorium({
    config: SENSORIUM_DEFAULTS,
    signals: this._signals,
    notifications: this._notifications,
  });
  await this._sensorium.poll();
  this._sensorium.start();
  this._protocols.register(createEnvProtocol(this._sensorium));
}

// Cortex — after Sensorium so it has the context block
this._cortex = new Cortex({
  ...config,
  injectedProvider: config.injectedProvider,
  smartsStore: this._smarts,
  sensorium: this._sensorium,
});

// Register sensorium tool on Cortex (needs Cortex to exist)
if (this._sensorium) {
  this._cortex.registerTool(createEnvironmentTool(this._sensorium));
}
```

Add to `shutdown()` — before `session:end` signal:

```typescript
if (this._sensorium) {
  this._sensorium.stop();
  this._sensorium = undefined;
}
```

Add `"system"` to default clearance grants:

```typescript
this._clearance = new ClearanceManager([
  "read-fs", "write-fs", "exec-shell", "network",
  "git-read", "git-write", "provider", "system",
]);
```

Add cleanup in error handler:

```typescript
if (this._sensorium) {
  this._sensorium.stop();
  this._sensorium = undefined;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts tests/unit/friday.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new)

**Step 6: Commit**

```bash
git add src/core/runtime.ts src/core/cortex.ts tests/unit/runtime.test.ts tests/unit/friday.test.ts
git commit -m "feat(sensorium): wire into FridayRuntime boot/shutdown and Cortex system prompt"
```

---

### Task 9: Wire into Chat Command

Enable Sensorium in the chat command (already enabled by default via `enableSensorium !== false`). Verify end-to-end by running the CLI.

**Files:**
- Verify: `src/cli/commands/chat.ts` (no changes needed if `enableSensorium` defaults to true)
- Modify: `tests/unit/runtime.test.ts` (add end-to-end test via runtime.process())

**Step 1: Write the failing test**

Add to `tests/unit/runtime.test.ts`:

```typescript
test("process sends environment context in system prompt", async () => {
  let capturedPrompt = "";
  const capturingProvider: LLMProvider = {
    name: "capturing",
    defaultModel: "capture",
    chat: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return "I can see the system!";
    },
  };

  const runtime = new FridayRuntime();
  await runtime.boot({ injectedProvider: capturingProvider });
  await runtime.process("What's the system status?");

  expect(capturedPrompt).toContain("[ENVIRONMENT]");
  expect(capturedPrompt).toContain("cores");

  await runtime.shutdown();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL (or PASS if Task 8 already wired everything correctly — in which case this test confirms it)

**Step 3: Verify chat.ts needs no changes**

The chat command calls `runtime.boot()` which has `enableSensorium !== false` as the default. Since `enableSensorium` is not set in the chat command's boot config, it defaults to `undefined`, and `undefined !== false` is `true`, so Sensorium is enabled.

No code changes needed to `chat.ts`.

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 5: Run linting**

Run: `bun run lint:fix`
Expected: Clean

**Step 6: Commit**

```bash
git add tests/unit/runtime.test.ts
git commit -m "test(sensorium): add end-to-end test for environment context in system prompt"
```

---

### Task 10: Final Verification & Cleanup

Run full test suite, lint, typecheck. Update CLAUDE.md with new file counts and architecture references.

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass. Count should be approximately 185+ (167 existing + ~18 new sensorium tests).

**Step 2: Run linting**

Run: `bun run lint:fix`
Expected: Clean

**Step 3: Run type checking**

Run: `bun run typecheck`
Expected: Clean

**Step 4: Verify no duplicate `formatBytes` / `formatUptime`**

Both `sensorium.ts`, `protocol.ts`, and `tool.ts` define `formatBytes()`. Extract to a shared utility if this is flagged in review. For now, keeping them module-private is acceptable (3 small functions, no shared import needed).

**Step 5: Commit final state**

```bash
git add -A
git commit -m "chore(sensorium): final verification — all tests pass, lint clean"
```
