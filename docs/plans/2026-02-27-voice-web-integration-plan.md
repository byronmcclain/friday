# Voice Web Integration & Singleton Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Friday web application into a singleton-runtime-backed voice interface with Cortex-mediated full-duplex voice conversations via the Grok Voice Agent API, replace the web chat UI with ttyd, and enable multi-client access via Unix socket IPC.

**Architecture:** One FridayRuntime singleton serves all clients (web voice, ttyd terminal, local CLI). Voice mode streams raw PCM audio through the backend, where Grok handles STT/TTS and Cortex handles all reasoning with full tool/memory/SMARTS access. The web chat UI is replaced by a ttyd iframe embedding the real terminal TUI.

**Tech Stack:** Bun, TypeScript, React 19, Web Audio API (AudioWorklet), Grok Voice Agent API (WebSocket), ttyd, Unix domain sockets

**Design doc:** `docs/plans/2026-02-27-voice-web-integration-design.md`

---

## Phase 1: Singleton Runtime & Client Registry

### Task 1: ClientRegistry class

**Files:**
- Create: `src/server/client-registry.ts`
- Test: `tests/unit/client-registry.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/client-registry.test.ts
import { describe, test, expect, mock } from "bun:test";
import { ClientRegistry, type RegisteredClient } from "../../src/server/client-registry.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

function makeClient(id: string, clientType: "chat" | "voice" | "tui" = "chat"): RegisteredClient {
  return {
    id,
    clientType,
    send: mock(() => {}),
    capabilities: new Set(clientType === "voice" ? ["audio-in", "audio-out", "text"] : ["text"]),
  };
}

describe("ClientRegistry", () => {
  test("register and count", () => {
    const registry = new ClientRegistry();
    expect(registry.count).toBe(0);
    registry.register(makeClient("a"));
    expect(registry.count).toBe(1);
  });

  test("unregister removes client", () => {
    const registry = new ClientRegistry();
    registry.register(makeClient("a"));
    registry.unregister("a");
    expect(registry.count).toBe(0);
  });

  test("unregister unknown id is no-op", () => {
    const registry = new ClientRegistry();
    registry.unregister("nope");
    expect(registry.count).toBe(0);
  });

  test("broadcast sends to all clients", () => {
    const registry = new ClientRegistry();
    const c1 = makeClient("a");
    const c2 = makeClient("b");
    registry.register(c1);
    registry.register(c2);

    const msg: ServerMessage = { type: "error", code: "TEST", message: "hi" };
    registry.broadcast(msg);

    expect(c1.send).toHaveBeenCalledWith(msg);
    expect(c2.send).toHaveBeenCalledWith(msg);
  });

  test("broadcast with filter only sends to matching clients", () => {
    const registry = new ClientRegistry();
    const voice = makeClient("v", "voice");
    const chat = makeClient("c", "chat");
    registry.register(voice);
    registry.register(chat);

    const msg: ServerMessage = { type: "error", code: "TEST", message: "voice only" };
    registry.broadcast(msg, (c) => c.clientType === "voice");

    expect(voice.send).toHaveBeenCalledWith(msg);
    expect(chat.send).not.toHaveBeenCalled();
  });

  test("getByType returns matching clients", () => {
    const registry = new ClientRegistry();
    registry.register(makeClient("v1", "voice"));
    registry.register(makeClient("c1", "chat"));
    registry.register(makeClient("v2", "voice"));

    const voices = registry.getByType("voice");
    expect(voices).toHaveLength(2);
    expect(voices.map(c => c.id).sort()).toEqual(["v1", "v2"]);
  });

  test("getById returns specific client", () => {
    const registry = new ClientRegistry();
    const c = makeClient("a");
    registry.register(c);
    expect(registry.getById("a")).toBe(c);
    expect(registry.getById("nope")).toBeUndefined();
  });

  test("duplicate id replaces previous client", () => {
    const registry = new ClientRegistry();
    const c1 = makeClient("a");
    const c2 = makeClient("a");
    registry.register(c1);
    registry.register(c2);
    expect(registry.count).toBe(1);
    expect(registry.getById("a")).toBe(c2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/client-registry.test.ts`
Expected: FAIL — cannot find module `../../src/server/client-registry.ts`

**Step 3: Write the implementation**

```typescript
// src/server/client-registry.ts
import type { ServerMessage } from "./protocol.ts";

export type SendFn = (msg: ServerMessage) => void;

export interface RegisteredClient {
  id: string;
  clientType: "chat" | "voice" | "tui";
  send: SendFn;
  capabilities: Set<string>;
}

export class ClientRegistry {
  private clients = new Map<string, RegisteredClient>();

  register(client: RegisteredClient): void {
    this.clients.set(client.id, client);
  }

  unregister(id: string): void {
    this.clients.delete(id);
  }

  getById(id: string): RegisteredClient | undefined {
    return this.clients.get(id);
  }

  getByType(type: string): RegisteredClient[] {
    return [...this.clients.values()].filter((c) => c.clientType === type);
  }

  broadcast(msg: ServerMessage, filter?: (c: RegisteredClient) => boolean): void {
    for (const client of this.clients.values()) {
      if (!filter || filter(client)) {
        try {
          client.send(msg);
        } catch {
          // Client may have disconnected — ignore send errors during broadcast
        }
      }
    }
  }

  get count(): number {
    return this.clients.size;
  }

  get all(): RegisteredClient[] {
    return [...this.clients.values()];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/client-registry.test.ts`
Expected: PASS — all 7 tests pass

**Step 5: Commit**

```bash
git add src/server/client-registry.ts tests/unit/client-registry.test.ts
git commit -m "feat(server): add ClientRegistry for multi-client tracking"
```

---

### Task 2: Update protocol with session:identify and session:ready

**Files:**
- Modify: `src/server/protocol.ts`
- Test: `tests/unit/server-protocol.test.ts` (if exists, else create)

**Step 1: Write the failing test**

```typescript
// tests/unit/server-protocol.test.ts
import { describe, test, expect } from "bun:test";
import { parseClientMessage } from "../../src/server/protocol.ts";

describe("parseClientMessage — voice messages", () => {
  test("parses session:identify", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "session:identify",
      id: "1",
      clientType: "voice",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session:identify");
  });

  test("session:identify requires clientType", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "session:identify",
      id: "1",
    }));
    expect(msg).toBeNull();
  });

  test("parses voice:start", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:start",
      id: "1",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("voice:start");
  });

  test("parses voice:stop", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:stop",
      id: "1",
    }));
    expect(msg).not.toBeNull();
  });

  test("parses voice:mode", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:mode",
      id: "1",
      mode: "whisper",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("voice:mode");
  });

  test("voice:mode requires mode field", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:mode",
      id: "1",
    }));
    expect(msg).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: FAIL — `session:identify` not in VALID_TYPES

**Step 3: Update protocol.ts**

Add new types to `ClientMessage` union in `src/server/protocol.ts` (after line 21):

```typescript
// Add to ClientMessage union:
| { type: "session:identify"; id: string; clientType: "chat" | "voice" | "tui" }
| { type: "voice:start"; id: string; voice?: string }
| { type: "voice:stop"; id: string }
| { type: "voice:mode"; id: string; mode: "on" | "whisper" }
```

Add to `ServerMessage` union (after line 57):

```typescript
// Add to ServerMessage union:
| { type: "session:ready"; requestId: string; provider: string; model: string; capabilities: string[] }
| { type: "voice:state"; state: "idle" | "listening" | "thinking" | "speaking" | "error" }
| { type: "voice:transcript"; role: "user" | "assistant"; delta: string; done: boolean }
| { type: "voice:audio"; delta: string }
| { type: "voice:started"; requestId: string }
| { type: "voice:stopped"; requestId: string }
| { type: "voice:error"; code: string; message: string }
| { type: "conversation:message"; role: "user" | "assistant"; content: string; source: "voice" | "chat" | "tui" }
```

Add to `VALID_TYPES` set:

```typescript
"session:identify",
"voice:start",
"voice:stop",
"voice:mode",
```

Add to `REQUIRED_FIELDS`:

```typescript
"session:identify": ["id", "clientType"],
"voice:start": ["id"],
"voice:stop": ["id"],
"voice:mode": ["id", "mode"],
```

Add field type validations for new fields:

```typescript
if ("clientType" in parsed && typeof parsed.clientType !== "string") return null;
if ("mode" in parsed && typeof parsed.mode !== "string") return null;
if ("voice" in parsed && parsed.voice !== undefined && typeof parsed.voice !== "string") return null;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All existing tests still pass (protocol changes are additive)

**Step 6: Commit**

```bash
git add src/server/protocol.ts tests/unit/server-protocol.test.ts
git commit -m "feat(protocol): add session:identify and voice message types"
```

---

### Task 3: Refactor server to singleton runtime

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/handler.ts`
- Modify: `src/cli/commands/serve.ts`

**Step 1: Modify `src/server/index.ts`**

The key change: boot one runtime before starting the HTTP server, and share it across all connections.

Replace the current `createFridayServer` function. The new version:

```typescript
// src/server/index.ts
import { resolve } from "node:path";
import { FridayRuntime, type RuntimeConfig } from "../core/runtime.ts";
import { WebSocketHandler, type SendFn } from "./handler.ts";
import { ClientRegistry, type RegisteredClient } from "./client-registry.ts";
import type { ServerMessage } from "./protocol.ts";
import type { ServerWebSocket } from "bun";

export interface FridayServerConfig {
  port: number;
  staticDir?: string;
  runtimeConfig?: Partial<RuntimeConfig>;
}

interface WSData {
  clientId: string;
  handler: WebSocketHandler;
  pushInterval?: ReturnType<typeof setInterval>;
}

const MAX_CONNECTIONS = 10;

export async function createFridayServer(config: FridayServerConfig) {
  const staticDir = config.staticDir ?? resolve("web/dist");
  const allowedOrigins = new Set([
    `http://localhost:${config.port}`,
    "http://localhost:5173",
    `http://127.0.0.1:${config.port}`,
    "http://127.0.0.1:5173",
  ]);

  // Boot singleton runtime BEFORE starting the server
  const runtime = new FridayRuntime();
  await runtime.boot({
    ...config.runtimeConfig,
  });

  const registry = new ClientRegistry();

  const server = Bun.serve<WSData>({
    port: config.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const origin = req.headers.get("origin");
        if (origin && !allowedOrigins.has(origin)) {
          return new Response("Forbidden: invalid origin", { status: 403 });
        }

        if (registry.count >= MAX_CONNECTIONS) {
          return new Response("Service Unavailable: connection limit reached", { status: 503 });
        }

        const clientId = crypto.randomUUID();
        const handler = new WebSocketHandler(runtime, registry, clientId);
        const upgraded = server.upgrade(req, {
          data: { clientId, handler },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Static file serving (SPA) — guard against path traversal
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const resolvedPath = resolve(staticDir, `.${filePath}`);
      if (!resolvedPath.startsWith(`${staticDir}/`)) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(resolvedPath);
      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback
      const index = Bun.file(resolve(staticDir, "index.html"));
      if (await index.exists()) {
        return new Response(index);
      }

      return new Response(
        "<html><body><h1>Friday Web UI</h1><p>Run <code>cd web && bun run build</code> first.</p></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        // Client registered when they send session:identify
      },
      async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
        if (message instanceof Buffer) {
          // Binary frame = audio data from voice client
          ws.data.handler.handleAudio(message);
          return;
        }

        const raw = typeof message === "string" ? message : message.toString();
        const send: SendFn = (msg: ServerMessage) => {
          try {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify(msg));
            }
          } catch { /* connection may have closed */ }
        };
        await ws.data.handler.handle(raw, send);

        // Set up Sensorium push after identify
        if (
          runtime.isBooted &&
          runtime.sensorium &&
          !ws.data.pushInterval &&
          registry.getById(ws.data.clientId)
        ) {
          ws.data.pushInterval = setInterval(() => {
            try {
              if (ws.readyState === 1) {
                ws.data.handler.pushSensoriumUpdate(
                  (msg: ServerMessage) => {
                    ws.send(JSON.stringify(msg));
                  },
                );
              }
            } catch {
              // Connection may have closed
            }
          }, 5000);
        }
      },
      close(ws: ServerWebSocket<WSData>) {
        if (ws.data.pushInterval) {
          clearInterval(ws.data.pushInterval);
        }
        registry.unregister(ws.data.clientId);
        // Do NOT shutdown runtime — it's shared!
      },
    },
  });

  return { server, runtime, registry };
}
```

**Step 2: Refactor `src/server/handler.ts`**

The handler no longer boots/shuts down the runtime. It receives the shared runtime and registry.

Key changes:
- Constructor takes `runtime`, `registry`, and `clientId` (not `bootConfigDefaults`)
- Remove `handleBoot()` and `handleShutdown()` — replaced by `handleIdentify()`
- `session:boot` becomes a no-op or error since runtime is pre-booted
- `session:identify` registers the client in the registry and responds with `session:ready`
- Add `handleAudio()` method for binary frames (stub for now, Phase 4 implements)

```typescript
// src/server/handler.ts
import { FridayRuntime } from "../core/runtime.ts";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.ts";
import { ClientRegistry, type RegisteredClient } from "./client-registry.ts";
import { WebSocketNotificationChannel } from "./ws-channel.ts";

export type SendFn = (msg: ServerMessage) => void;

export class WebSocketHandler {
  private runtime: FridayRuntime;
  private registry: ClientRegistry;
  private clientId: string;
  private defaultSend?: SendFn;

  constructor(runtime: FridayRuntime, registry: ClientRegistry, clientId: string) {
    this.runtime = runtime;
    this.registry = registry;
    this.clientId = clientId;
  }

  async handle(raw: string, send: SendFn): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) {
      send({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Failed to parse message",
      });
      return;
    }

    try {
      switch (msg.type) {
        case "session:identify":
          this.handleIdentify(msg, send);
          return;
        case "session:boot":
          // Runtime is already booted (singleton). Respond with ready.
          this.handleLegacyBoot(msg, send);
          return;
        case "session:shutdown":
          // Don't actually shut down the singleton. Just acknowledge.
          send({ type: "session:closed", requestId: msg.id });
          return;
        default:
          await this.handleRuntimeMessage(msg, send);
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({
        type: "error",
        requestId: msg.id,
        code: "INTERNAL_ERROR",
        message,
      });
    }
  }

  handleAudio(_audioData: Buffer): void {
    // Stub — Phase 4 implements VoiceBridge forwarding
  }

  pushSensoriumUpdate(send?: SendFn): void {
    const sensorium = this.runtime.sensorium;
    if (!sensorium?.currentSnapshot) return;
    const snapshot = sensorium.currentSnapshot;
    const target = send ?? this.defaultSend;
    if (target) {
      target({
        type: "sensorium:update",
        snapshot: {
          timestamp: snapshot.timestamp.toISOString(),
          cpu: snapshot.machine.cpus.usage,
          memory: {
            used: snapshot.machine.memory.used,
            total: snapshot.machine.memory.total,
            percent:
              snapshot.machine.memory.total > 0
                ? Math.round(
                    (snapshot.machine.memory.used /
                      snapshot.machine.memory.total) *
                      100,
                  )
                : 0,
          },
          containers: snapshot.containers,
          git: snapshot.dev.git,
          ports: snapshot.dev.ports,
        },
      });
    }
  }

  private handleIdentify(
    msg: Extract<ClientMessage, { type: "session:identify" }>,
    send: SendFn,
  ): void {
    const capabilities = new Set<string>(["text"]);
    if (msg.clientType === "voice") {
      capabilities.add("audio-in");
      capabilities.add("audio-out");
    }

    this.registry.register({
      id: this.clientId,
      clientType: msg.clientType,
      send,
      capabilities,
    });

    this.defaultSend = send;

    // Wire notification channel for this client
    if (this.runtime.notifications) {
      this.runtime.notifications.addChannel(
        new WebSocketNotificationChannel(send),
      );
    }

    send({
      type: "session:ready",
      requestId: msg.id,
      provider: this.runtime.cortex.providerName,
      model: this.runtime.cortex.modelName,
      capabilities: [...capabilities],
    });
  }

  private handleLegacyBoot(
    msg: Extract<ClientMessage, { type: "session:boot" }>,
    send: SendFn,
  ): void {
    // Singleton is already booted. Register client implicitly and respond.
    if (!this.registry.getById(this.clientId)) {
      this.registry.register({
        id: this.clientId,
        clientType: "chat",
        send,
        capabilities: new Set(["text"]),
      });
      this.defaultSend = send;
    }

    send({
      type: "session:booted",
      requestId: msg.id,
      provider: this.runtime.cortex.providerName,
      model: this.runtime.cortex.modelName,
      fastModel: this.runtime.fastModel,
    });
  }

  private async handleRuntimeMessage(
    msg: ClientMessage,
    send: SendFn,
  ): Promise<void> {
    if (!this.runtime.isBooted) {
      send({
        type: "error",
        requestId: msg.id,
        code: "NOT_BOOTED",
        message: "Runtime not booted. Send session:identify first.",
      });
      return;
    }

    switch (msg.type) {
      case "chat": {
        if (this.runtime.protocols.isProtocol(msg.content)) {
          const result = await this.runtime.process(msg.content);
          send({
            type: "chat:response",
            requestId: msg.id,
            content: result.output,
            source: result.source,
          });

          // Broadcast to other clients
          this.registry.broadcast(
            {
              type: "conversation:message",
              role: "user",
              content: msg.content,
              source: "chat",
            },
            (c) => c.id !== this.clientId,
          );
          break;
        }

        try {
          const stream = await this.runtime.cortex.chatStream(msg.content);

          // Broadcast user message to other clients
          this.registry.broadcast(
            {
              type: "conversation:message",
              role: "user",
              content: msg.content,
              source: "chat",
            },
            (c) => c.id !== this.clientId,
          );

          for await (const chunk of stream.textStream) {
            send({
              type: "chat:chunk",
              requestId: msg.id,
              text: chunk,
            });
          }
          const fullText = await stream.fullText;
          send({
            type: "chat:response",
            requestId: msg.id,
            content: fullText,
            source: "cortex",
          });

          // Broadcast assistant response to other clients
          this.registry.broadcast(
            {
              type: "conversation:message",
              role: "assistant",
              content: fullText,
              source: "chat",
            },
            (c) => c.id !== this.clientId,
          );
        } catch (streamErr) {
          const message =
            streamErr instanceof Error
              ? streamErr.message
              : String(streamErr);
          send({
            type: "error",
            requestId: msg.id,
            code: "STREAM_ERROR",
            message,
          });
        }
        break;
      }
      case "protocol": {
        const result = await this.runtime.process(msg.command);
        send({
          type: "protocol:response",
          requestId: msg.id,
          content: result.output,
          success: result.source === "protocol",
        });
        break;
      }
      case "voice:start": {
        // Phase 4 implements this
        send({
          type: "voice:error",
          code: "NOT_IMPLEMENTED",
          message: "Voice not yet implemented",
        });
        break;
      }
      case "voice:stop": {
        send({ type: "voice:stopped", requestId: msg.id });
        break;
      }
      case "voice:mode": {
        // Phase 4 implements this
        break;
      }
      case "history:list": {
        if (!this.runtime.memory) {
          send({ type: "error", requestId: msg.id, code: "NO_MEMORY", message: "Memory not configured" });
          return;
        }
        const sessions = await this.runtime.memory.getConversationHistory(msg.count ?? 20);
        send({ type: "history:result", requestId: msg.id, data: sessions });
        break;
      }
      case "history:load": {
        if (!this.runtime.memory) {
          send({ type: "error", requestId: msg.id, code: "NO_MEMORY", message: "Memory not configured" });
          return;
        }
        const session = await this.runtime.memory.getConversationById(msg.sessionId);
        send({ type: "history:result", requestId: msg.id, data: session });
        break;
      }
      case "smarts:list": {
        if (!this.runtime.smarts) {
          send({ type: "error", requestId: msg.id, code: "NO_SMARTS", message: "SMARTS not configured" });
          return;
        }
        const entries = this.runtime.smarts.all();
        send({ type: "smarts:result", requestId: msg.id, data: entries });
        break;
      }
      case "smarts:search": {
        if (!this.runtime.smarts) {
          send({ type: "error", requestId: msg.id, code: "NO_SMARTS", message: "SMARTS not configured" });
          return;
        }
        const results = await this.runtime.smarts.findRelevant(msg.query);
        send({ type: "smarts:result", requestId: msg.id, data: results });
        break;
      }
    }
  }
}
```

**Step 3: Update `src/cli/commands/serve.ts`**

The `createFridayServer` is now async (it boots the runtime). Update the serve command:

```typescript
// Key change in serve.ts action handler:
const { server } = await createFridayServer({
  port,
  staticDir: resolve(projectRoot, "web/dist"),
  runtimeConfig: {
    provider: options.provider as ProviderName,
    model: options.model,
    smartsDir: resolve(projectRoot, "smarts"),
    dataDir: resolve(projectRoot, "data"),
    modulesDir: resolve(projectRoot, "src/modules"),
    debug: globalOpts.debug,
  },
});
```

The shutdown handler should also shut down the singleton runtime:

```typescript
const shutdown = async () => {
  console.log(chalk.hex("#8B6914")("\nShutting down server..."));
  // Shutdown the singleton runtime
  if (result.runtime.isBooted) {
    await result.runtime.shutdown();
  }
  server.stop(true);
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
};
```

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass. Existing server tests may need updates if they relied on per-connection runtime boot.

**Step 5: Commit**

```bash
git add src/server/index.ts src/server/handler.ts src/cli/commands/serve.ts
git commit -m "feat(server): refactor to singleton runtime with client registry"
```

---

## Phase 2: Unix Socket IPC

### Task 4: RuntimeBridge interface and LocalBridge

**Files:**
- Create: `src/core/bridges/types.ts`
- Create: `src/core/bridges/local.ts`
- Test: `tests/unit/runtime-bridge.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/runtime-bridge.test.ts
import { describe, test, expect, mock } from "bun:test";
import { LocalBridge } from "../../src/core/bridges/local.ts";

describe("LocalBridge", () => {
  test("isBooted delegates to runtime", () => {
    const runtime = { isBooted: true } as any;
    const bridge = new LocalBridge(runtime);
    expect(bridge.isBooted()).toBe(true);
  });

  test("process delegates to runtime.process", async () => {
    const runtime = {
      isBooted: true,
      process: mock(async () => ({ output: "ok", source: "protocol" as const })),
    } as any;
    const bridge = new LocalBridge(runtime);
    const result = await bridge.process("/help");
    expect(result.output).toBe("ok");
    expect(runtime.process).toHaveBeenCalledWith("/help");
  });

  test("chat streams text from cortex", async () => {
    const chunks = ["Hello", " world"];
    const runtime = {
      isBooted: true,
      cortex: {
        chatStream: mock(async () => ({
          textStream: (async function* () {
            for (const c of chunks) yield c;
          })(),
          fullText: Promise.resolve("Hello world"),
        })),
      },
      protocols: { isProtocol: () => false },
    } as any;
    const bridge = new LocalBridge(runtime);
    const collected: string[] = [];
    for await (const chunk of bridge.chat("hi")) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["Hello", " world"]);
  });

  test("chat routes protocol input through runtime.process", async () => {
    const runtime = {
      isBooted: true,
      process: mock(async () => ({ output: "protocol output", source: "protocol" as const })),
      protocols: { isProtocol: (s: string) => s.startsWith("/") },
    } as any;
    const bridge = new LocalBridge(runtime);
    const collected: string[] = [];
    for await (const chunk of bridge.chat("/help")) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["protocol output"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime-bridge.test.ts`
Expected: FAIL — modules not found

**Step 3: Write the types and LocalBridge**

```typescript
// src/core/bridges/types.ts
export interface RuntimeBridge {
  /** Stream text chunks for a chat input. Protocol inputs yield a single chunk. */
  chat(content: string): AsyncIterable<string>;
  /** Process a protocol command directly. */
  process(input: string): Promise<{ output: string; source: string }>;
  /** Whether the backing runtime is booted and ready. */
  isBooted(): boolean;
  /** Request graceful shutdown. */
  shutdown(): Promise<void>;
}
```

```typescript
// src/core/bridges/local.ts
import type { RuntimeBridge } from "./types.ts";
import type { FridayRuntime } from "../runtime.ts";

export class LocalBridge implements RuntimeBridge {
  private runtime: FridayRuntime;

  constructor(runtime: FridayRuntime) {
    this.runtime = runtime;
  }

  async *chat(content: string): AsyncIterable<string> {
    if (this.runtime.protocols.isProtocol(content)) {
      const result = await this.runtime.process(content);
      yield result.output;
      return;
    }

    const stream = await this.runtime.cortex.chatStream(content);
    for await (const chunk of stream.textStream) {
      yield chunk;
    }
    // Ensure full text is awaited for history commit
    await stream.fullText;
  }

  async process(input: string): Promise<{ output: string; source: string }> {
    return this.runtime.process(input);
  }

  isBooted(): boolean {
    return this.runtime.isBooted;
  }

  async shutdown(): Promise<void> {
    if (this.runtime.isBooted) {
      await this.runtime.shutdown();
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime-bridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/bridges/types.ts src/core/bridges/local.ts tests/unit/runtime-bridge.test.ts
git commit -m "feat(bridges): add RuntimeBridge interface and LocalBridge"
```

---

### Task 5: Unix socket server

**Files:**
- Create: `src/server/socket.ts`
- Test: `tests/unit/socket-server.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/socket-server.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { FridaySocketServer } from "../../src/server/socket.ts";

const TEST_SOCKET = "/tmp/friday-test.sock";
const TEST_PID = "/tmp/friday-test.pid";

afterEach(async () => {
  try { await unlink(TEST_SOCKET); } catch {}
  try { await unlink(TEST_PID); } catch {}
});

describe("FridaySocketServer", () => {
  test("creates socket file on start", async () => {
    const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
    const server = new FridaySocketServer(mockRuntime, TEST_SOCKET, TEST_PID);
    await server.start();

    const socketFile = Bun.file(TEST_SOCKET);
    // Socket files don't have a normal "exists" check via Bun.file,
    // but the PID file should exist
    const pidFile = Bun.file(TEST_PID);
    expect(await pidFile.exists()).toBe(true);
    const pid = await pidFile.text();
    expect(Number.parseInt(pid, 10)).toBe(process.pid);

    await server.stop();
  });

  test("cleans up on stop", async () => {
    const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
    const server = new FridaySocketServer(mockRuntime, TEST_SOCKET, TEST_PID);
    await server.start();
    await server.stop();

    const pidFile = Bun.file(TEST_PID);
    expect(await pidFile.exists()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the socket server**

```typescript
// src/server/socket.ts
import { unlink, writeFile } from "node:fs/promises";
import type { FridayRuntime } from "../core/runtime.ts";
import { parseClientMessage, type ServerMessage } from "./protocol.ts";

const DEFAULT_SOCKET_PATH = `${process.env.HOME}/.friday/friday.sock`;
const DEFAULT_PID_PATH = `${process.env.HOME}/.friday/friday.pid`;

export class FridaySocketServer {
  private runtime: FridayRuntime;
  private socketPath: string;
  private pidPath: string;
  private server: ReturnType<typeof Bun.listen> | null = null;

  constructor(
    runtime: FridayRuntime,
    socketPath = DEFAULT_SOCKET_PATH,
    pidPath = DEFAULT_PID_PATH,
  ) {
    this.runtime = runtime;
    this.socketPath = socketPath;
    this.pidPath = pidPath;
  }

  async start(): Promise<void> {
    // Clean up stale socket
    try { await unlink(this.socketPath); } catch {}

    // Write PID file
    await writeFile(this.pidPath, String(process.pid));

    // Start Unix socket server
    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: (_socket) => {
          // New IPC client connected
        },
        data: (socket, data) => {
          // Newline-delimited JSON protocol
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            const msg = parseClientMessage(line);
            if (!msg) continue;

            const send = (response: ServerMessage) => {
              socket.write(JSON.stringify(response) + "\n");
            };

            // Route through simplified handler
            void this.handleMessage(msg, send);
          }
        },
        close: (_socket) => {
          // IPC client disconnected
        },
        error: (_socket, _error) => {
          // IPC error — log but don't crash
        },
      },
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    try { await unlink(this.socketPath); } catch {}
    try { await unlink(this.pidPath); } catch {}
  }

  private async handleMessage(
    msg: ReturnType<typeof parseClientMessage> & {},
    send: (msg: ServerMessage) => void,
  ): Promise<void> {
    switch (msg.type) {
      case "session:identify":
      case "session:boot": {
        send({
          type: "session:ready",
          requestId: msg.id,
          provider: this.runtime.cortex.providerName,
          model: this.runtime.cortex.modelName,
          capabilities: ["text"],
        });
        break;
      }
      case "chat": {
        if (this.runtime.protocols.isProtocol(msg.content)) {
          const result = await this.runtime.process(msg.content);
          send({
            type: "chat:response",
            requestId: msg.id,
            content: result.output,
            source: result.source,
          });
          break;
        }

        try {
          const stream = await this.runtime.cortex.chatStream(msg.content);
          for await (const chunk of stream.textStream) {
            send({ type: "chat:chunk", requestId: msg.id, text: chunk });
          }
          const fullText = await stream.fullText;
          send({
            type: "chat:response",
            requestId: msg.id,
            content: fullText,
            source: "cortex",
          });
        } catch (err) {
          send({
            type: "error",
            requestId: msg.id,
            code: "STREAM_ERROR",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case "protocol": {
        const result = await this.runtime.process(msg.command);
        send({
          type: "protocol:response",
          requestId: msg.id,
          content: result.output,
          success: result.source === "protocol",
        });
        break;
      }
      case "session:shutdown": {
        send({ type: "session:closed", requestId: msg.id });
        break;
      }
    }
  }
}

/** Check if a singleton runtime is available via socket. */
export async function checkSingletonSocket(
  socketPath = DEFAULT_SOCKET_PATH,
  pidPath = DEFAULT_PID_PATH,
): Promise<boolean> {
  try {
    const pidText = await Bun.file(pidPath).text();
    const pid = Number.parseInt(pidText, 10);
    // Check if process is alive
    process.kill(pid, 0);
    return true;
  } catch {
    // PID file doesn't exist or process is dead — clean up stale socket
    try { await unlink(socketPath); } catch {}
    try { await unlink(pidPath); } catch {}
    return false;
  }
}

export { DEFAULT_SOCKET_PATH, DEFAULT_PID_PATH };
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/socket.ts tests/unit/socket-server.test.ts
git commit -m "feat(server): add Unix domain socket server for IPC"
```

---

### Task 6: SocketBridge client

**Files:**
- Create: `src/core/bridges/socket.ts`
- Test: `tests/unit/socket-bridge.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/socket-bridge.test.ts
import { describe, test, expect } from "bun:test";
import { SocketBridge } from "../../src/core/bridges/socket.ts";

describe("SocketBridge", () => {
  test("isBooted returns false when not connected", () => {
    const bridge = new SocketBridge("/tmp/nonexistent.sock");
    expect(bridge.isBooted()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: FAIL — module not found

**Step 3: Implement SocketBridge**

```typescript
// src/core/bridges/socket.ts
import { connect, type Socket } from "node:net";
import type { RuntimeBridge } from "./types.ts";
import type { ClientMessage, ServerMessage } from "../../server/protocol.ts";

export class SocketBridge implements RuntimeBridge {
  private socketPath: string;
  private socket: Socket | null = null;
  private connected = false;
  private pendingCallbacks = new Map<string, {
    onChunk?: (text: string) => void;
    onComplete: (msg: ServerMessage) => void;
    onError: (err: Error) => void;
  }>();
  private buffer = "";

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ path: this.socketPath }, () => {
        this.socket = socket;
        this.connected = true;
        resolve();
      });

      socket.on("data", (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as ServerMessage;
            this.handleServerMessage(msg);
          } catch {
            // Ignore malformed lines
          }
        }
      });

      socket.on("error", (err) => {
        this.connected = false;
        reject(err);
      });

      socket.on("close", () => {
        this.connected = false;
        this.socket = null;
      });
    });
  }

  async *chat(content: string): AsyncIterable<string> {
    const requestId = crypto.randomUUID();
    const chunks: string[] = [];
    let done = false;
    let error: Error | null = null;
    let resolveWait: (() => void) | null = null;

    this.pendingCallbacks.set(requestId, {
      onChunk: (text) => {
        chunks.push(text);
        resolveWait?.();
      },
      onComplete: () => {
        done = true;
        resolveWait?.();
      },
      onError: (err) => {
        error = err;
        done = true;
        resolveWait?.();
      },
    });

    this.send({ type: "chat", id: requestId, content });

    while (!done) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise<void>((r) => { resolveWait = r; });
      }
    }

    // Drain remaining chunks
    while (chunks.length > 0) {
      yield chunks.shift()!;
    }

    this.pendingCallbacks.delete(requestId);
    if (error) throw error;
  }

  async process(input: string): Promise<{ output: string; source: string }> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(requestId, {
        onComplete: (msg) => {
          this.pendingCallbacks.delete(requestId);
          if (msg.type === "chat:response") {
            resolve({ output: msg.content, source: msg.source });
          } else if (msg.type === "protocol:response") {
            resolve({ output: msg.content, source: msg.success ? "protocol" : "unknown" });
          } else {
            resolve({ output: "", source: "unknown" });
          }
        },
        onError: (err) => {
          this.pendingCallbacks.delete(requestId);
          reject(err);
        },
      });

      this.send({ type: "protocol", id: requestId, command: input });
    });
  }

  isBooted(): boolean {
    return this.connected;
  }

  async shutdown(): Promise<void> {
    if (this.socket) {
      const requestId = crypto.randomUUID();
      this.send({ type: "session:shutdown", id: requestId });
      this.socket.end();
      this.socket = null;
      this.connected = false;
    }
  }

  private send(msg: ClientMessage): void {
    if (!this.socket || !this.connected) {
      throw new Error("Not connected to singleton runtime");
    }
    this.socket.write(JSON.stringify(msg) + "\n");
  }

  private handleServerMessage(msg: ServerMessage): void {
    const requestId = "requestId" in msg ? (msg as any).requestId : undefined;
    if (!requestId) return;

    const callbacks = this.pendingCallbacks.get(requestId);
    if (!callbacks) return;

    switch (msg.type) {
      case "chat:chunk":
        callbacks.onChunk?.(msg.text);
        break;
      case "chat:response":
      case "protocol:response":
      case "session:ready":
      case "session:booted":
      case "session:closed":
        callbacks.onComplete(msg);
        break;
      case "error":
        callbacks.onError(new Error(msg.message));
        break;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/bridges/socket.ts tests/unit/socket-bridge.test.ts
git commit -m "feat(bridges): add SocketBridge for IPC client"
```

---

### Task 7: Update `friday chat` to detect singleton

**Files:**
- Modify: `src/cli/commands/chat.ts`
- Modify: `src/cli/tui/app.tsx`

**Step 1: Update chat.ts to detect socket and pass bridge mode**

```typescript
// src/cli/commands/chat.ts — add socket detection
import { checkSingletonSocket, DEFAULT_SOCKET_PATH } from "../../server/socket.ts";

// Inside the action handler, before launchTui:
const singletonAvailable = await checkSingletonSocket();
await launchTui({
  provider: options.provider,
  model: options.model,
  fastModel: options.fastModel,
  fresh: options.fresh,
  debug: globalOpts.debug,
  socketPath: singletonAvailable ? DEFAULT_SOCKET_PATH : undefined,
});
```

**Step 2: Update launchTui and FridayApp to accept bridge mode**

In `src/cli/tui/app.tsx`, the `FridayApp` component needs to:
- Accept an optional `socketPath` in options
- If `socketPath` is provided, create `SocketBridge` and connect instead of booting a standalone `FridayRuntime`
- If `socketPath` is not provided, create `FridayRuntime` + `LocalBridge` (current behavior)
- Use the `RuntimeBridge` interface for chat/process instead of calling runtime directly

This is a significant refactor of the boot `useEffect` in `app.tsx` (lines 113-210). The key abstraction: replace all `runtime.cortex.chatStream()` and `runtime.process()` calls with `bridge.chat()` and `bridge.process()`.

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Manual integration test**

1. Start `friday serve` in one terminal
2. Open another terminal, run `friday chat`
3. Verify chat connects to singleton (log message: "Connected to Friday runtime")
4. Send a message from the TUI, verify it processes through the shared Cortex

**Step 5: Commit**

```bash
git add src/cli/commands/chat.ts src/cli/tui/app.tsx
git commit -m "feat(chat): detect singleton runtime and connect via Unix socket"
```

---

### Task 8: Wire socket server into `friday serve`

**Files:**
- Modify: `src/cli/commands/serve.ts`
- Modify: `src/server/index.ts`

**Step 1: Update serve.ts to start socket server**

After `createFridayServer()` returns, start the socket server:

```typescript
import { FridaySocketServer } from "../../server/socket.ts";

// After server creation:
const socketServer = new FridaySocketServer(result.runtime);
await socketServer.start();
console.log(chalk.hex("#8B6914")(`IPC socket: ~/.friday/friday.sock`));

// In shutdown handler, stop socket server:
await socketServer.stop();
```

**Step 2: Ensure `~/.friday/` directory exists**

Add a mkdir guard before starting the socket server:

```typescript
import { mkdir } from "node:fs/promises";
await mkdir(`${process.env.HOME}/.friday`, { recursive: true });
```

**Step 3: Manual test**

1. Run `friday serve`
2. Verify `~/.friday/friday.sock` and `~/.friday/friday.pid` are created
3. Open new terminal, run `friday chat`
4. Verify it connects to the singleton
5. Kill `friday serve`, verify socket/pid files are cleaned up

**Step 4: Commit**

```bash
git add src/cli/commands/serve.ts
git commit -m "feat(serve): start Unix socket server for IPC"
```

---

## Phase 3: ttyd Integration

### Task 9: ttyd spawner

**Files:**
- Create: `src/server/ttyd.ts`
- Modify: `src/cli/commands/serve.ts`

**Step 1: Create ttyd spawner utility**

```typescript
// src/server/ttyd.ts
import { spawn, type Subprocess } from "bun";
import { which } from "bun";

export interface TtydConfig {
  port: number;
  basePath: string;
  command: string[];
  theme?: Record<string, string>;
  fontSize?: number;
}

const DEFAULT_THEME = {
  background: "#0D1117",
  foreground: "#F0E6D8",
  cursor: "#E8943A",
};

export async function spawnTtyd(config: TtydConfig): Promise<Subprocess | null> {
  // Check if ttyd is installed
  const ttydPath = which("ttyd");
  if (!ttydPath) {
    console.warn("ttyd not found. Install ttyd for terminal-in-browser support.");
    console.warn("  macOS: brew install ttyd");
    console.warn("  Linux: apt install ttyd");
    return null;
  }

  const theme = config.theme ?? DEFAULT_THEME;
  const fontSize = config.fontSize ?? 14;

  const args = [
    "--port", String(config.port),
    "--writable",
    "--base-path", config.basePath,
    "-t", `titleFixed=F.R.I.D.A.Y.`,
    "-t", `theme=${JSON.stringify(theme)}`,
    "-t", `fontSize=${fontSize}`,
    "-t", "disableLeaveAlert=true",
    ...config.command,
  ];

  const proc = spawn(["ttyd", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  return proc;
}
```

**Step 2: Wire into serve.ts**

```typescript
import { spawnTtyd } from "../../server/ttyd.ts";

// After socket server starts:
const ttydProc = await spawnTtyd({
  port: 7681,
  basePath: "/terminal",
  command: ["friday", "chat"],
});

if (ttydProc) {
  console.log(chalk.hex("#8B6914")(`Terminal: http://localhost:7681/terminal/`));
}

// In shutdown handler:
if (ttydProc) {
  ttydProc.kill();
}
```

**Step 3: Commit**

```bash
git add src/server/ttyd.ts src/cli/commands/serve.ts
git commit -m "feat(serve): spawn ttyd for terminal-in-browser"
```

---

### Task 10: TerminalEmbed component and web app restructure

**Files:**
- Create: `web/src/components/terminal/TerminalEmbed.tsx`
- Modify: `web/src/App.tsx`
- Delete: `web/src/components/chat/` (all 5 files)
- Delete: `web/src/components/layout/` (all 4 files)
- Delete: `web/src/contexts/ChatContext.tsx`
- Delete: `web/src/hooks/useChat.ts`
- Delete: `web/src/components/AutoBoot.tsx`

**Step 1: Create TerminalEmbed component**

```tsx
// web/src/components/terminal/TerminalEmbed.tsx
export function TerminalEmbed({ src }: { src: string }) {
  return (
    <iframe
      src={src}
      className="w-full h-full border-none bg-[#0D1117]"
      title="Friday Terminal"
      allow="clipboard-read; clipboard-write"
    />
  );
}
```

**Step 2: Update App.tsx**

```tsx
// web/src/App.tsx
import { VoiceMode } from "./components/voice/index.ts";
import { TerminalEmbed } from "./components/terminal/TerminalEmbed.tsx";

const mode = new URLSearchParams(window.location.search).get("mode");

// ttyd URL — same host, port 7681, base path /terminal/
const TTYD_URL = `${window.location.protocol}//${window.location.hostname}:7681/terminal/`;

export function App() {
  if (mode === "voice") {
    return <VoiceMode />;
  }

  return <TerminalEmbed src={TTYD_URL} />;
}
```

**Step 3: Delete web chat files**

```bash
rm -rf web/src/components/chat/
rm -rf web/src/components/layout/
rm web/src/contexts/ChatContext.tsx
rm web/src/hooks/useChat.ts
rm web/src/components/AutoBoot.tsx
```

**Step 4: Remove unused imports/hooks that only the chat UI used**

Check if `useSession.ts`, `useSensorium.ts`, `useHistory.ts`, `useSmarts.ts`, `useNotifications.ts` are only used by the chat UI. If so, remove them too. The voice mode will have its own session management. Keep `useWebSocket.ts` — the voice mode will use it.

Also remove `web/src/contexts/SessionContext.tsx` if only used by chat.

**Step 5: Verify the web app builds**

Run: `cd web && bun run build`
Expected: Build succeeds with no import errors

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): replace chat UI with ttyd terminal embed, add voice routing"
```

---

## Phase 4: VoiceBridge Backend

### Task 11: VoiceBridge class

**Files:**
- Create: `src/core/voice/bridge.ts`
- Test: `tests/unit/voice-bridge.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/voice-bridge.test.ts
import { describe, test, expect, mock } from "bun:test";
import { VoiceBridge, type VoiceBridgeConfig, type VoiceBridgeCallbacks } from "../../src/core/voice/bridge.ts";

function makeMockCallbacks(): VoiceBridgeCallbacks {
  return {
    onAudioDelta: mock(() => {}),
    onTranscriptDelta: mock(() => {}),
    onStateChange: mock(() => {}),
    onUserTranscript: mock(() => {}),
  };
}

describe("VoiceBridge", () => {
  test("constructs without error", () => {
    const cortex = {} as any;
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test instructions",
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);
    expect(bridge).toBeDefined();
    expect(bridge.isActive).toBe(false);
  });

  test("sendToGrokTts formats messages correctly", () => {
    const cortex = {} as any;
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    // Access internal method via any cast for testing message format
    const messages: string[] = [];
    (bridge as any).grokWs = {
      send: (data: string) => messages.push(data),
      readyState: 1,
    };

    (bridge as any).sendToGrokTts("Hello world");

    expect(messages).toHaveLength(2);
    const item = JSON.parse(messages[0]);
    expect(item.type).toBe("conversation.item.create");
    expect(item.item.content[0].text).toBe("Hello world");

    const response = JSON.parse(messages[1]);
    expect(response.type).toBe("response.create");
    expect(response.response.modalities).toEqual(["audio"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: FAIL — module not found

**Step 3: Implement VoiceBridge**

```typescript
// src/core/voice/bridge.ts
import type { Cortex } from "../cortex.ts";
import type { GrokVoice } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceBridgeConfig {
  voice: GrokVoice;
  sampleRate: number;
  instructions: string;
}

export interface VoiceBridgeCallbacks {
  onAudioDelta: (base64: string) => void;
  onTranscriptDelta: (text: string, done: boolean) => void;
  onStateChange: (state: VoiceState) => void;
  onUserTranscript: (text: string) => void;
}

const WS_URL = "wss://api.x.ai/v1/realtime";

export class VoiceBridge {
  private grokWs: WebSocket | null = null;
  private cortex: Cortex;
  private config: VoiceBridgeConfig;
  private callbacks: VoiceBridgeCallbacks;
  private active = false;
  private userTranscriptBuffer = "";

  constructor(
    cortex: Cortex,
    config: VoiceBridgeConfig,
    callbacks: VoiceBridgeCallbacks,
  ) {
    this.cortex = cortex;
    this.config = config;
    this.callbacks = callbacks;
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) throw new Error("Voice session already active");

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error("XAI_API_KEY not set");

    this.active = true;
    this.callbacks.onStateChange("idle");

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      } as any);

      const timeout = setTimeout(() => {
        reject(new Error("Grok voice connection timeout"));
        try { ws.close(); } catch {}
      }, 10000);

      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        this.grokWs = ws;

        // Configure session for full-duplex voice
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            voice: this.config.voice,
            instructions: this.config.instructions,
            turn_detection: { type: "server_vad" },
            audio: {
              input: {
                format: { type: "audio/pcm", rate: this.config.sampleRate },
              },
              output: {
                format: { type: "audio/pcm", rate: this.config.sampleRate },
              },
            },
          },
        }));

        this.callbacks.onStateChange("idle");
        resolve();
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          void this.handleGrokMessage(event.data);
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        this.active = false;
        this.callbacks.onStateChange("error");
        reject(new Error("Grok voice connection error"));
      });

      ws.addEventListener("close", () => {
        this.grokWs = null;
        if (this.active) {
          this.active = false;
          this.callbacks.onStateChange("idle");
        }
      });
    });
  }

  appendAudio(pcmBase64: string): void {
    if (!this.grokWs || !this.active) return;
    this.grokWs.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcmBase64,
    }));
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.grokWs) {
      try { this.grokWs.close(); } catch {}
      this.grokWs = null;
    }
    this.callbacks.onStateChange("idle");
  }

  private async handleGrokMessage(raw: string): Promise<void> {
    let data: Record<string, any>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      // VAD detected speech start
      case "input_audio_buffer.speech_started": {
        this.callbacks.onStateChange("listening");
        this.userTranscriptBuffer = "";
        break;
      }

      // VAD detected speech end — audio committed for transcription
      case "input_audio_buffer.speech_stopped": {
        this.callbacks.onStateChange("thinking");
        break;
      }

      // Grok transcribed the user's speech
      case "conversation.item.created": {
        if (data.item?.role === "user" && data.item?.content) {
          const textContent = data.item.content.find(
            (c: any) => c.type === "input_text" || c.type === "text",
          );
          if (textContent?.text || textContent?.transcript) {
            const transcript = textContent.text ?? textContent.transcript;
            this.userTranscriptBuffer = transcript;
            this.callbacks.onUserTranscript(transcript);

            // Route through Cortex for reasoning
            await this.processThroughCortex(transcript);
          }
        }
        break;
      }

      // We also handle the transcription completion event
      case "input_audio_buffer.committed": {
        // Transcription is in progress — state remains "thinking"
        break;
      }

      // TTS audio chunk from Grok
      case "response.output_audio.delta": {
        if (data.delta) {
          this.callbacks.onStateChange("speaking");
          this.callbacks.onAudioDelta(data.delta);
        }
        break;
      }

      // TTS transcript chunk
      case "response.output_audio_transcript.delta": {
        if (data.delta) {
          this.callbacks.onTranscriptDelta(data.delta, false);
        }
        break;
      }

      // TTS transcript complete
      case "response.output_audio_transcript.done": {
        this.callbacks.onTranscriptDelta("", true);
        break;
      }

      // Response complete (audio done)
      case "response.done": {
        this.callbacks.onStateChange("idle");
        break;
      }

      // Error from Grok
      case "error": {
        this.callbacks.onStateChange("error");
        break;
      }
    }
  }

  private async processThroughCortex(transcript: string): Promise<void> {
    try {
      this.callbacks.onStateChange("thinking");

      // Get Cortex response (with full tool access, SMARTS, recall)
      const stream = await this.cortex.chatStream(transcript);
      const fullText = await stream.fullText;

      if (!fullText.trim() || !this.active) return;

      // Send Cortex's response to Grok for TTS
      this.sendToGrokTts(fullText);
    } catch (err) {
      this.callbacks.onStateChange("error");
    }
  }

  private sendToGrokTts(text: string): void {
    if (!this.grokWs || this.grokWs.readyState !== 1) return;

    // Build TTS prompt for this utterance
    const prompt = buildTtsPrompt(text, "on");

    // Update instructions for TTS
    this.grokWs.send(JSON.stringify({
      type: "session.update",
      session: { instructions: prompt },
    }));

    // Send the text to speak
    this.grokWs.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }));

    // Request audio response
    this.grokWs.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio"] },
    }));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/voice/bridge.ts tests/unit/voice-bridge.test.ts
git commit -m "feat(voice): add VoiceBridge for full-duplex Cortex-mediated voice"
```

---

### Task 12: Wire VoiceBridge into WebSocketHandler

**Files:**
- Modify: `src/server/handler.ts`

**Step 1: Update handler to manage VoiceBridge lifecycle**

Add VoiceBridge import and management to the handler:

```typescript
// In handler.ts, add:
import { VoiceBridge, type VoiceBridgeConfig } from "../core/voice/bridge.ts";
import { FRIDAY_VOICE_IDENTITY } from "../core/voice/prompt.ts";
import type { GrokVoice } from "../core/voice/types.ts";

// In the class:
private voiceBridge: VoiceBridge | null = null;

// Implement voice:start handler:
case "voice:start": {
  if (this.voiceBridge?.isActive) {
    send({ type: "voice:error", code: "SESSION_IN_USE", message: "Voice session already active" });
    break;
  }

  const voiceConfig: VoiceBridgeConfig = {
    voice: ((msg as any).voice ?? "Eve") as GrokVoice,
    sampleRate: 48000,
    instructions: FRIDAY_VOICE_IDENTITY,
  };

  this.voiceBridge = new VoiceBridge(this.runtime.cortex, voiceConfig, {
    onAudioDelta: (base64) => send({ type: "voice:audio", delta: base64 }),
    onTranscriptDelta: (delta, done) => send({
      type: "voice:transcript",
      role: "assistant",
      delta,
      done,
    }),
    onStateChange: (state) => send({ type: "voice:state", state }),
    onUserTranscript: (text) => {
      send({ type: "voice:transcript", role: "user", delta: text, done: true });
      // Broadcast to other clients
      this.registry.broadcast(
        { type: "conversation:message", role: "user", content: text, source: "voice" },
        (c) => c.id !== this.clientId,
      );
    },
  });

  try {
    await this.voiceBridge.start();
    send({ type: "voice:started", requestId: msg.id });
  } catch (err) {
    send({
      type: "voice:error",
      code: "START_FAILED",
      message: err instanceof Error ? err.message : "Failed to start voice",
    });
  }
  break;
}

// Implement voice:stop:
case "voice:stop": {
  if (this.voiceBridge) {
    await this.voiceBridge.stop();
    this.voiceBridge = null;
  }
  send({ type: "voice:stopped", requestId: msg.id });
  break;
}

// Implement handleAudio:
handleAudio(audioData: Buffer): void {
  if (!this.voiceBridge?.isActive) return;
  // Convert binary PCM to base64 for Grok
  const base64 = audioData.toString("base64");
  this.voiceBridge.appendAudio(base64);
}
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/server/handler.ts
git commit -m "feat(handler): wire VoiceBridge for voice:start/stop/audio"
```

---

## Phase 5: Browser Audio Pipeline

### Task 13: AudioWorklet processor

**Files:**
- Create: `web/src/audio/pcm-worklet.ts`
- Create: `web/public/pcm-worklet.js` (compiled worklet for browser)

**Step 1: Create the AudioWorklet processor**

AudioWorklets must be loaded from a separate JS file. Create both the TypeScript source and a plain JS version for the browser:

```javascript
// web/public/pcm-worklet.js
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._volume = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Calculate RMS volume for mic level indicator
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    this._volume = Math.sqrt(sum / input.length);

    // Convert Float32 → Int16 PCM little-endian
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Post PCM buffer and volume level to main thread
    this.port.postMessage(
      { pcm: pcm.buffer, volume: this._volume },
      [pcm.buffer],
    );

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
```

**Step 2: Commit**

```bash
git add web/public/pcm-worklet.js
git commit -m "feat(audio): add AudioWorklet PCM capture processor"
```

---

### Task 14: useVoiceAudio hook

**Files:**
- Create: `web/src/hooks/useVoiceAudio.ts`

**Step 1: Implement the hook**

```typescript
// web/src/hooks/useVoiceAudio.ts
import { useState, useRef, useCallback } from "react";

export interface UseVoiceAudioReturn {
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  isCapturing: boolean;
  micLevel: number;
  playAudio: (pcmBase64: string) => void;
  stopPlayback: () => void;
}

export function useVoiceAudio(
  onAudioChunk: (pcmBuffer: ArrayBuffer) => void,
): UseVoiceAudioReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Playback state
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = audioCtx;

    await audioCtx.audioWorklet.addModule("/pcm-worklet.js");

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const worklet = new AudioWorkletNode(audioCtx, "pcm-capture");
    workletRef.current = worklet;

    worklet.port.onmessage = (event) => {
      const { pcm, volume } = event.data;
      setMicLevel(volume);
      onAudioChunk(pcm);
    };

    source.connect(worklet);
    // Don't connect worklet to destination — we don't want to hear our own mic
    setIsCapturing(true);
  }, [isCapturing, onAudioChunk]);

  const stopCapture = useCallback(() => {
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    workletRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;

    setIsCapturing(false);
    setMicLevel(0);
  }, []);

  const playAudio = useCallback((pcmBase64: string) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 48000 });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }

    const ctx = playbackCtxRef.current;
    const raw = atob(pcmBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }

    // Decode Int16 LE PCM to Float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 48000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Schedule for gapless playback
    const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close();
      playbackCtxRef.current = null;
      nextPlayTimeRef.current = 0;
    }
  }, []);

  return {
    startCapture,
    stopCapture,
    isCapturing,
    micLevel,
    playAudio,
    stopPlayback,
  };
}
```

**Step 2: Commit**

```bash
git add web/src/hooks/useVoiceAudio.ts
git commit -m "feat(audio): add useVoiceAudio hook for mic capture and playback"
```

---

### Task 15: useVoiceSession hook

**Files:**
- Create: `web/src/hooks/useVoiceSession.ts`

**Step 1: Implement the hook**

```typescript
// web/src/hooks/useVoiceSession.ts
import { useState, useRef, useCallback, useEffect } from "react";
import type { VoiceState } from "../components/voice/types.ts";

interface UseVoiceSessionOptions {
  wsUrl: string;
}

export interface UseVoiceSessionReturn {
  state: VoiceState;
  statusText: string;
  isTyping: boolean;
  isConnected: boolean;
  voiceMode: "on" | "whisper";
  muted: boolean;
  sessionActive: boolean;
  startSession: () => void;
  endSession: () => void;
  setMode: (mode: "on" | "whisper") => void;
  toggleMute: () => void;
  sendAudio: (pcmBuffer: ArrayBuffer) => void;
  onAudioReceived: (handler: (base64: string) => void) => void;
}

export function useVoiceSession({ wsUrl }: UseVoiceSessionOptions): UseVoiceSessionReturn {
  const [state, setState] = useState<VoiceState>("idle");
  const [statusText, setStatusText] = useState("Ready.");
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"on" | "whisper">("on");
  const [muted, setMuted] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioHandlerRef = useRef<((base64: string) => void) | null>(null);
  const transcriptBufferRef = useRef("");

  // Connect WebSocket
  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      // Identify as voice client
      ws.send(JSON.stringify({
        type: "session:identify",
        id: crypto.randomUUID(),
        clientType: "voice",
      }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      setIsConnected(false);
      setSessionActive(false);
    };

    ws.onerror = () => ws.close();
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  const handleServerMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "voice:state":
        setState(msg.state);
        if (msg.state === "idle") {
          setIsTyping(false);
        } else if (msg.state === "listening") {
          setStatusText("Listening...");
          setIsTyping(false);
          transcriptBufferRef.current = "";
        } else if (msg.state === "thinking") {
          setStatusText("Processing...");
          setIsTyping(false);
        }
        break;

      case "voice:transcript":
        if (msg.role === "assistant") {
          if (msg.done) {
            setIsTyping(false);
          } else {
            transcriptBufferRef.current += msg.delta;
            setStatusText(transcriptBufferRef.current);
            setIsTyping(true);
          }
        } else if (msg.role === "user" && msg.done) {
          // Show user's transcript briefly
          setStatusText(msg.delta);
        }
        break;

      case "voice:audio":
        audioHandlerRef.current?.(msg.delta);
        break;

      case "voice:started":
        setSessionActive(true);
        setState("idle");
        setStatusText("Ready.");
        break;

      case "voice:stopped":
        setSessionActive(false);
        setState("idle");
        setStatusText("Session ended.");
        break;

      case "voice:error":
        setState("error");
        setStatusText(msg.message ?? "Error.");
        break;
    }
  }, []);

  const startSession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:start",
      id: crypto.randomUUID(),
    }));
  }, []);

  const endSession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:stop",
      id: crypto.randomUUID(),
    }));
  }, []);

  const setMode = useCallback((mode: "on" | "whisper") => {
    setVoiceMode(mode);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:mode",
      id: crypto.randomUUID(),
      mode,
    }));
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  const sendAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || muted) return;
    // Send as binary frame
    ws.send(pcmBuffer);
  }, [muted]);

  const onAudioReceived = useCallback((handler: (base64: string) => void) => {
    audioHandlerRef.current = handler;
  }, []);

  return {
    state,
    statusText,
    isTyping,
    isConnected,
    voiceMode,
    muted,
    sessionActive,
    startSession,
    endSession,
    setMode,
    toggleMute,
    sendAudio,
    onAudioReceived,
  };
}
```

**Step 2: Commit**

```bash
git add web/src/hooks/useVoiceSession.ts
git commit -m "feat(voice): add useVoiceSession hook for real voice lifecycle"
```

---

### Task 16: Evolve VoiceMode to real voice

**Files:**
- Modify: `web/src/components/voice/VoiceMode.tsx`
- Modify: `web/src/components/voice/VoiceControls.tsx`
- Remove: `web/src/components/voice/useVoiceState.ts` (replaced by useVoiceSession)
- Remove: `web/src/components/voice/VoiceDevControls.tsx` (no longer needed)

**Step 1: Rewrite VoiceMode.tsx**

Replace the demo-mode composition with real voice:

```tsx
// web/src/components/voice/VoiceMode.tsx
import { useCallback, useEffect } from "react";
import { VoiceOrb } from "./VoiceOrb.tsx";
import { VoiceStatus } from "./VoiceStatus.tsx";
import { VoiceControls } from "./VoiceControls.tsx";
import { useVoiceSession } from "../../hooks/useVoiceSession.ts";
import { useVoiceAudio } from "../../hooks/useVoiceAudio.ts";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
const WS_URL = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws`;

export function VoiceMode() {
  const voice = useVoiceSession({ wsUrl: WS_URL });

  const handleAudioChunk = useCallback(
    (pcmBuffer: ArrayBuffer) => {
      voice.sendAudio(pcmBuffer);
    },
    [voice.sendAudio],
  );

  const audio = useVoiceAudio(handleAudioChunk);

  // Wire audio playback to voice session
  useEffect(() => {
    voice.onAudioReceived((base64) => {
      audio.playAudio(base64);
    });
  }, [voice.onAudioReceived, audio.playAudio]);

  // Auto-start voice session and mic capture when connected
  useEffect(() => {
    if (voice.isConnected && !voice.sessionActive) {
      voice.startSession();
    }
  }, [voice.isConnected, voice.sessionActive]);

  useEffect(() => {
    if (voice.sessionActive && !audio.isCapturing) {
      audio.startCapture().catch(console.error);
    }
    if (!voice.sessionActive && audio.isCapturing) {
      audio.stopCapture();
      audio.stopPlayback();
    }
  }, [voice.sessionActive]);

  const voiceName = !voice.sessionActive
    ? "Voice \u00B7 Off"
    : voice.voiceMode === "whisper"
      ? "Voice \u00B7 Whisper"
      : "Voice \u00B7 On";

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: "radial-gradient(ellipse at center, #0D1117 0%, #090C12 100%)" }}
    >
      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-[1]"
        style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)" }}
      />

      {/* Title */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-10 text-center select-none">
        <div className="text-[1.4rem] font-light" style={{ letterSpacing: "0.3em", color: "#E8943A" }}>
          F.R.I.D.A.Y.
        </div>
        <div className="text-[0.85rem] mt-1" style={{ color: "#6B5540" }}>
          {voiceName}
        </div>
      </div>

      {/* Canvas orb */}
      <VoiceOrb
        state={voice.state}
        whisperMode={voice.voiceMode === "whisper"}
        muted={voice.muted}
        speedMultiplier={1}
        sessionEnded={!voice.sessionActive}
      />

      {/* Status text */}
      <VoiceStatus
        text={voice.statusText}
        isTyping={voice.isTyping}
        speedMultiplier={1}
      />

      {/* Controls */}
      <VoiceControls
        whisperMode={voice.voiceMode === "whisper"}
        muted={voice.muted}
        sessionEnded={!voice.sessionActive}
        onToggleWhisper={() => voice.setMode(voice.voiceMode === "whisper" ? "on" : "whisper")}
        onToggleMute={voice.toggleMute}
        onEndSession={voice.endSession}
      />
    </div>
  );
}
```

**Step 2: Remove demo files**

```bash
rm web/src/components/voice/useVoiceState.ts
rm web/src/components/voice/VoiceDevControls.tsx
```

**Step 3: Update barrel export**

Update `web/src/components/voice/index.ts` to remove useVoiceState and VoiceDevControls exports.

**Step 4: Verify build**

Run: `cd web && bun run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(voice): wire VoiceMode to real voice session and audio pipeline"
```

---

## Phase 6: Cross-Client Sync

### Task 17: Broadcast conversation updates

**Files:**
- Modify: `src/server/handler.ts`

The broadcast logic was already added in Task 3 (the `conversation:message` broadcasts in the chat handler). This task verifies and extends it:

**Step 1: Verify chat broadcasts work**

The handler already broadcasts `conversation:message` for both user and assistant messages in the `chat` case. Verify the voice handler also broadcasts:

In the `voice:start` handler callbacks (Task 12), `onUserTranscript` already broadcasts user transcripts. Add assistant response broadcast:

```typescript
// In VoiceBridge callbacks, after Cortex responds and TTS starts:
// The VoiceBridge.processThroughCortex already calls cortex.chatStream,
// which commits to history. We need to also broadcast the assistant response.

// Add to VoiceBridge callbacks in handler.ts:
onTranscriptDelta: (delta, done) => {
  send({ type: "voice:transcript", role: "assistant", delta, done });
  if (done) {
    // Broadcast full assistant response to other clients
    this.registry.broadcast(
      { type: "conversation:message", role: "assistant", content: transcriptBufferRef, source: "voice" },
      (c) => c.id !== this.clientId,
    );
  }
},
```

This requires accumulating the transcript in the handler. Add a transcript buffer:

```typescript
private assistantTranscriptBuffer = "";

// Reset on voice:start, accumulate on transcript delta, broadcast on done
```

**Step 2: Manual integration test**

1. Start `friday serve`
2. Open browser at `http://localhost:5173/?mode=voice`
3. Open another terminal, run `friday chat`
4. Speak in voice mode
5. Verify transcript appears in the terminal chat

**Step 3: Commit**

```bash
git add src/server/handler.ts
git commit -m "feat(sync): broadcast voice transcripts to all clients"
```

---

### Task 18: Final integration test and cleanup

**Files:**
- Modify: `web/src/components/voice/constants.ts` (remove demo data)
- Verify: All tests pass

**Step 1: Clean up demo constants**

Remove `DEMO_RESPONSES`, `DEMO_SCHEDULE`, `STATUS_FOR_STATE` from `web/src/components/voice/constants.ts` since they were only used by the now-deleted `useVoiceState.ts`.

Keep: `VOICE_STATES`, `COLORS`, `PARTICLE_COUNT`, `SPHERE_RADIUS`, `SPRITE_SIZE`, `TRANSITION_SPEED`, `ARC_SEGMENTS`, `ARC_MAX_LIFE`, `STATE_COLORS`, `SPARK_COLOR` — these are used by VoiceOrb.tsx.

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Run lint**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 5: Verify build**

Run: `cd web && bun run build`
Expected: Build succeeds

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: clean up demo constants, final integration verification"
```

---

## Summary of All Files

### New files (14)
- `src/server/client-registry.ts` — Client tracking and broadcast
- `src/server/socket.ts` — Unix domain socket server
- `src/server/ttyd.ts` — ttyd spawner utility
- `src/core/bridges/types.ts` — RuntimeBridge interface
- `src/core/bridges/local.ts` — LocalBridge (direct runtime calls)
- `src/core/bridges/socket.ts` — SocketBridge (IPC client)
- `src/core/voice/bridge.ts` — VoiceBridge (full-duplex Cortex-mediated voice)
- `web/public/pcm-worklet.js` — AudioWorklet PCM capture processor
- `web/src/hooks/useVoiceAudio.ts` — Mic capture + audio playback hook
- `web/src/hooks/useVoiceSession.ts` — Voice lifecycle hook
- `web/src/components/terminal/TerminalEmbed.tsx` — ttyd iframe wrapper
- `tests/unit/client-registry.test.ts`
- `tests/unit/server-protocol.test.ts`
- `tests/unit/runtime-bridge.test.ts`
- `tests/unit/socket-server.test.ts`
- `tests/unit/socket-bridge.test.ts`
- `tests/unit/voice-bridge.test.ts`

### Modified files (6)
- `src/server/index.ts` — Singleton runtime, ClientRegistry, binary frame handling
- `src/server/handler.ts` — Shared runtime, VoiceBridge integration, voice handlers
- `src/server/protocol.ts` — Voice and session message types
- `src/cli/commands/serve.ts` — Async boot, socket server, ttyd spawn
- `src/cli/commands/chat.ts` — Socket detection, bridge selection
- `src/cli/tui/app.tsx` — RuntimeBridge abstraction
- `web/src/App.tsx` — Terminal + voice routing
- `web/src/components/voice/VoiceMode.tsx` — Real voice session
- `web/src/components/voice/VoiceControls.tsx` — Real controls
- `web/src/components/voice/index.ts` — Updated exports
- `web/src/components/voice/constants.ts` — Remove demo data

### Deleted files (14)
- `web/src/components/chat/ChatInput.tsx`
- `web/src/components/chat/ChatPanel.tsx`
- `web/src/components/chat/ThinkingIndicator.tsx`
- `web/src/components/chat/MessageBubble.tsx`
- `web/src/components/chat/MessageList.tsx`
- `web/src/components/layout/Header.tsx`
- `web/src/components/layout/StatusBar.tsx`
- `web/src/components/layout/Layout.tsx`
- `web/src/components/layout/Sidebar.tsx`
- `web/src/contexts/ChatContext.tsx`
- `web/src/hooks/useChat.ts`
- `web/src/components/AutoBoot.tsx`
- `web/src/components/voice/useVoiceState.ts`
- `web/src/components/voice/VoiceDevControls.tsx`
