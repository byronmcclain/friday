# Tool-Aware Thinking Indicator

**Date:** 2026-03-01
**Status:** Approved

## Overview

Enhance the TUI's "Friday Thinking..." indicator to show which tool is currently executing, Claude Code style: `⠋ fs.read src/core/cortex.ts` instead of the static `⠋ thinking...`.

## Design Decisions

- **Display style:** Raw tool name + compact first-string-arg summary (Claude Code style)
- **Data path:** SignalBus events from Cortex → Server WebSocket → SocketBridge → TUI
- **Multi-tool behavior:** Show only the latest/current tool (each new tool replaces the previous)
- **Args formatting:** Pick first string-valued arg, truncate at 50 chars

## Data Flow

```
Cortex tool execute wrapper
  └─ signals.emit("tool:executing", toolName, { args })
       └─ SignalBus handler (registered per-client in WebSocketHandler)
            └─ send({ type: "signal", name, source, data })
                 └─ SocketBridge.handleServerMessage()
                      └─ onToolExecuting(name, args)
                           └─ dispatch({ type: "tool:executing", name, args })
                                └─ ThinkingIndicator renders "⠋ fs.read src/core/cortex.ts"
```

## Changes by Layer

### Layer 1: Signal (src/core/events.ts)

Add `"tool:executing"` to the `SignalName` union type.

### Layer 2: Cortex (src/core/cortex.ts)

In `buildAiTools()`, inside the `execute` callback, emit the signal **before** the tool runs (after clearance check passes):

```typescript
await this.signals?.emit("tool:executing", name, { args });
```

The `source` field carries the tool name, `data.args` carries the tool arguments.

### Layer 3: Server Forwarding (src/server/handler.ts)

In `handleIdentify()`, subscribe to `tool:executing` on the SignalBus and forward to the client using the existing `signal` ServerMessage type:

```typescript
const toolHandler = (signal: Signal) => {
  send({
    type: "signal",
    name: signal.name,
    source: signal.source,
    data: signal.data,
  });
};
this.runtime.signals.on("tool:executing", toolHandler);
```

Store the handler reference for cleanup in `disconnect()` via `signals.off()`.

### Layer 4: SocketBridge (src/core/bridges/socket.ts)

Add `onToolExecuting` callback (following `onAuditEntry` pattern):

```typescript
onToolExecuting?: (name: string, args: Record<string, unknown>) => void;
```

In `handleServerMessage()`, catch `signal` type messages where `name === "tool:executing"` and invoke the callback.

### Layer 5: TUI State (src/cli/tui/state.ts)

Add to `AppState`:

```typescript
currentTool: { name: string; args: Record<string, unknown> } | null;
```

Add action:

```typescript
| { type: "tool:executing"; name: string; args: Record<string, unknown> }
```

Reducer rules:
- `tool:executing` → sets `currentTool` (replaces previous)
- `chat:chunk` → clears `currentTool` (first text token = tool phase over)
- `set-thinking: false` → clears `currentTool` (error/protocol paths)

### Layer 6: TUI App (src/cli/tui/app.tsx)

Wire `socketBridge.onToolExecuting` in the boot effect:

```typescript
socketBridge.onToolExecuting = (name, args) => {
  if (cancelled) return;
  dispatch({ type: "tool:executing", name, args });
};
```

Pass `state.currentTool` through `ChatArea` → `ThinkingIndicator`.

### Layer 7: ThinkingIndicator (src/cli/tui/components/thinking.tsx)

Accept `currentTool` prop. When present, render tool info instead of "thinking...":

```typescript
function formatToolSummary(name: string, args: Record<string, unknown>): string {
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v.length > 0) {
      const display = v.length > 50 ? v.slice(0, 47) + "..." : v;
      return `${name} ${display}`;
    }
  }
  return name;
}
```

### Layer 7b: ChatArea (src/cli/tui/components/chat-area.tsx)

Pass `currentTool` prop through to `ThinkingIndicator`.

## Files Changed

| File | Change |
|------|--------|
| `src/core/events.ts` | Add `"tool:executing"` to `SignalName` |
| `src/core/cortex.ts` | Emit signal in tool execute wrapper |
| `src/server/handler.ts` | Subscribe/forward per-client, cleanup on disconnect |
| `src/core/bridges/socket.ts` | Add `onToolExecuting` callback, route signal messages |
| `src/cli/tui/state.ts` | Add `currentTool` state, action, reducer logic |
| `src/cli/tui/app.tsx` | Wire callback, pass state to ChatArea |
| `src/cli/tui/components/chat-area.tsx` | Pass `currentTool` to ThinkingIndicator |
| `src/cli/tui/components/thinking.tsx` | Accept prop, render tool summary |

## Examples

```
 Friday                          Friday
 ⠋ thinking...        →         ⠋ fs.read src/core/cortex.ts

 Friday                          Friday
 ⠋ thinking...        →         ⠋ git.status

 Friday                          Friday
 ⠋ thinking...        →         ⠋ gmail.search subject:invoice
```
