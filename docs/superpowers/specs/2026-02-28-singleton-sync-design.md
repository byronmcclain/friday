# Singleton Runtime Conversation Sync Design

**Date:** 2026-02-28
**Status:** Approved

## Problem Statement

The singleton FridayRuntime serves multiple clients (TUI via Unix socket, browser via WebSocket) but has three gaps:

1. **No history hydration** — clients connecting to a running singleton never receive the existing Cortex conversation history
2. **No cross-client sync** — messages sent from one client don't appear in other connected clients. WebSocket has broadcast infrastructure but no client handles it; Unix socket has no broadcast at all
3. **No per-session teardown** — conversation save, summary generation, and knowledge extraction only happen on full `runtime.shutdown()`. Clients disconnecting from the singleton trigger none of these steps

## Design Decisions

- **Full replay on connect** — send all messages from `Cortex.getHistory()` as `conversation:message` events with `source: "replay"`
- **Unified ClientRegistry** — one registry shared across WebSocket and Unix socket transports
- **SessionHub coordination layer** — new class in `src/server/` that owns the registry and session lifecycle, keeping transport logic separate from domain logic
- **Save on last disconnect** — when the final client unregisters, save conversation + generate summary + extract knowledge + clear Cortex. Future: auto-save on timer for crash resilience (TODO)
- **Fresh start after save** — Cortex clears after save. Next client gets a clean slate. SMARTS still enriched from extracted knowledge; `/history` and `recall_memory` available for past sessions
- **Web UI is voice-only** — no `conversation:message` handling needed in the React web UI, now or ever
- **Simple reconnect guard** — if a client registers during an in-progress save, skip the Cortex clear so the new client inherits the history

## Architecture

```
                    SessionHub
            ┌──────────────────────────┐
            │ ClientRegistry (unified) │
            │ sessionId / startedAt    │
            │ _saving guard flag       │
            │                          │
            │ registerClient()         │
            │   → add to registry      │
            │   → hydrateClient()      │
            │   → startSession() if    │
            │     first client         │
            │                          │
            │ unregisterClient()       │
            │   → remove from registry │
            │   → endSession() if      │
            │     last client          │
            │                          │
            │ broadcast()              │
            │   → registry.broadcast() │
            └──────────┬───────────────┘
                       │
          ┌────────────┼────────────────┐
          ▼            ▼                ▼
   WebSocketHandler  SocketServer   FridayRuntime
   (ws transport)   (unix socket)  (Cortex, Memory,
                                    Summarizer, Curator)
```

## SessionHub API

```typescript
interface SessionHubConfig {
  runtime: FridayRuntime;
  summarizer?: ConversationSummarizer;
  curator?: SmartsCurator;
}

class SessionHub {
  private registry = new ClientRegistry();
  private runtime: FridayRuntime;
  private summarizer?: ConversationSummarizer;
  private curator?: SmartsCurator;
  private sessionId: string | null = null;
  private sessionStartedAt: Date | null = null;
  private _saving = false;

  constructor(config: SessionHubConfig);

  registerClient(client: RegisteredClient): void;
  unregisterClient(id: string): Promise<void>;
  broadcast(msg: ServerMessage, excludeId?: string): void;
  get clientCount(): number;

  // Called before runtime.shutdown() on SIGINT
  async saveIfActive(): Promise<void>;

  private startSession(): void;
  private async endSession(): Promise<void>;
  private hydrateClient(client: RegisteredClient): void;
}
```

### Session Lifecycle

```
NO_SESSION ──(first client registers)──► ACTIVE
ACTIVE     ──(last client unregisters)─► SAVING
SAVING     ──(save complete, no reconnect)──► NO_SESSION
SAVING     ──(client reconnected during save)──► ACTIVE (skip clear)
ACTIVE     ──(SIGINT/SIGTERM)──────────► SAVING → runtime.shutdown()
```

### Reconnect Guard

```typescript
async unregisterClient(id: string): Promise<void> {
  this.registry.unregister(id);
  if (this.registry.count === 0 && this.sessionId && !this._saving) {
    await this.endSession();
  }
}

private async endSession(): Promise<void> {
  this._saving = true;
  try {
    await this.saveConversation();
    // Only clear if no clients reconnected during save
    if (this.registry.count === 0) {
      this.runtime.cortex.clear();
      this.sessionId = null;
      this.sessionStartedAt = null;
    }
  } finally {
    this._saving = false;
  }
}
```

## Protocol Changes

### `src/server/protocol.ts`

Add `"replay"` to the `conversation:message` source union:

```typescript
| {
    type: "conversation:message";
    role: "user" | "assistant";
    content: string;
    source: "voice" | "chat" | "tui" | "replay";
  }
```

No new message types needed.

## Transport Integration

### WebSocket Server (`src/server/index.ts`)

- Remove local `ClientRegistry` — hub owns it
- Pass `SessionHub` to `WebSocketHandler` constructor
- `close` handler calls `hub.unregisterClient(clientId)`

### WebSocketHandler (`src/server/handler.ts`)

- Accept `SessionHub` instead of bare `ClientRegistry`
- `handleIdentify()` calls `hub.registerClient()` (hub handles hydration)
- After chat message processing, calls `hub.broadcast()` for user + assistant messages
- `disconnect()` delegates to hub

### Unix Socket Server (`src/server/socket.ts`)

- Accept `SessionHub` in constructor
- Track per-socket clientId on `open`
- On `session:identify` — call `hub.registerClient()` with a send adapter wrapping `socket.write()`
- After chat messages — call `hub.broadcast()` for cross-client sync
- On `close` — call `hub.unregisterClient(clientId)`

### Serve Command (`src/cli/commands/serve.ts`)

- Create `SessionHub` after `createFridayServer()`
- Pass hub to socket server
- SIGINT handler calls `hub.saveIfActive()` before `runtime.shutdown()`

## Client Changes

### SocketBridge (`src/core/bridges/socket.ts`)

- Add `onConversationMessage` callback property
- In `handleServerMessage()`, handle messages without `requestId` — specifically `conversation:message`
- Fire callback for both replay (hydration) and live sync

```typescript
onConversationMessage?: (msg: {
  role: string;
  content: string;
  source: string;
}) => void;

private handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "conversation:message") {
    this.onConversationMessage?.(msg);
    return;
  }
  // ... existing requestId-based routing
}
```

### TUI App (`src/cli/tui/app.tsx`)

- After creating `SocketBridge`, wire the callback:

```typescript
socketBridge.onConversationMessage = (msg) => {
  dispatch({
    type: "add-message",
    message: createMessage(msg.role as "user" | "assistant", msg.content),
  });
};
```

Handles both history replay and live cross-client sync identically.

### Web UI

No changes. Voice-only — does not render text messages.

## Runtime Changes (`src/core/runtime.ts`)

- Expose `summarizer` and `curator` via public getters (currently private, needed by hub)
- The existing `shutdown()` method continues to work for non-server mode (direct CLI)
- In server mode, the hub handles session save/clear; `runtime.shutdown()` handles subsystem cleanup (Arc Rhythm, Vox, Sensorium, modules, DBs)

## Files Changed

| File | Change |
|------|--------|
| `src/server/session-hub.ts` | **NEW** — SessionHub class |
| `src/server/protocol.ts` | Add `"replay"` to source union |
| `src/server/index.ts` | Create SessionHub, pass to handler |
| `src/server/handler.ts` | Use SessionHub instead of ClientRegistry |
| `src/server/socket.ts` | Accept SessionHub, register/broadcast |
| `src/cli/commands/serve.ts` | Create SessionHub, wire SIGINT |
| `src/core/bridges/socket.ts` | Handle conversation:message callback |
| `src/cli/tui/app.tsx` | Wire onConversationMessage |
| `src/core/runtime.ts` | Expose summarizer/curator getters |

## Future Work

- **Auto-save on timer** — save conversation periodically (e.g., every 5 minutes) for crash resilience. Currently, if the server crashes before the last client disconnects, all conversation data since boot is lost.
- **Web UI text sync** — if a text chat view is ever added to the web UI, wire `conversation:message` handling there.

## Testing

- SessionHub unit tests: register/unregister lifecycle, hydration, save-on-last-disconnect, reconnect guard
- Integration: WebSocket + socket server both registering with hub
- TUI: verify onConversationMessage callback dispatches messages
