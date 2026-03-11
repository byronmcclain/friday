# Notification Broadcast to All Connected Clients

**Date:** 2026-03-11
**Status:** Approved

## Problem

Notifications from Sensorium (memory/CPU/container alerts) and Arc Rhythm (auto-pause) only reach:
- **TerminalChannel** — prints to the server process's stdout
- **AuditLogChannel** — logs to the in-memory audit buffer
- **WebSocketNotificationChannel** — pushes to web UI clients via WebSocket

TUI clients connected via Unix socket (`friday chat`) receive no notifications. This is a dual-transport gap — the WebSocket path has per-client notification channels, but the Unix socket path does not.

## Solution

1. Rename `WebSocketNotificationChannel` to `PushNotificationChannel` (transport-agnostic)
2. Wire per-client `PushNotificationChannel` in `socket.ts` on client identify, remove on disconnect
3. Add `onNotification` callback to `SocketBridge` for the TUI to consume
4. TUI displays notifications as both a toast overlay and a log panel entry

## Design

### PushNotificationChannel (rename)

`src/server/ws-channel.ts` → `src/server/push-channel.ts`

The class wraps a `SendFn` and sends `type: "notification"` messages. It is transport-agnostic — the same class serves both WebSocket and Unix socket clients. Rename:
- File: `ws-channel.ts` → `push-channel.ts`
- Class: `WebSocketNotificationChannel` → `PushNotificationChannel`

### Unix socket wiring (`src/server/socket.ts`)

On `session:identify` and `session:boot`, create a `PushNotificationChannel` wrapping the client's `send` function. Add it to `NotificationManager` with a per-client name (`socket-${clientId}`). Remove it on socket `close`.

Expand `socketClients` map value from `string` (clientId) to `{ clientId: string; channelName: string }` for cleanup on disconnect.

This mirrors the WebSocket path in `handler.ts` (lines 145-150) — per-client lifecycle, auto-removed on disconnect.

### SocketBridge callback (`src/core/bridges/socket.ts`)

New optional callback:
```ts
onNotification?: (msg: Extract<ServerMessage, { type: "notification" }>) => void;
```

In `handleServerMessage()`, add a case for `type: "notification"` before the requestId-based routing (same pattern as `onAuditEntry` and `onConversationMessage`).

### TUI rendering (`src/cli/tui/app.tsx`)

Wire `socketBridge.onNotification` in the boot effect alongside other callbacks:

- **Toast:** `toast()` with level-appropriate prefix icon (`ℹ` / `⚠` / `🚨`)
- **Log panel:** `pushLog()` with level mapping: `info` → `"info"`, `warning` → `"warning"`, `alert` → `"error"`

Both fire for every notification — toast for immediate visibility, log panel for persistence/debugging.

### Notification level to display mapping

| Notification Level | Toast Prefix | Log Panel Level |
|---|---|---|
| `info` | `ℹ` | `info` |
| `warning` | `⚠` | `warning` |
| `alert` | `🚨` | `error` |

## Changes

| File | Change |
|---|---|
| `src/server/ws-channel.ts` → `src/server/push-channel.ts` | Rename file + class to `PushNotificationChannel` |
| `src/server/handler.ts` | Update import path and class name |
| `src/server/socket.ts` | Import `PushNotificationChannel`, wire per-client on identify/boot, remove on close, expand socketClients map |
| `src/core/bridges/socket.ts` | Add `onNotification` callback, handle `type: "notification"` |
| `src/cli/tui/app.tsx` | Wire `onNotification` → toast + pushLog |
| Tests for socket.ts, bridges/socket.ts, and app.tsx changes |

## Follow-up

**TODO:** Verify that the web UI React app (`web/src/`) actually renders incoming `type: "notification"` messages from the WebSocket. The server-side push already works via `PushNotificationChannel`, but the client-side rendering has not been verified. This is a separate task.
