# Serve Boot Progress Messages

**Date:** 2026-03-01
**Status:** Approved

## Problem

`friday serve` boots the entire runtime silently — several seconds of no output while Sensorium polls, modules load, Genesis reads, etc. — then the boxen banner appears all at once. The shutdown path already has a step-by-step progress pattern (`→ Stopping Arc Rhythm scheduler...`). Boot should mirror it.

## Design

### Architecture

Add an `onProgress` callback to `runtime.boot()`, mirroring `shutdown()`:

```ts
export type BootStep =
  | "signals" | "memory" | "smarts" | "sensorium"
  | "genesis" | "vox" | "cortex" | "arc-rhythm"
  | "modules" | "ready";

async boot(
  config: RuntimeConfig = {},
  onProgress?: (step: BootStep, label: string) => void,
): Promise<void>
```

The runtime calls `onProgress` after each major subsystem initializes. `serve.ts` passes a formatter that prints arrows in the Friday amber palette — same `step()` helper shutdown already uses.

### Boot Steps

These fire as each subsystem completes (not starts), matching the boot order:

```
Booting F.R.I.D.A.Y. ...
  → Core systems initialized
  → Memory database opened
  → SMARTS knowledge loaded (12 entries)
  → Sensorium polling started
  → Genesis identity loaded (2,847 chars)
  → Vox voice engine ready
  → Cortex online (grok-3-mini)
  → Arc Rhythm scheduler started
  → 8 modules loaded (24 tools, 14 protocols)
╭──────────────────────────────────────────╮
│  F.R.I.D.A.Y.                            │
│  ...                                     │
╰──────────────────────────────────────────╯
```

### Files Changed

| File | Change |
|------|--------|
| `src/core/runtime.ts` | Add `BootStep` type, add `onProgress` param to `boot()`, call at ~10 points |
| `src/cli/commands/serve.ts` | Print "Booting..." header, pass `step()` formatter to `boot()` |
| `src/server/index.ts` | Thread `onProgress` through `createFridayServer()` to `runtime.boot()` |

### Not Changed

- No new dependencies
- No changes to the TUI (has its own splash screen)
- No changes to test signatures (`boot()` calls pass no callback — param is optional)
- Boot order stays exactly the same
