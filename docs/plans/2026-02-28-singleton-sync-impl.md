# Singleton Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable conversation history hydration on client connect, cross-client message sync, and per-session teardown in singleton mode.

**Architecture:** New `SessionHub` class coordinates between WebSocket/Unix socket transports and FridayRuntime. Unified `ClientRegistry` shared across transports. Hub manages session lifecycle: start on first client, save+clear on last disconnect.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Add `"replay"` to protocol source union

**Files:**
- Modify: `src/server/protocol.ts:71`

**Step 1: Write the failing test**

In `tests/unit/server-protocol.test.ts`, add a test that validates `conversation:message` with `source: "replay"` is a valid `ServerMessage` type. Since this is a type-level change, use `bun run typecheck` as the test.

Create a temporary type-check file:

```typescript
// In tests/unit/server-protocol.test.ts, add to existing tests:
test("conversation:message supports replay source", () => {
  const msg: ServerMessage = {
    type: "conversation:message",
    role: "user",
    content: "hello",
    source: "replay",
  };
  expect(msg.source).toBe("replay");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: TypeScript compile error — `"replay"` is not assignable to `"voice" | "chat" | "tui"`

**Step 3: Write minimal implementation**

In `src/server/protocol.ts:71`, change:
```typescript
| { type: "conversation:message"; role: "user" | "assistant"; content: string; source: "voice" | "chat" | "tui" };
```
to:
```typescript
| { type: "conversation:message"; role: "user" | "assistant"; content: string; source: "voice" | "chat" | "tui" | "replay" };
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/protocol.ts tests/unit/server-protocol.test.ts
git commit -m "feat(protocol): add replay source to conversation:message type"
```

---

### Task 2: Expose summarizer and curator from FridayRuntime

**Files:**
- Modify: `src/core/runtime.ts:76-77` (add getters after existing getters block)

**Step 1: Write the failing test**

```typescript
// In tests/unit/friday.test.ts or a new tests/unit/runtime-getters.test.ts:
import { describe, test, expect } from "bun:test";

describe("FridayRuntime getters", () => {
  test("summarizer getter returns undefined before boot", () => {
    // Runtime exposes summarizer — it's undefined before boot
    const { FridayRuntime } = require("../../src/core/runtime.ts");
    const runtime = new FridayRuntime();
    expect(runtime.summarizer).toBeUndefined();
  });

  test("curator getter returns undefined before boot", () => {
    const { FridayRuntime } = require("../../src/core/runtime.ts");
    const runtime = new FridayRuntime();
    expect(runtime.curator).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime-getters.test.ts`
Expected: FAIL — `runtime.summarizer` is not a property

**Step 3: Write minimal implementation**

In `src/core/runtime.ts`, after the `get fastModel()` getter (line 143-145), add:

```typescript
	get summarizer(): ConversationSummarizer | undefined {
		return this._summarizer;
	}

	get curator(): SmartsCurator | undefined {
		return this._curator;
	}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime-getters.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/runtime.ts tests/unit/runtime-getters.test.ts
git commit -m "feat(runtime): expose summarizer and curator via public getters"
```

---

### Task 3: Create SessionHub

This is the core new file. Build it test-first in several sub-steps.

**Files:**
- Create: `src/server/session-hub.ts`
- Create: `tests/unit/session-hub.test.ts`

**Step 1: Write tests for SessionHub lifecycle**

```typescript
import { describe, test, expect } from "bun:test";
import { SessionHub } from "../../src/server/session-hub.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

function createMockRuntime(history: { role: string; content: string }[] = []) {
  return {
    cortex: {
      getHistory: () => history,
      clearHistory: () => { history.length = 0; },
      providerName: "test-provider",
      modelName: "test-model",
    },
    memory: {
      saveConversation: async () => {},
      indexConversation: async () => {},
    },
    isBooted: true,
  } as any;
}

function createMockClient(id: string) {
  const messages: ServerMessage[] = [];
  return {
    client: {
      id,
      clientType: "tui" as const,
      send: (msg: ServerMessage) => { messages.push(msg); },
      capabilities: new Set(["text"]),
    },
    messages,
  };
}

describe("SessionHub", () => {
  test("starts session on first client register", () => {
    const hub = new SessionHub({ runtime: createMockRuntime() });
    expect(hub.clientCount).toBe(0);

    const { client } = createMockClient("c1");
    hub.registerClient(client);

    expect(hub.clientCount).toBe(1);
  });

  test("hydrates new client with existing history", () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const hub = new SessionHub({ runtime: createMockRuntime(history) });

    const { client, messages } = createMockClient("c1");
    hub.registerClient(client);

    // Should receive 2 conversation:message events with source: "replay"
    const replays = messages.filter(
      (m) => m.type === "conversation:message" && (m as any).source === "replay",
    );
    expect(replays).toHaveLength(2);
    expect((replays[0] as any).role).toBe("user");
    expect((replays[0] as any).content).toBe("hello");
    expect((replays[1] as any).role).toBe("assistant");
    expect((replays[1] as any).content).toBe("hi there");
  });

  test("broadcasts to other clients excluding sender", () => {
    const hub = new SessionHub({ runtime: createMockRuntime() });

    const c1 = createMockClient("c1");
    const c2 = createMockClient("c2");
    hub.registerClient(c1.client);
    hub.registerClient(c2.client);

    // Clear hydration messages
    c1.messages.length = 0;
    c2.messages.length = 0;

    hub.broadcast(
      { type: "conversation:message", role: "user", content: "test", source: "chat" },
      "c1",
    );

    expect(c1.messages).toHaveLength(0);
    expect(c2.messages).toHaveLength(1);
    expect((c2.messages[0] as any).content).toBe("test");
  });

  test("saves conversation on last client disconnect", async () => {
    let saved = false;
    const runtime = createMockRuntime([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    runtime.memory.saveConversation = async () => { saved = true; };

    const hub = new SessionHub({ runtime });

    const { client } = createMockClient("c1");
    hub.registerClient(client);
    await hub.unregisterClient("c1");

    expect(saved).toBe(true);
    expect(hub.clientCount).toBe(0);
  });

  test("does NOT save when non-last client disconnects", async () => {
    let saved = false;
    const runtime = createMockRuntime([
      { role: "user", content: "hello" },
    ]);
    runtime.memory.saveConversation = async () => { saved = true; };

    const hub = new SessionHub({ runtime });

    const c1 = createMockClient("c1");
    const c2 = createMockClient("c2");
    hub.registerClient(c1.client);
    hub.registerClient(c2.client);

    await hub.unregisterClient("c1");

    expect(saved).toBe(false);
    expect(hub.clientCount).toBe(1);
  });

  test("clears cortex history after save on last disconnect", async () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const runtime = createMockRuntime(history);

    const hub = new SessionHub({ runtime });

    const { client } = createMockClient("c1");
    hub.registerClient(client);
    await hub.unregisterClient("c1");

    expect(history).toHaveLength(0);
  });

  test("reconnect guard: skips clear if client reconnects during save", async () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    let saveResolve: (() => void) | null = null;
    const runtime = createMockRuntime(history);
    runtime.memory.saveConversation = () =>
      new Promise<void>((resolve) => { saveResolve = resolve; });

    const hub = new SessionHub({ runtime });

    const c1 = createMockClient("c1");
    hub.registerClient(c1.client);

    // Start unregister (triggers async save)
    const unregisterPromise = hub.unregisterClient("c1");

    // While save is in progress, new client connects
    const c2 = createMockClient("c2");
    hub.registerClient(c2.client);

    // Complete the save
    saveResolve!();
    await unregisterPromise;

    // History should NOT be cleared (c2 reconnected during save)
    expect(history).toHaveLength(2);
    expect(hub.clientCount).toBe(1);
  });

  test("saveIfActive saves without clearing", async () => {
    let saved = false;
    const history = [
      { role: "user", content: "hello" },
    ];
    const runtime = createMockRuntime(history);
    runtime.memory.saveConversation = async () => { saved = true; };

    const hub = new SessionHub({ runtime });
    const { client } = createMockClient("c1");
    hub.registerClient(client);

    await hub.saveIfActive();

    expect(saved).toBe(true);
    // History should NOT be cleared (saveIfActive is for SIGINT, not disconnect)
    expect(history).toHaveLength(1);
  });

  test("does not save when no conversation history", async () => {
    let saved = false;
    const runtime = createMockRuntime([]);
    runtime.memory.saveConversation = async () => { saved = true; };

    const hub = new SessionHub({ runtime });
    const { client } = createMockClient("c1");
    hub.registerClient(client);
    await hub.unregisterClient("c1");

    expect(saved).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/session-hub.test.ts`
Expected: FAIL — module `../../src/server/session-hub.ts` not found

**Step 3: Write SessionHub implementation**

Create `src/server/session-hub.ts`:

```typescript
import { ClientRegistry, type RegisteredClient } from "./client-registry.ts";
import type { ServerMessage } from "./protocol.ts";
import type { FridayRuntime } from "../core/runtime.ts";
import type { ConversationSummarizer } from "../core/summarizer.ts";
import type { SmartsCurator } from "../smarts/curator.ts";

export interface SessionHubConfig {
  runtime: FridayRuntime;
  summarizer?: ConversationSummarizer;
  curator?: SmartsCurator;
}

export class SessionHub {
  private registry = new ClientRegistry();
  private runtime: FridayRuntime;
  private summarizer?: ConversationSummarizer;
  private curator?: SmartsCurator;
  private sessionId: string | null = null;
  private sessionStartedAt: Date | null = null;
  private _saving = false;

  constructor(config: SessionHubConfig) {
    this.runtime = config.runtime;
    this.summarizer = config.summarizer;
    this.curator = config.curator;
  }

  get clientCount(): number {
    return this.registry.count;
  }

  getClientById(id: string): RegisteredClient | undefined {
    return this.registry.getById(id);
  }

  registerClient(client: RegisteredClient): void {
    const wasEmpty = this.registry.count === 0;
    this.registry.register(client);

    if (wasEmpty) {
      this.startSession();
    }

    this.hydrateClient(client);
  }

  async unregisterClient(id: string): Promise<void> {
    this.registry.unregister(id);
    if (this.registry.count === 0 && this.sessionId && !this._saving) {
      await this.endSession();
    }
  }

  broadcast(msg: ServerMessage, excludeId?: string): void {
    this.registry.broadcast(msg, excludeId ? (c) => c.id !== excludeId : undefined);
  }

  /** Save active session without clearing. Used before runtime.shutdown() on SIGINT. */
  async saveIfActive(): Promise<void> {
    if (!this.sessionId) return;
    await this.saveConversation();
  }

  private startSession(): void {
    this.sessionId = crypto.randomUUID();
    this.sessionStartedAt = new Date();
  }

  private async endSession(): Promise<void> {
    this._saving = true;
    try {
      await this.saveConversation();
      // Only clear if no clients reconnected during save
      if (this.registry.count === 0) {
        this.runtime.cortex.clearHistory();
        this.sessionId = null;
        this.sessionStartedAt = null;
      }
      // TODO: Implement periodic auto-save for crash resilience.
      // Currently, if the server crashes before the last client disconnects,
      // all conversation data since session start is lost.
    } finally {
      this._saving = false;
    }
  }

  private async saveConversation(): Promise<void> {
    const memory = this.runtime.memory;
    if (!memory || !this.sessionId || !this.sessionStartedAt) return;

    const history = this.runtime.cortex.getHistory();
    if (history.length === 0) return;

    let summary: string | undefined;
    if (this.summarizer) {
      try {
        summary = await this.summarizer.summarize(history);
      } catch {
        // Summary generation failed — save without summary
      }
    }

    await memory.saveConversation({
      id: this.sessionId,
      startedAt: this.sessionStartedAt,
      endedAt: new Date(),
      provider: this.runtime.cortex.providerName,
      model: this.runtime.cortex.modelName,
      messages: history,
      summary,
    });

    // Index for FTS5 search (Deja Vu recall)
    if (summary) {
      await memory.indexConversation({
        id: this.sessionId,
        startedAt: this.sessionStartedAt,
        endedAt: new Date(),
        provider: this.runtime.cortex.providerName,
        model: this.runtime.cortex.modelName,
        messages: history,
        summary,
      });
    }

    // Extract knowledge via SmartsCurator
    if (this.curator) {
      try {
        await this.curator.extractFromConversation(history);
      } catch {
        // Knowledge extraction failed — non-fatal
      }
    }
  }

  private hydrateClient(client: RegisteredClient): void {
    const history = this.runtime.cortex.getHistory();
    for (const msg of history) {
      client.send({
        type: "conversation:message",
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : String(msg.content),
        source: "replay",
      });
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/session-hub.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/server/session-hub.ts tests/unit/session-hub.test.ts
git commit -m "feat(server): add SessionHub for singleton session lifecycle"
```

---

### Task 4: Wire SessionHub into WebSocket server

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/handler.ts`

**Step 1: Update `createFridayServer` to create and return SessionHub**

In `src/server/index.ts`:

1. Replace `import { ClientRegistry } from "./client-registry.ts"` with `import { SessionHub } from "./session-hub.ts"`.
2. Replace `const registry = new ClientRegistry();` with `const hub = new SessionHub({ runtime });`.
3. Change `WebSocketHandler` constructor calls from `new WebSocketHandler(runtime, registry, clientId)` to `new WebSocketHandler(runtime, hub, clientId)`.
4. Connection limit check: change `registry.count` to `hub.clientCount`.
5. Sensorium push interval setup: change `registry.getById(...)` to `hub.getClientById(...)`.
6. Close handler: replace `registry.unregister(ws.data.clientId)` with `void hub.unregisterClient(ws.data.clientId)`.
7. Return: change `{ server, runtime, registry }` to `{ server, runtime, hub }`.

**Step 2: Update `WebSocketHandler` to accept SessionHub**

In `src/server/handler.ts`:

1. Replace `import { ClientRegistry } from "./client-registry.ts"` with `import { SessionHub } from "./session-hub.ts"`.
2. Change field `private registry: ClientRegistry` to `private hub: SessionHub`.
3. Update constructor: `constructor(runtime: FridayRuntime, hub: SessionHub, clientId: string)`, assign `this.hub = hub`.
4. In `handleIdentify()`: replace `this.registry.register({...})` with `this.hub.registerClient({...})`. Remove the `session:ready` send — the hub's `hydrateClient()` doesn't send it, so keep the `send()` call after `registerClient()`.
5. In `handleLegacyBoot()`: replace `this.registry.getById()` and `this.registry.register()` with `this.hub.getClientById()` and `this.hub.registerClient()`.
6. All `this.registry.broadcast(...)` calls (5 occurrences in handleRuntimeMessage and voice handlers): replace with `this.hub.broadcast(msg, this.clientId)`.

**Step 3: Run existing tests**

Run: `bun test tests/unit/server-handler.test.ts tests/unit/server-index.test.ts`
Expected: PASS (tests may need minor adjustments if they construct WebSocketHandler directly — update constructor args to pass a mock hub)

**Step 4: Commit**

```bash
git add src/server/index.ts src/server/handler.ts tests/unit/server-handler.test.ts tests/unit/server-index.test.ts
git commit -m "refactor(server): wire SessionHub into WebSocket server and handler"
```

---

### Task 5: Wire SessionHub into Unix socket server

**Files:**
- Modify: `src/server/socket.ts`
- Modify: `tests/unit/socket-server.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to tests/unit/socket-server.test.ts:
test("registers client with hub on session:identify", async () => {
  let registered = false;
  const mockHub = {
    registerClient: () => { registered = true; },
    unregisterClient: async () => {},
    broadcast: () => {},
    clientCount: 0,
  } as any;
  const mockRuntime = {
    isBooted: true,
    cortex: { providerName: "test", modelName: "test" },
    protocols: { isProtocol: () => false },
  } as any;

  const server = new FridaySocketServer(mockRuntime, mockHub, TEST_SOCKET, TEST_PID);
  await server.start();

  // Connect and send identify
  const { connect } = await import("node:net");
  const socket = connect({ path: TEST_SOCKET });
  await new Promise<void>((resolve) => socket.on("connect", resolve));
  socket.write(JSON.stringify({ type: "session:identify", id: "r1", clientType: "tui" }) + "\n");

  // Wait for processing
  await new Promise((r) => setTimeout(r, 100));
  expect(registered).toBe(true);

  socket.end();
  await server.stop();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: FAIL — `FridaySocketServer` constructor doesn't accept hub

**Step 3: Refactor FridaySocketServer**

In `src/server/socket.ts`:

1. Add import: `import type { SessionHub } from "./session-hub.ts"`.
2. Add `private hub: SessionHub` field.
3. Update constructor to accept hub: `constructor(runtime, hub, socketPath?, pidPath?)`.
4. Track per-socket client IDs. Add a `private socketClients = new Map<unknown, string>()` to map Bun socket refs to client IDs.
5. In `open`: generate `clientId = crypto.randomUUID()`, store in `socketClients` map.
6. In `session:identify` handler: call `hub.registerClient({ id: clientId, clientType: msg.clientType, send, capabilities: new Set(["text"]) })`.
7. After `chat` message handling: call `hub.broadcast({ type: "conversation:message", ... }, clientId)`.
8. In `close`: call `void hub.unregisterClient(clientId)`.
9. In `session:shutdown`: call `void hub.unregisterClient(clientId)` before sending `session:closed`.

**Step 4: Run tests**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/socket.ts tests/unit/socket-server.test.ts
git commit -m "feat(socket): wire FridaySocketServer into SessionHub"
```

---

### Task 6: Update serve command to create and wire SessionHub

**Files:**
- Modify: `src/cli/commands/serve.ts`

**Step 1: Update serve command**

In `src/cli/commands/serve.ts`:

1. Add import: `import { SessionHub } from "../../server/session-hub.ts"`.
2. After `createFridayServer()`, the hub is now returned in `result.hub`.
3. Pass `result.hub` to `FridaySocketServer` constructor: `new FridaySocketServer(result.runtime, result.hub)`.
4. In the shutdown handler, call `await result.hub.saveIfActive()` before `result.runtime.shutdown()`:

```typescript
const shutdown = async () => {
  console.log(chalk.hex("#8B6914")("\nShutting down server..."));
  if (ttydProc) {
    ttydProc.kill();
  }
  await socketServer.stop();
  await result.hub.saveIfActive();
  if (result.runtime.isBooted) {
    await result.runtime.shutdown();
  }
  result.server.stop(true);
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
};
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/commands/serve.ts
git commit -m "feat(serve): wire SessionHub into serve command with SIGINT save"
```

---

### Task 7: Add conversation:message handling to SocketBridge

**Files:**
- Modify: `src/core/bridges/socket.ts`
- Modify: `tests/unit/socket-bridge.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to tests/unit/socket-bridge.test.ts:
test("fires onConversationMessage for conversation:message events", () => {
  const bridge = new SocketBridge("/tmp/nonexistent.sock");
  const received: any[] = [];
  bridge.onConversationMessage = (msg) => received.push(msg);

  // Simulate server message arriving (call private handler via any cast)
  const msg = {
    type: "conversation:message",
    role: "user",
    content: "hello from another client",
    source: "chat",
  };
  (bridge as any).handleServerMessage(msg);

  expect(received).toHaveLength(1);
  expect(received[0].role).toBe("user");
  expect(received[0].content).toBe("hello from another client");
  expect(received[0].source).toBe("chat");
});

test("fires onConversationMessage for replay messages", () => {
  const bridge = new SocketBridge("/tmp/nonexistent.sock");
  const received: any[] = [];
  bridge.onConversationMessage = (msg) => received.push(msg);

  (bridge as any).handleServerMessage({
    type: "conversation:message",
    role: "assistant",
    content: "replayed response",
    source: "replay",
  });

  expect(received).toHaveLength(1);
  expect(received[0].source).toBe("replay");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: FAIL — `onConversationMessage` does not exist, and `handleServerMessage` currently returns early for messages without `requestId`

**Step 3: Write implementation**

In `src/core/bridges/socket.ts`:

1. Add public callback property after the `private buffer` field (line 14):

```typescript
  onConversationMessage?: (msg: { role: string; content: string; source: string }) => void;
```

2. In `handleServerMessage()` (line 198-221), change the early return guard. Currently:
```typescript
  private handleServerMessage(msg: ServerMessage): void {
    const requestId = "requestId" in msg ? (msg as any).requestId : undefined;
    if (!requestId) return;
```
Replace with:
```typescript
  private handleServerMessage(msg: ServerMessage): void {
    // Handle broadcast messages (no requestId)
    if (msg.type === "conversation:message") {
      this.onConversationMessage?.(msg);
      return;
    }

    const requestId = "requestId" in msg ? (msg as any).requestId : undefined;
    if (!requestId) return;
```

**Step 4: Run tests**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/core/bridges/socket.ts tests/unit/socket-bridge.test.ts
git commit -m "feat(bridge): handle conversation:message events in SocketBridge"
```

---

### Task 8: Wire TUI to receive synced messages

**Files:**
- Modify: `src/cli/tui/app.tsx:150-189` (singleton boot path)

**Step 1: Wire onConversationMessage in singleton boot**

In `src/cli/tui/app.tsx`, after `await socketBridge.connect()` and before the identify call (around line 152), add:

```typescript
// Wire conversation sync — receives both history replay and live messages from other clients
socketBridge.onConversationMessage = (msg) => {
  if (cancelled) return;
  dispatch({
    type: "add-message",
    message: createMessage(msg.role as "user" | "assistant", msg.content),
  });
};
```

This must come BEFORE `socketBridge.identify()` because `identify()` triggers the hub's `registerClient()` which sends hydration messages — the callback must already be wired to receive them.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat(tui): wire conversation sync for singleton mode"
```

---

### Task 9: Run full test suite and lint

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 2: Run linter**

Run: `bun run lint:fix`
Expected: No errors

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Fix any failures discovered**

Address any test or lint failures from the integration.

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve test and lint issues from singleton sync integration"
```

---

### Task 10: Update CLAUDE.md and docs

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture docs**

In `CLAUDE.md`:

1. Add `SessionHub` to the subsystem map table:

```
| **SessionHub** | `src/server/session-hub.ts` | Session lifecycle for singleton. Saves on last disconnect. Unified ClientRegistry across transports. |
```

2. Update the `Server` entry to mention SessionHub.

3. Update boot order if needed (SessionHub is created post-boot, not during boot).

4. Add to Patterns & Gotchas:
   - `SessionHub` owns client lifecycle in server mode. Transports register/unregister via hub. History hydrated on connect via `conversation:message` with `source: "replay"`.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add SessionHub to architecture documentation"
```
