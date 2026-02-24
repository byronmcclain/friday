# TUI Log Panel Design

**Date**: 2026-02-24
**Status**: Approved

## Overview

Add a toggleable right-side log panel to Friday's OpenTUI-based terminal interface. The panel displays a unified stream of audit logs (tool executions, module operations, clearance checks) and system lifecycle events (boot phases, provider connections, shutdown steps) in real-time. Hidden by default, toggled with `Ctrl+L`.

## Layout

```
Hidden (default):                  Visible (Ctrl+L):
┌─────────────────────────┐       ┌────────────────┬────────┐
│  Header                 │       │  Header        │        │
├─────────────────────────┤       ├────────────────┤  Log   │
│                         │       │                │  Panel  │
│  ChatArea               │       │  ChatArea      │        │
│                         │       │                │        │
├─────────────────────────┤       ├────────────────┤        │
│  InputBar               │       │  InputBar      │        │
└─────────────────────────┘       └────────────────┴────────┘
```

- Panel width: 30% of terminal width, capped at 60 columns max
- Toggle: `Ctrl+L` key handler in `FridayApp`
- State: `logPanelVisible: boolean` in `AppState` with `toggle-log-panel` action
- Panel has left border in `PALETTE.borderDim`
- Panel header: "LOGS" label in `PALETTE.amberDim`

## Data Model

### LogEntry

```typescript
interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "success" | "warning" | "error";
  source: string;      // e.g. "audit", "runtime", "cortex"
  message: string;     // human-readable summary
  detail?: string;     // expanded detail (from AuditEntry.detail)
}
```

### Data Flow

Two sources feed into the unified log stream:

1. **Audit entries** (from `AuditLogger`): Add an `onLog` callback to `AuditLogger.log()` that fires on every new entry. Maps `AuditEntry` fields to `LogEntry` (success → level, action → message).

2. **System lifecycle events** (from `FridayRuntime`): Boot phases, shutdown steps, Forge restarts, provider connections. Currently appear only as chat "system" messages — additionally piped to the log stream.

### LogStore

Simple in-memory store living in the TUI layer:
- Array of `LogEntry` with max 500 entries (ring buffer or trim from front)
- Subscriber callback pattern: `subscribe(callback)` / `unsubscribe(callback)`
- `push(entry)` adds entry and notifies subscribers

## Visual Rendering

Each log line:
```
14:23:05 [audit] ✓ tool:read_file — /src/core/runtime.ts
14:23:06 [runtime] ● Loaded 7 modules
14:23:07 [audit] ✗ tool:exec_shell — Permission denied
```

- **Timestamp**: `HH:MM:SS` in `PALETTE.textMuted`
- **Source tag**: `[audit]`/`[runtime]` in `PALETTE.amberDim`
- **Status icon**: `✓` (success, green), `✗` (error, red), `●` (info, amber), `⚠` (warning, yellow)
- **Message**: in `PALETTE.textPrimary`, truncated to fit panel width

### Panel Structure

```
┌─ LOGS ──────────────────┐
│ 14:23:05 [audit] ✓ ...  │
│ 14:23:06 [runtime] ● ...│
│ 14:23:07 [audit] ✗ ...  │
│                          │
│              ▼ 3 new     │
└──────────────────────────┘
```

- Header: "LOGS" in `PALETTE.amberDim` with horizontal rule
- Background: `PALETTE.surface` (slightly lighter than main bg)
- Left border: `PALETTE.borderDim`

### Scroll Behavior

- Auto-scrolls to bottom by default
- If user scrolls up, pin scroll position; show `▼ N new` indicator at bottom
- Scrolling back to last entry resumes auto-scroll

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/cli/tui/components/log-panel.tsx` | LogPanel OpenTUI component |
| `src/cli/tui/log-store.ts` | LogStore class (array + subscriber callbacks, max 500) |
| `src/cli/tui/log-types.ts` | LogEntry type and level constants |

### Modified Files

| File | Change |
|------|--------|
| `src/audit/logger.ts` | Add `onLog` callback support |
| `src/cli/tui/state.ts` | Add `logPanelVisible` to AppState, `toggle-log-panel` action |
| `src/cli/tui/app.tsx` | Wire `Ctrl+L`, conditional LogPanel, connect AuditLogger.onLog to LogStore, pipe lifecycle events |

### Test Files

| File | Coverage |
|------|----------|
| `tests/unit/tui-log-store.test.ts` | Buffer behavior, max entries, subscriber callbacks |
| `tests/unit/tui-log-panel.test.ts` | LogEntry rendering, level-to-icon mapping, timestamp formatting |
| `tests/unit/audit-logger-callback.test.ts` | AuditLogger onLog callback fires correctly |

## Design Decisions

- **Callback over SignalBus**: Direct `onLog` callback avoids boot-ordering issues (SignalBus fire-and-forget means early events are lost). The callback approach + LogStore buffer captures everything from first boot log.
- **No persistence**: Logs are current-session only. SQLite persistence can be layered in later if needed.
- **500-entry cap**: Prevents unbounded memory growth in long sessions. Oldest entries are trimmed.
- **Right panel over bottom panel**: Preserves vertical space for chat messages, which is the primary interaction. Terminal widths are typically generous enough for a 30% sidebar.
