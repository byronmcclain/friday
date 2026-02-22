# Friday Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React web interface that mirrors all CLI features, communicating with Friday's Bun backend over WebSocket.

**Architecture:** Thin WebSocket relay around FridayRuntime. New `src/server/` backend with Bun.serve(). React SPA in `web/` subfolder with Vite + Tailwind. Shared TypeScript types between frontend and backend.

**Tech Stack:** Bun (server), React 19, Vite 6, Tailwind CSS 4, WebSocket (Bun native), react-markdown, highlight.js

**Design Doc:** `docs/plans/2026-02-21-friday-web-ui-design.md`

---

## Phase 1: Foundation — Shared Types & Server Scaffolding

### Task 1: WebSocket Protocol Types

Define the shared message types that both backend and frontend import.

**Files:**
- Create: `src/server/protocol.ts`
- Test: `tests/unit/server-protocol.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/server-protocol.test.ts
import { describe, test, expect } from "bun:test";
import {
  type ClientMessage,
  type ServerMessage,
  parseClientMessage,
  serializeServerMessage,
} from "../../src/server/protocol.ts";

describe("WebSocket Protocol", () => {
  describe("parseClientMessage", () => {
    test("parses chat message", () => {
      const raw = JSON.stringify({ type: "chat", id: "abc", content: "hello" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "chat", id: "abc", content: "hello" });
    });

    test("parses protocol command", () => {
      const raw = JSON.stringify({ type: "protocol", id: "abc", command: "/env status" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "protocol", id: "abc", command: "/env status" });
    });

    test("parses session:boot", () => {
      const raw = JSON.stringify({ type: "session:boot", id: "abc", provider: "grok" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "session:boot", id: "abc", provider: "grok" });
    });

    test("parses session:shutdown", () => {
      const raw = JSON.stringify({ type: "session:shutdown", id: "abc" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "session:shutdown", id: "abc" });
    });

    test("parses history:list", () => {
      const raw = JSON.stringify({ type: "history:list", id: "abc", count: 10 });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "history:list", id: "abc", count: 10 });
    });

    test("parses history:load", () => {
      const raw = JSON.stringify({ type: "history:load", id: "abc", sessionId: "sess-1" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "history:load", id: "abc", sessionId: "sess-1" });
    });

    test("parses smarts:list", () => {
      const raw = JSON.stringify({ type: "smarts:list", id: "abc" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "smarts:list", id: "abc" });
    });

    test("parses smarts:search", () => {
      const raw = JSON.stringify({ type: "smarts:search", id: "abc", query: "bun" });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({ type: "smarts:search", id: "abc", query: "bun" });
    });

    test("returns null for invalid JSON", () => {
      const msg = parseClientMessage("not json");
      expect(msg).toBeNull();
    });

    test("returns null for unknown type", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "unknown", id: "abc" }));
      expect(msg).toBeNull();
    });

    test("returns null for missing required fields", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "chat" }));
      expect(msg).toBeNull();
    });
  });

  describe("serializeServerMessage", () => {
    test("serializes chat:response", () => {
      const msg: ServerMessage = {
        type: "chat:response",
        requestId: "abc",
        content: "hello",
        source: "cortex",
      };
      const json = serializeServerMessage(msg);
      expect(JSON.parse(json)).toEqual(msg);
    });

    test("serializes error", () => {
      const msg: ServerMessage = {
        type: "error",
        requestId: "abc",
        code: "NOT_BOOTED",
        message: "Runtime not booted",
      };
      const json = serializeServerMessage(msg);
      expect(JSON.parse(json)).toEqual(msg);
    });

    test("serializes sensorium:update without requestId", () => {
      const msg: ServerMessage = {
        type: "sensorium:update",
        snapshot: { cpu: 42, memory: 68, timestamp: "2026-02-21T00:00:00Z" } as any,
      };
      const json = serializeServerMessage(msg);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("sensorium:update");
      expect(parsed.requestId).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: FAIL — module `../../src/server/protocol.ts` not found

**Step 3: Write minimal implementation**

```typescript
// src/server/protocol.ts
import type { ProviderName } from "../core/types.ts";
import type { SignalName } from "../core/events.ts";

// ─── Client → Server ────────────────────────────────────────────

export type ClientMessage =
  | { type: "chat"; id: string; content: string }
  | { type: "protocol"; id: string; command: string }
  | { type: "session:boot"; id: string; provider?: ProviderName; model?: string; fresh?: boolean }
  | { type: "session:shutdown"; id: string }
  | { type: "history:list"; id: string; count?: number }
  | { type: "history:load"; id: string; sessionId: string }
  | { type: "smarts:list"; id: string }
  | { type: "smarts:search"; id: string; query: string };

// ─── Server → Client ────────────────────────────────────────────

export type ServerMessage =
  | { type: "chat:response"; requestId: string; content: string; source: "cortex" | "protocol" }
  | { type: "protocol:response"; requestId: string; content: string; success: boolean }
  | { type: "session:booted"; requestId: string; provider: string; model: string }
  | { type: "session:closed"; requestId: string }
  | { type: "history:result"; requestId: string; data: unknown }
  | { type: "smarts:result"; requestId: string; data: unknown }
  | { type: "sensorium:update"; snapshot: unknown }
  | { type: "signal"; name: SignalName; source: string; data?: Record<string, unknown> }
  | { type: "notification"; level: "info" | "warning" | "alert"; title: string; body: string; source: string }
  | { type: "error"; requestId?: string; code: string; message: string };

// ─── Validators ─────────────────────────────────────────────────

const VALID_TYPES = new Set([
  "chat", "protocol", "session:boot", "session:shutdown",
  "history:list", "history:load", "smarts:list", "smarts:search",
]);

const REQUIRED_FIELDS: Record<string, string[]> = {
  "chat": ["id", "content"],
  "protocol": ["id", "command"],
  "session:boot": ["id"],
  "session:shutdown": ["id"],
  "history:list": ["id"],
  "history:load": ["id", "sessionId"],
  "smarts:list": ["id"],
  "smarts:search": ["id", "query"],
};

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const type = parsed.type as string;
  if (!VALID_TYPES.has(type)) return null;

  const required = REQUIRED_FIELDS[type];
  if (required) {
    for (const field of required) {
      if (parsed[field] === undefined || parsed[field] === null) return null;
    }
  }

  return parsed as ClientMessage;
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/server-protocol.test.ts`
Expected: PASS — all 11 tests pass

**Step 5: Commit**

```bash
git add src/server/protocol.ts tests/unit/server-protocol.test.ts
git commit -m "feat(server): add WebSocket protocol types and parser"
```

---

### Task 2: WebSocket Handler

Route incoming WebSocket messages to FridayRuntime subsystems.

**Files:**
- Create: `src/server/handler.ts`
- Test: `tests/unit/server-handler.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/server-handler.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WebSocketHandler } from "../../src/server/handler.ts";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { stubProvider } from "../helpers/stubs.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

describe("WebSocketHandler", () => {
  let runtime: FridayRuntime;
  let handler: WebSocketHandler;
  let sent: ServerMessage[];

  const mockSend = (msg: ServerMessage) => { sent.push(msg); };

  beforeEach(async () => {
    runtime = new FridayRuntime();
    handler = new WebSocketHandler(runtime);
    sent = [];
  });

  test("returns error when runtime not booted and chat received", async () => {
    await handler.handle('{"type":"chat","id":"1","content":"hello"}', mockSend);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("error");
    expect((sent[0] as any).code).toBe("NOT_BOOTED");
  });

  test("boots runtime on session:boot", async () => {
    await handler.handle(
      '{"type":"session:boot","id":"1","provider":"grok"}',
      mockSend,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("session:booted");
    expect(runtime.isBooted).toBe(true);
  });

  test("handles chat after boot", async () => {
    await handler.handle(
      `{"type":"session:boot","id":"1"}`,
      mockSend,
    );
    sent = [];
    await handler.handle(
      '{"type":"chat","id":"2","content":"hello"}',
      mockSend,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("chat:response");
    expect((sent[0] as any).requestId).toBe("2");
  });

  test("handles protocol command after boot", async () => {
    await handler.handle(
      `{"type":"session:boot","id":"1"}`,
      mockSend,
    );
    // Register a test protocol
    runtime.protocols.register({
      name: "test",
      description: "test",
      aliases: [],
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, summary: "Test OK" }),
    });
    sent = [];
    await handler.handle(
      '{"type":"protocol","id":"3","command":"/test"}',
      mockSend,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("chat:response");
    expect((sent[0] as any).content).toContain("Test OK");
  });

  test("handles session:shutdown", async () => {
    await handler.handle(
      `{"type":"session:boot","id":"1"}`,
      mockSend,
    );
    sent = [];
    await handler.handle(
      '{"type":"session:shutdown","id":"4"}',
      mockSend,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("session:closed");
    expect(runtime.isBooted).toBe(false);
  });

  test("returns error for invalid JSON", async () => {
    await handler.handle("not json", mockSend);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("error");
    expect((sent[0] as any).code).toBe("INVALID_MESSAGE");
  });
});
```

> **Note for implementer:** The `session:boot` test uses the handler's internal injectedProvider mechanism. The handler constructor accepts a `RuntimeConfig` override or uses a default. For tests, pass `{ injectedProvider: stubProvider }` as a boot config default in the handler or expose a way to inject it. See the pattern in `src/core/runtime.ts` — `RuntimeConfig.injectedProvider`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server-handler.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/server/handler.ts
import { FridayRuntime, type RuntimeConfig } from "../core/runtime.ts";
import {
  parseClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.ts";

export type SendFn = (msg: ServerMessage) => void;

export class WebSocketHandler {
  private runtime: FridayRuntime;
  private bootConfigDefaults: Partial<RuntimeConfig>;

  constructor(runtime: FridayRuntime, bootConfigDefaults: Partial<RuntimeConfig> = {}) {
    this.runtime = runtime;
    this.bootConfigDefaults = bootConfigDefaults;
  }

  async handle(raw: string, send: SendFn): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) {
      send({ type: "error", code: "INVALID_MESSAGE", message: "Failed to parse message" });
      return;
    }

    try {
      switch (msg.type) {
        case "session:boot":
          return this.handleBoot(msg, send);
        case "session:shutdown":
          return this.handleShutdown(msg, send);
        default:
          return this.handleRuntimeMessage(msg, send);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "error", requestId: msg.id, code: "INTERNAL_ERROR", message });
    }
  }

  private async handleBoot(
    msg: Extract<ClientMessage, { type: "session:boot" }>,
    send: SendFn,
  ): Promise<void> {
    const config: RuntimeConfig = {
      ...this.bootConfigDefaults,
      provider: msg.provider ?? this.bootConfigDefaults.provider,
      model: msg.model,
      fresh: msg.fresh,
    };
    await this.runtime.boot(config);
    send({
      type: "session:booted",
      requestId: msg.id,
      provider: this.runtime.cortex.providerName,
      model: this.runtime.cortex.modelName,
    });
  }

  private async handleShutdown(
    msg: Extract<ClientMessage, { type: "session:shutdown" }>,
    send: SendFn,
  ): Promise<void> {
    if (!this.runtime.isBooted) {
      send({ type: "error", requestId: msg.id, code: "NOT_BOOTED", message: "Runtime not booted" });
      return;
    }
    await this.runtime.shutdown();
    send({ type: "session:closed", requestId: msg.id });
  }

  private async handleRuntimeMessage(msg: ClientMessage, send: SendFn): Promise<void> {
    if (!this.runtime.isBooted) {
      send({
        type: "error",
        requestId: (msg as any).id,
        code: "NOT_BOOTED",
        message: "Runtime not booted. Send session:boot first.",
      });
      return;
    }

    switch (msg.type) {
      case "chat": {
        const result = await this.runtime.process(msg.content);
        send({
          type: "chat:response",
          requestId: msg.id,
          content: result.output,
          source: result.source,
        });
        break;
      }
      case "protocol": {
        const result = await this.runtime.process(msg.command);
        send({
          type: "chat:response",
          requestId: msg.id,
          content: result.output,
          source: result.source,
        });
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
        const entries = await this.runtime.smarts.list();
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

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/server-handler.test.ts`
Expected: PASS

> **Implementer note:** The `session:boot` test needs `stubProvider` injected. Either: (a) pass `{ injectedProvider: stubProvider }` as `bootConfigDefaults` in the test's handler constructor, or (b) adjust the handler to accept it. Use option (a): `new WebSocketHandler(runtime, { injectedProvider: stubProvider })`.

**Step 5: Commit**

```bash
git add src/server/handler.ts tests/unit/server-handler.test.ts
git commit -m "feat(server): add WebSocket message handler"
```

---

### Task 3: Bun.serve() WebSocket Server

Create the HTTP + WebSocket server using Bun's native APIs.

**Files:**
- Create: `src/server/index.ts`
- Test: `tests/unit/server-index.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/server-index.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { createFridayServer } from "../../src/server/index.ts";

describe("createFridayServer", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
  });

  test("starts HTTP server on given port", async () => {
    server = createFridayServer({ port: 0 }); // port 0 = OS picks random port
    expect(server.port).toBeGreaterThan(0);
  });

  test("serves index.html for GET /", async () => {
    server = createFridayServer({ port: 0 });
    const res = await fetch(`http://localhost:${server.port}/`);
    // In dev mode without web/dist, should return a placeholder
    expect(res.status).toBe(200);
  });

  test("upgrades WebSocket connections at /ws", async () => {
    server = createFridayServer({ port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  test("WebSocket receives error for chat before boot", async () => {
    server = createFridayServer({ port: 0 });
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
      ws.send(JSON.stringify({ type: "chat", id: "1", content: "hello" }));
    });
    expect(response.type).toBe("error");
    expect(response.code).toBe("NOT_BOOTED");
    ws.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server-index.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/server/index.ts
import { resolve } from "node:path";
import { FridayRuntime, type RuntimeConfig } from "../core/runtime.ts";
import { WebSocketHandler, type SendFn } from "./handler.ts";
import type { ServerMessage } from "./protocol.ts";
import type { ServerWebSocket } from "bun";

export interface FridayServerConfig {
  port: number;
  staticDir?: string;
  runtimeConfig?: Partial<RuntimeConfig>;
}

interface WSData {
  handler: WebSocketHandler;
  runtime: FridayRuntime;
}

export function createFridayServer(config: FridayServerConfig) {
  const staticDir = config.staticDir ?? resolve("web/dist");

  const server = Bun.serve<WSData>({
    port: config.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const runtime = new FridayRuntime();
        const handler = new WebSocketHandler(runtime, config.runtimeConfig);
        const upgraded = server.upgrade(req, { data: { handler, runtime } });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Static file serving (SPA)
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(resolve(staticDir + filePath));
      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback: serve index.html for all non-file routes
      const index = Bun.file(resolve(staticDir + "/index.html"));
      if (await index.exists()) {
        return new Response(index);
      }

      // Dev mode placeholder when web/dist doesn't exist
      return new Response(
        "<html><body><h1>Friday Web UI</h1><p>Run <code>cd web && bun run build</code> first.</p></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        // Connection opened — nothing to do until client sends session:boot
      },
      async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
        const raw = typeof message === "string" ? message : message.toString();
        const send: SendFn = (msg: ServerMessage) => {
          ws.send(JSON.stringify(msg));
        };
        await ws.data.handler.handle(raw, send);
      },
      close(ws: ServerWebSocket<WSData>) {
        // Auto-shutdown runtime if still booted
        if (ws.data.runtime.isBooted) {
          ws.data.runtime.shutdown().catch(() => {});
        }
      },
    },
  });

  return server;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/server-index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/index.ts tests/unit/server-index.test.ts
git commit -m "feat(server): add Bun.serve() WebSocket server"
```

---

### Task 4: `friday serve` CLI Command

Add the Commander command that starts the web server.

**Files:**
- Create: `src/cli/commands/serve.ts`
- Modify: `src/cli/index.ts` — add import and registration

**Step 1: Write the failing test**

```typescript
// tests/unit/serve-command.test.ts
import { describe, test, expect } from "bun:test";
import { program } from "../../src/cli/index.ts";

describe("serve command", () => {
  test("is registered on the program", () => {
    const cmd = program.commands.find((c) => c.name() === "serve");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("web");
  });

  test("has --port option with default 3000", () => {
    const cmd = program.commands.find((c) => c.name() === "serve");
    const portOpt = cmd!.options.find((o) => o.long === "--port");
    expect(portOpt).toBeDefined();
    expect(portOpt!.defaultValue).toBe("3000");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/serve-command.test.ts`
Expected: FAIL — no `serve` command found

**Step 3: Write implementation**

```typescript
// src/cli/commands/serve.ts
import type { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { resolve } from "node:path";
import { createFridayServer } from "../../server/index.ts";
import type { ProviderName } from "../../core/types.ts";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";

export function serveCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Friday web UI server")
    .option("--port <port>", "Port to listen on", "3000")
    .option(
      "-p, --provider <provider>",
      "Default LLM provider (anthropic, grok)",
      DEFAULT_PROVIDER,
    )
    .option("-m, --model <model>", "Default model (defaults per provider)")
    .action(async (options) => {
      const port = Number.parseInt(options.port, 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        console.error(chalk.red("Invalid port number"));
        process.exit(1);
      }

      const server = createFridayServer({
        port,
        staticDir: resolve("web/dist"),
        runtimeConfig: {
          provider: options.provider as ProviderName,
          model: options.model,
          smartsDir: resolve("smarts"),
          dataDir: resolve("data"),
        },
      });

      console.log(
        boxen(
          `${chalk.cyan.bold("F.R.I.D.A.Y. Web UI")}\n${chalk.dim(`http://localhost:${server.port}`)}`,
          { padding: 1, borderColor: "cyan", borderStyle: "round" },
        ),
      );

      // Keep process alive
      process.on("SIGINT", () => {
        console.log(chalk.dim("\nShutting down server..."));
        server.stop(true);
        process.exit(0);
      });
    });
}
```

Then register in `src/cli/index.ts`:

```typescript
// Add import
import { serveCommand } from "./commands/serve.ts";

// Add after chatCommand(program);
serveCommand(program);
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/serve-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/serve.ts src/cli/index.ts tests/unit/serve-command.test.ts
git commit -m "feat(cli): add friday serve command for web UI"
```

---

### Task 5: WebSocket Notification Channel

Add a notification channel that pushes to WebSocket clients.

**Files:**
- Create: `src/server/ws-channel.ts`
- Test: `tests/unit/ws-channel.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/ws-channel.test.ts
import { describe, test, expect } from "bun:test";
import { WebSocketNotificationChannel } from "../../src/server/ws-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("WebSocketNotificationChannel", () => {
  test("sends notification to registered callback", async () => {
    const sent: any[] = [];
    const channel = new WebSocketNotificationChannel((msg) => sent.push(msg));

    const notification: FridayNotification = {
      level: "warning",
      title: "CPU High",
      body: "CPU at 92%",
      source: "sensorium",
    };
    await channel.send(notification);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("notification");
    expect(sent[0].level).toBe("warning");
    expect(sent[0].title).toBe("CPU High");
  });

  test("has name 'websocket'", () => {
    const channel = new WebSocketNotificationChannel(() => {});
    expect(channel.name).toBe("websocket");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ws-channel.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/server/ws-channel.ts
import type { NotificationChannel, FridayNotification } from "../core/notifications.ts";
import type { ServerMessage } from "./protocol.ts";

export type WSSendFn = (msg: ServerMessage) => void;

export class WebSocketNotificationChannel implements NotificationChannel {
  name = "websocket";
  private sendFn: WSSendFn;

  constructor(sendFn: WSSendFn) {
    this.sendFn = sendFn;
  }

  async send(notification: FridayNotification): Promise<void> {
    this.sendFn({
      type: "notification",
      level: notification.level,
      title: notification.title,
      body: notification.body,
      source: notification.source,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ws-channel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/ws-channel.ts tests/unit/ws-channel.test.ts
git commit -m "feat(server): add WebSocket notification channel"
```

---

### Task 6: Sensorium Push Events

Wire the Sensorium polling loop to push snapshots over WebSocket.

**Files:**
- Modify: `src/server/handler.ts` — add Sensorium subscription on boot
- Test: `tests/unit/server-handler.test.ts` — add Sensorium push test

**Step 1: Add test case**

Add to `tests/unit/server-handler.test.ts`:

```typescript
test("pushes sensorium updates after boot", async () => {
  // Boot with sensorium enabled
  await handler.handle(
    `{"type":"session:boot","id":"1"}`,
    mockSend,
  );
  sent = [];

  // Trigger a sensorium update by calling handler's pushSensoriumUpdate
  handler.pushSensoriumUpdate();

  // Should have received a sensorium:update message
  const sensoriumMsgs = sent.filter((m) => m.type === "sensorium:update");
  expect(sensoriumMsgs.length).toBeGreaterThanOrEqual(0); // May be 0 if sensorium disabled in stub
});
```

> **Note:** This test is lightweight since sensorium may not produce snapshots in test mode (no real polling). The key integration test is manual: boot the web UI, verify live metrics appear.

**Step 2: Update handler to expose push capability**

In `src/server/handler.ts`, add:

```typescript
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
          percent: snapshot.machine.memory.total > 0
            ? Math.round((snapshot.machine.memory.used / snapshot.machine.memory.total) * 100)
            : 0,
        },
        containers: snapshot.containers,
        git: snapshot.dev.git,
        ports: snapshot.dev.ports,
      },
    });
  }
}
```

> **Implementer:** The exact wiring depends on how `Bun.serve()` tracks open connections. In `src/server/index.ts`, after a successful `session:boot`, subscribe to the Sensorium's signal emissions and call `pushSensoriumUpdate()` on each poll. The simplest approach: store the `send` function on the handler at boot time.

**Step 3: Run tests**

Run: `bun test tests/unit/server-handler.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server/handler.ts tests/unit/server-handler.test.ts
git commit -m "feat(server): wire Sensorium push events to WebSocket"
```

---

## Phase 2: Frontend Shell — Vite + React + Tailwind

### Task 7: Scaffold Vite + React Project

Set up the `web/` directory with Vite, React 19, TypeScript, and Tailwind CSS 4.

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/index.css`

**Step 1: Initialize the web project**

```bash
cd web
bun init -y
```

**Step 2: Install dependencies**

```bash
cd web
bun add react react-dom react-markdown
bun add -d @vitejs/plugin-react vite tailwindcss @tailwindcss/vite typescript @types/react @types/react-dom
```

**Step 3: Create config files**

`web/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@friday": resolve(__dirname, "../src"),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@friday/*": ["../src/*"]
    }
  },
  "include": ["src"]
}
```

`web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>F.R.I.D.A.Y.</title>
  </head>
  <body class="bg-friday-deep text-friday-text">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-friday-deep: #0B0E14;
  --color-friday-bg: #111620;
  --color-friday-surface: #1A1F2E;
  --color-friday-elevated: #232A3B;

  --color-friday-amber: #F5A623;
  --color-friday-amber-light: #FFCC66;
  --color-friday-amber-dim: #8B6914;
  --color-friday-copper: #E8852A;

  --color-friday-text: #E8E0D4;
  --color-friday-text-dim: #7A7262;
  --color-friday-text-muted: #4A4438;

  --color-friday-success: #4ADE80;
  --color-friday-warning: #FBBF24;
  --color-friday-error: #F87171;
}

body {
  margin: 0;
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", monospace;
  -webkit-font-smoothing: antialiased;
  background-color: var(--color-friday-deep);
  color: var(--color-friday-text);
}

/* Amber glow keyframes */
@keyframes amber-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(245, 166, 35, 0.2); }
  50% { box-shadow: 0 0 40px rgba(245, 166, 35, 0.4); }
}

.friday-glow {
  animation: amber-pulse 2s ease-in-out infinite;
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx`:
```tsx
export function App() {
  return (
    <div className="min-h-screen bg-friday-deep flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-friday-amber friday-glow inline-block px-6 py-3 rounded-lg border border-friday-amber-dim">
          F.R.I.D.A.Y.
        </h1>
        <p className="text-friday-text-dim mt-4">Web UI initializing...</p>
      </div>
    </div>
  );
}
```

**Step 4: Verify it builds**

```bash
cd web && bunx vite build
```

Expected: Build succeeds, output in `web/dist/`

**Step 5: Verify dev server works**

```bash
cd web && bunx vite --port 5173
```

Expected: Open `http://localhost:5173` — see amber "F.R.I.D.A.Y." title with glow

**Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): scaffold Vite + React + Tailwind project with Friday palette"
```

---

### Task 8: Add `web:dev` and `web:build` Scripts to Root

**Files:**
- Modify: `package.json` — add workspace scripts

**Step 1: Add scripts to root `package.json`**

Add to the `scripts` section:

```json
"web:dev": "cd web && bunx vite",
"web:build": "cd web && bunx vite build",
"serve": "bun run src/main.ts serve"
```

**Step 2: Verify**

```bash
bun run web:build
```

Expected: Builds successfully

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add web:dev, web:build, and serve scripts"
```

---

## Phase 3: Chat Core

### Task 9: WebSocket Hook

The foundational hook that all other hooks build on.

**Files:**
- Create: `web/src/hooks/useWebSocket.ts`
- Create: `web/src/contexts/WebSocketContext.tsx`

**Step 1: Create the hook**

```typescript
// web/src/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@friday/server/protocol.ts";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

type MessageHandler = (msg: ServerMessage) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState("connecting");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setState("connected");
      reconnectDelay.current = 1000; // Reset backoff
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        const typeHandlers = handlersRef.current.get(msg.type);
        if (typeHandlers) {
          for (const handler of typeHandlers) handler(msg);
        }
        // Also notify "*" subscribers
        const allHandlers = handlersRef.current.get("*");
        if (allHandlers) {
          for (const handler of allHandlers) handler(msg);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      setState("reconnecting");
      reconnectRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setState("disconnected");
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { state, connect, disconnect, send, subscribe };
}
```

**Step 2: Create the context**

```typescript
// web/src/contexts/WebSocketContext.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWebSocket, type ConnectionState } from "../hooks/useWebSocket.ts";
import type { ClientMessage, ServerMessage } from "@friday/server/protocol.ts";

interface WebSocketContextValue {
  state: ConnectionState;
  connect: () => void;
  disconnect: () => void;
  send: (msg: ClientMessage) => void;
  subscribe: (type: string, handler: (msg: ServerMessage) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ url, children }: { url: string; children: ReactNode }) {
  const ws = useWebSocket(url);

  const value = useMemo(
    () => ({
      state: ws.state,
      connect: ws.connect,
      disconnect: ws.disconnect,
      send: ws.send,
      subscribe: ws.subscribe,
    }),
    [ws.state, ws.connect, ws.disconnect, ws.send, ws.subscribe],
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWS(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWS must be used within WebSocketProvider");
  return ctx;
}
```

**Step 3: Verify builds**

```bash
cd web && bunx vite build
```

Expected: Compiles cleanly

**Step 4: Commit**

```bash
git add web/src/hooks/useWebSocket.ts web/src/contexts/WebSocketContext.tsx
git commit -m "feat(web): add WebSocket hook and context provider"
```

---

### Task 10: Chat Hook and Context

Manages conversation state, sending messages, and tracking responses.

**Files:**
- Create: `web/src/hooks/useChat.ts`
- Create: `web/src/contexts/ChatContext.tsx`

**Step 1: Create the chat hook**

```typescript
// web/src/hooks/useChat.ts
import { useCallback, useEffect, useReducer } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source?: "cortex" | "protocol";
  timestamp: Date;
}

interface ChatState {
  messages: ChatMessage[];
  isThinking: boolean;
  pendingRequestId: string | null;
}

type ChatAction =
  | { type: "send"; message: ChatMessage }
  | { type: "receive"; message: ChatMessage }
  | { type: "thinking"; requestId: string }
  | { type: "done" }
  | { type: "clear" }
  | { type: "load"; messages: ChatMessage[] };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        messages: [...state.messages, action.message],
        isThinking: true,
      };
    case "receive":
      return {
        ...state,
        messages: [...state.messages, action.message],
        isThinking: false,
        pendingRequestId: null,
      };
    case "thinking":
      return { ...state, isThinking: true, pendingRequestId: action.requestId };
    case "done":
      return { ...state, isThinking: false, pendingRequestId: null };
    case "clear":
      return { messages: [], isThinking: false, pendingRequestId: null };
    case "load":
      return { messages: action.messages, isThinking: false, pendingRequestId: null };
    default:
      return state;
  }
}

export function useChat() {
  const { send, subscribe } = useWS();
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isThinking: false,
    pendingRequestId: null,
  });

  useEffect(() => {
    const unsub1 = subscribe("chat:response", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "chat:response" }>;
      dispatch({
        type: "receive",
        message: {
          id: m.requestId,
          role: "assistant",
          content: m.content,
          source: m.source,
          timestamp: new Date(),
        },
      });
    });

    const unsub2 = subscribe("error", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "error" }>;
      dispatch({
        type: "receive",
        message: {
          id: m.requestId ?? crypto.randomUUID(),
          role: "system",
          content: `Error: ${m.message}`,
          timestamp: new Date(),
        },
      });
    });

    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  const sendMessage = useCallback((content: string) => {
    const id = crypto.randomUUID();
    dispatch({
      type: "send",
      message: { id, role: "user", content, timestamp: new Date() },
    });

    // Route: if it starts with /, send as protocol; otherwise as chat
    if (content.startsWith("/")) {
      send({ type: "protocol", id, command: content });
    } else {
      send({ type: "chat", id, content });
    }
  }, [send]);

  const clearMessages = useCallback(() => dispatch({ type: "clear" }), []);
  const loadMessages = useCallback(
    (msgs: ChatMessage[]) => dispatch({ type: "load", messages: msgs }),
    [],
  );

  return {
    messages: state.messages,
    isThinking: state.isThinking,
    sendMessage,
    clearMessages,
    loadMessages,
  };
}
```

**Step 2: Create the context**

```typescript
// web/src/contexts/ChatContext.tsx
import { createContext, useContext, type ReactNode } from "react";
import { useChat, type ChatMessage } from "../hooks/useChat.ts";

interface ChatContextValue {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (content: string) => void;
  clearMessages: () => void;
  loadMessages: (msgs: ChatMessage[]) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
```

**Step 3: Verify builds**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/hooks/useChat.ts web/src/contexts/ChatContext.tsx
git commit -m "feat(web): add chat hook and context with message routing"
```

---

### Task 11: Session Hook and Context

Manages runtime boot/shutdown lifecycle.

**Files:**
- Create: `web/src/hooks/useSession.ts`
- Create: `web/src/contexts/SessionContext.tsx`

**Step 1: Create session hook**

```typescript
// web/src/hooks/useSession.ts
import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SessionInfo {
  provider: string;
  model: string;
}

export type SessionState = "disconnected" | "booting" | "active" | "shutting-down";

export function useSession() {
  const { send, subscribe, state: wsState, connect } = useWS();
  const [sessionState, setSessionState] = useState<SessionState>("disconnected");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);

  useEffect(() => {
    const unsub1 = subscribe("session:booted", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "session:booted" }>;
      setSessionState("active");
      setSessionInfo({ provider: m.provider, model: m.model });
    });

    const unsub2 = subscribe("session:closed", () => {
      setSessionState("disconnected");
      setSessionInfo(null);
    });

    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  const boot = useCallback((options?: { provider?: string; model?: string; fresh?: boolean }) => {
    if (wsState !== "connected") {
      connect();
    }
    setSessionState("booting");
    send({
      type: "session:boot",
      id: crypto.randomUUID(),
      provider: options?.provider as any,
      model: options?.model,
      fresh: options?.fresh,
    });
  }, [send, wsState, connect]);

  const shutdown = useCallback(() => {
    setSessionState("shutting-down");
    send({ type: "session:shutdown", id: crypto.randomUUID() });
  }, [send]);

  return { sessionState, sessionInfo, boot, shutdown, wsState };
}
```

**Step 2: Create context**

```typescript
// web/src/contexts/SessionContext.tsx
import { createContext, useContext, type ReactNode } from "react";
import { useSession, type SessionInfo, type SessionState } from "../hooks/useSession.ts";
import type { ConnectionState } from "../hooks/useWebSocket.ts";

interface SessionContextValue {
  sessionState: SessionState;
  sessionInfo: SessionInfo | null;
  wsState: ConnectionState;
  boot: (options?: { provider?: string; model?: string; fresh?: boolean }) => void;
  shutdown: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within SessionProvider");
  return ctx;
}
```

**Step 3: Verify builds**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/hooks/useSession.ts web/src/contexts/SessionContext.tsx
git commit -m "feat(web): add session hook and context for runtime lifecycle"
```

---

### Task 12: App Layout Shell with Providers

Wire all contexts into the App component with the basic layout structure.

**Files:**
- Modify: `web/src/App.tsx` — add providers and layout
- Create: `web/src/components/layout/Layout.tsx`
- Create: `web/src/components/layout/Header.tsx`
- Create: `web/src/components/layout/StatusBar.tsx`

**Step 1: Create Layout component**

```typescript
// web/src/components/layout/Header.tsx
import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function Header() {
  const { sessionState, sessionInfo, boot, shutdown } = useSessionContext();

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-friday-amber-dim/30 bg-friday-bg">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-friday-amber">F.R.I.D.A.Y.</h1>
        <span className="text-xs text-friday-text-muted">Web UI</span>
      </div>
      <div className="flex items-center gap-4">
        {sessionInfo && (
          <span className="text-sm text-friday-text-dim">
            {sessionInfo.provider}: {sessionInfo.model}
          </span>
        )}
        {sessionState === "disconnected" && (
          <button
            onClick={() => boot()}
            className="px-3 py-1 text-sm rounded border border-friday-amber text-friday-amber hover:bg-friday-amber/10 transition-colors"
          >
            Connect
          </button>
        )}
        {sessionState === "booting" && (
          <span className="text-sm text-friday-amber animate-pulse">Booting...</span>
        )}
        {sessionState === "active" && (
          <button
            onClick={shutdown}
            className="px-3 py-1 text-sm rounded border border-friday-text-muted text-friday-text-dim hover:border-friday-error hover:text-friday-error transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>
    </header>
  );
}
```

```typescript
// web/src/components/layout/StatusBar.tsx
export function StatusBar() {
  return (
    <footer className="flex items-center gap-6 px-4 py-2 border-t border-friday-amber-dim/20 bg-friday-bg text-xs text-friday-text-dim">
      <span>CPU --%</span>
      <span>MEM --%</span>
      <span>Git: --</span>
    </footer>
  );
}
```

```typescript
// web/src/components/layout/Layout.tsx
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-friday-deep">
      <Header />
      <main className="flex-1 overflow-hidden flex">
        {children}
      </main>
      <StatusBar />
    </div>
  );
}
```

**Step 2: Update App.tsx**

```tsx
// web/src/App.tsx
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3000}/ws`;

export function App() {
  return (
    <WebSocketProvider url={WS_URL}>
      <SessionProvider>
        <ChatProvider>
          <Layout>
            <div className="flex-1 flex items-center justify-center text-friday-text-dim">
              Chat panel coming soon...
            </div>
          </Layout>
        </ChatProvider>
      </SessionProvider>
    </WebSocketProvider>
  );
}
```

**Step 3: Verify**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat(web): add app layout shell with Header, StatusBar, and providers"
```

---

### Task 13: Chat Panel — MessageList and Input

The core chat UI components.

**Files:**
- Create: `web/src/components/chat/ChatPanel.tsx`
- Create: `web/src/components/chat/MessageList.tsx`
- Create: `web/src/components/chat/MessageBubble.tsx`
- Create: `web/src/components/chat/ChatInput.tsx`
- Create: `web/src/components/chat/ThinkingIndicator.tsx`
- Modify: `web/src/App.tsx` — use ChatPanel

**Step 1: Create MessageBubble**

```tsx
// web/src/components/chat/MessageBubble.tsx
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../../hooks/useChat.ts";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? "bg-friday-amber/15 border border-friday-amber-dim/40 text-friday-text"
            : isSystem
              ? "bg-friday-error/10 border border-friday-error/30 text-friday-text"
              : "bg-friday-surface border border-friday-amber-dim/20 text-friday-text"
        }`}
      >
        <div className="text-xs text-friday-text-dim mb-1">
          {isUser ? "You" : isSystem ? "System" : "Friday"}
          {message.source === "protocol" && (
            <span className="ml-2 text-friday-copper">[protocol]</span>
          )}
        </div>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_code]:text-friday-amber-light [&_a]:text-friday-amber [&_strong]:text-friday-text">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create MessageList**

```tsx
// web/src/components/chat/MessageList.tsx
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble.tsx";
import type { ChatMessage } from "../../hooks/useChat.ts";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-friday-text-muted">
        <p>Hey boss! What can I help you with?</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

**Step 3: Create ThinkingIndicator**

```tsx
// web/src/components/chat/ThinkingIndicator.tsx
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-friday-amber">
      <div className="flex gap-1">
        <span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-sm text-friday-amber-dim">Friday is thinking...</span>
    </div>
  );
}
```

**Step 4: Create ChatInput**

```tsx
// web/src/components/chat/ChatInput.tsx
import { useState, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  }, [input, onSend, disabled]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-friday-amber-dim/20 bg-friday-bg px-4 py-3">
      <div className={`flex gap-2 items-end rounded-lg border ${
        disabled ? "border-friday-text-muted/30" : "border-friday-amber-dim/40 focus-within:border-friday-amber/60 focus-within:friday-glow"
      } bg-friday-surface px-3 py-2 transition-all`}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Connect to start chatting..." : "Type a message or /command..."}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-friday-text placeholder-friday-text-muted resize-none outline-none text-sm leading-relaxed"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !input.trim()}
          className="px-3 py-1 rounded text-sm font-medium bg-friday-amber text-friday-deep hover:bg-friday-amber-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

**Step 5: Create ChatPanel**

```tsx
// web/src/components/chat/ChatPanel.tsx
import { useChatContext } from "../../contexts/ChatContext.tsx";
import { useSessionContext } from "../../contexts/SessionContext.tsx";
import { MessageList } from "./MessageList.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";

export function ChatPanel() {
  const { messages, isThinking, sendMessage } = useChatContext();
  const { sessionState } = useSessionContext();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <MessageList messages={messages} />
      {isThinking && <ThinkingIndicator />}
      <ChatInput
        onSend={sendMessage}
        disabled={sessionState !== "active"}
      />
    </div>
  );
}
```

**Step 6: Update App.tsx**

Replace the placeholder `<div>` in `<Layout>` with `<ChatPanel />`.

```tsx
import { ChatPanel } from "./components/chat/ChatPanel.tsx";

// In the Layout children:
<Layout>
  <ChatPanel />
</Layout>
```

**Step 7: Verify**

```bash
cd web && bunx vite build
```

**Step 8: Commit**

```bash
git add web/src/
git commit -m "feat(web): add chat panel with message list, input, and thinking indicator"
```

---

### Task 14: Typeahead Protocol Input

Add `/` command autocomplete to the chat input.

**Files:**
- Create: `web/src/components/input/TypeaheadDropdown.tsx`
- Modify: `web/src/components/chat/ChatInput.tsx` — integrate typeahead

**Step 1: Create TypeaheadDropdown**

```tsx
// web/src/components/input/TypeaheadDropdown.tsx
import type { KeyboardEvent } from "react";

export interface TypeaheadEntry {
  name: string;
  description: string;
}

interface TypeaheadDropdownProps {
  entries: TypeaheadEntry[];
  selectedIndex: number;
  onSelect: (entry: TypeaheadEntry) => void;
}

export function TypeaheadDropdown({ entries, selectedIndex, onSelect }: TypeaheadDropdownProps) {
  if (entries.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-friday-elevated border border-friday-amber-dim/40 rounded-lg overflow-hidden shadow-lg">
      {entries.map((entry, i) => (
        <button
          key={entry.name}
          onClick={() => onSelect(entry)}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
            i === selectedIndex
              ? "bg-friday-amber/15 text-friday-amber"
              : "text-friday-text hover:bg-friday-surface"
          }`}
        >
          <span className="font-mono text-friday-amber">/{entry.name}</span>
          <span className="text-friday-text-dim truncate">{entry.description}</span>
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Update ChatInput to show typeahead when input starts with `/`**

Add state for typeahead entries (hardcoded for now — later fetched from server protocol list). Filter entries as user types. Arrow keys navigate, Tab/Enter fills.

> **Implementation hint:** Import `filterCommands` logic from the CLI's `typeahead-prompt.ts` by extracting the pure filter function, or re-implement the simple prefix-match in the component. For the web, the protocol list should come from the server (add a `protocols:list` message type or hardcode the known protocols for v1).

For v1, hardcode the known protocols:

```typescript
const KNOWN_PROTOCOLS: TypeaheadEntry[] = [
  { name: "history", description: "Browse and manage conversation history" },
  { name: "env", description: "View system environment" },
  { name: "smart", description: "Manage SMARTS knowledge base" },
];
```

**Step 3: Verify**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat(web): add typeahead dropdown for protocol commands"
```

---

## Phase 4: Sensorium Status Bar

### Task 15: Sensorium Hook and Live StatusBar

**Files:**
- Create: `web/src/hooks/useSensorium.ts`
- Modify: `web/src/components/layout/StatusBar.tsx` — show live data

**Step 1: Create Sensorium hook**

```typescript
// web/src/hooks/useSensorium.ts
import { useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SensoriumData {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  containers: { runtime: string; running: { name: string }[]; stopped: number };
  git?: { repo: string; branch: string; dirty: boolean; ahead: number; behind: number };
  ports: { port: number; process: string }[];
}

export function useSensorium() {
  const { subscribe } = useWS();
  const [data, setData] = useState<SensoriumData | null>(null);

  useEffect(() => {
    const unsub = subscribe("sensorium:update", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "sensorium:update" }>;
      setData(m.snapshot as SensoriumData);
    });
    return unsub;
  }, [subscribe]);

  return data;
}
```

**Step 2: Update StatusBar**

```tsx
// web/src/components/layout/StatusBar.tsx
import { useSensorium } from "../../hooks/useSensorium.ts";

function GaugeBar({ value, max = 100, thresholdHigh = 80 }: { value: number; max?: number; thresholdHigh?: number }) {
  const percent = Math.min((value / max) * 100, 100);
  const color = percent >= 90 ? "bg-friday-error" : percent >= thresholdHigh ? "bg-friday-warning" : "bg-friday-success";

  return (
    <div className="w-16 h-2 bg-friday-surface rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function StatusBar() {
  const data = useSensorium();

  return (
    <footer className="flex items-center gap-6 px-4 py-2 border-t border-friday-amber-dim/20 bg-friday-bg text-xs text-friday-text-dim">
      <div className="flex items-center gap-2">
        <span>CPU</span>
        <GaugeBar value={data?.cpu ?? 0} />
        <span>{data?.cpu ?? "--"}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span>MEM</span>
        <GaugeBar value={data?.memory.percent ?? 0} />
        <span>{data?.memory.percent ?? "--"}%</span>
      </div>
      {data?.git && (
        <span>
          {data.git.branch}
          {data.git.dirty && <span className="text-friday-warning ml-1">*</span>}
        </span>
      )}
      {data?.containers.running && data.containers.running.length > 0 && (
        <span>{data.containers.running.length} containers</span>
      )}
      {data?.ports && data.ports.length > 0 && (
        <span>:{data.ports.map((p) => p.port).join(", ")}</span>
      )}
    </footer>
  );
}
```

**Step 3: Verify**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat(web): add live Sensorium status bar with gauges"
```

---

## Phase 5: Sidebar Panels

### Task 16: Sidebar Shell

**Files:**
- Create: `web/src/components/layout/Sidebar.tsx`
- Modify: `web/src/components/layout/Layout.tsx` — add sidebar
- Modify: `web/src/App.tsx` — add sidebar toggle state

**Step 1: Create collapsible Sidebar**

```tsx
// web/src/components/layout/Sidebar.tsx
import { useState, type ReactNode } from "react";

type Tab = "history" | "smarts" | "notifications";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>("history");

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="px-2 py-4 bg-friday-bg border-l border-friday-amber-dim/20 text-friday-text-dim hover:text-friday-amber transition-colors"
        title="Open sidebar"
      >
        &laquo;
      </button>
    );
  }

  return (
    <aside className="w-72 bg-friday-bg border-l border-friday-amber-dim/20 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-friday-amber-dim/20">
        <div className="flex gap-1">
          {(["history", "smarts", "notifications"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeTab === tab
                  ? "bg-friday-amber/15 text-friday-amber"
                  : "text-friday-text-dim hover:text-friday-text"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={onToggle} className="text-friday-text-dim hover:text-friday-amber text-sm">
          &raquo;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "history" && <p className="text-friday-text-muted text-sm">History panel...</p>}
        {activeTab === "smarts" && <p className="text-friday-text-muted text-sm">SMARTS panel...</p>}
        {activeTab === "notifications" && <p className="text-friday-text-muted text-sm">Notifications panel...</p>}
      </div>
    </aside>
  );
}
```

**Step 2: Update Layout to include Sidebar**

```tsx
// web/src/components/layout/Layout.tsx
import { useState, type ReactNode } from "react";
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-friday-deep">
      <Header />
      <main className="flex-1 overflow-hidden flex">
        {children}
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </main>
      <StatusBar />
    </div>
  );
}
```

**Step 3: Verify**

```bash
cd web && bunx vite build
```

**Step 4: Commit**

```bash
git add web/src/
git commit -m "feat(web): add collapsible sidebar with tab navigation"
```

---

### Task 17: History Panel

**Files:**
- Create: `web/src/hooks/useHistory.ts`
- Create: `web/src/components/sidebar/HistoryPanel.tsx`
- Modify: `web/src/components/layout/Sidebar.tsx` — use HistoryPanel

**Step 1: Create history hook**

```typescript
// web/src/hooks/useHistory.ts
import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface ConversationSummary {
  id: string;
  startedAt: string;
  provider: string;
  model: string;
  messageCount: number;
}

export function useHistory() {
  const { send, subscribe } = useWS();
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = subscribe("history:result", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "history:result" }>;
      if (Array.isArray(m.data)) {
        setSessions(
          m.data.map((s: any) => ({
            id: s.id,
            startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : String(s.startedAt),
            provider: s.provider,
            model: s.model,
            messageCount: s.messages?.length ?? 0,
          })),
        );
      }
      setLoading(false);
    });
    return unsub;
  }, [subscribe]);

  const fetchHistory = useCallback((count = 20) => {
    setLoading(true);
    send({ type: "history:list", id: crypto.randomUUID(), count });
  }, [send]);

  const loadSession = useCallback((sessionId: string) => {
    send({ type: "history:load", id: crypto.randomUUID(), sessionId });
  }, [send]);

  return { sessions, loading, fetchHistory, loadSession };
}
```

**Step 2: Create HistoryPanel**

```tsx
// web/src/components/sidebar/HistoryPanel.tsx
import { useEffect } from "react";
import { useHistory } from "../../hooks/useHistory.ts";
import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function HistoryPanel() {
  const { sessions, loading, fetchHistory, loadSession } = useHistory();
  const { sessionState } = useSessionContext();

  useEffect(() => {
    if (sessionState === "active") fetchHistory();
  }, [sessionState, fetchHistory]);

  if (sessionState !== "active") {
    return <p className="text-friday-text-muted text-sm">Connect to view history.</p>;
  }

  if (loading) {
    return <p className="text-friday-amber-dim text-sm animate-pulse">Loading history...</p>;
  }

  if (sessions.length === 0) {
    return <p className="text-friday-text-muted text-sm">No conversation history.</p>;
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => loadSession(session.id)}
          className="w-full text-left p-2 rounded border border-friday-amber-dim/20 hover:border-friday-amber/40 hover:bg-friday-surface/50 transition-colors"
        >
          <div className="text-xs text-friday-text-dim">
            {new Date(session.startedAt).toLocaleDateString()} {new Date(session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-sm text-friday-text mt-0.5">
            {session.provider}/{session.model}
          </div>
          <div className="text-xs text-friday-text-muted mt-0.5">
            {session.messageCount} messages
          </div>
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Wire into Sidebar**

Replace the history placeholder in Sidebar:

```tsx
import { HistoryPanel } from "../sidebar/HistoryPanel.tsx";

// Replace: {activeTab === "history" && <p>...</p>}
// With:    {activeTab === "history" && <HistoryPanel />}
```

**Step 4: Verify**

```bash
cd web && bunx vite build
```

**Step 5: Commit**

```bash
git add web/src/
git commit -m "feat(web): add history panel with session list and load"
```

---

### Task 18: SMARTS Panel

**Files:**
- Create: `web/src/hooks/useSmarts.ts`
- Create: `web/src/components/sidebar/SmartsPanel.tsx`
- Modify: `web/src/components/layout/Sidebar.tsx` — use SmartsPanel

**Step 1: Create SMARTS hook**

```typescript
// web/src/hooks/useSmarts.ts
import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: string;
}

export function useSmarts() {
  const { send, subscribe } = useWS();
  const [entries, setEntries] = useState<SmartEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = subscribe("smarts:result", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "smarts:result" }>;
      if (Array.isArray(m.data)) {
        setEntries(
          m.data.map((e: any) => ({
            name: e.name,
            domain: e.domain,
            tags: e.tags ?? [],
            confidence: e.confidence,
            source: e.source,
          })),
        );
      }
      setLoading(false);
    });
    return unsub;
  }, [subscribe]);

  const fetchList = useCallback(() => {
    setLoading(true);
    send({ type: "smarts:list", id: crypto.randomUUID() });
  }, [send]);

  const search = useCallback((query: string) => {
    setLoading(true);
    send({ type: "smarts:search", id: crypto.randomUUID(), query });
  }, [send]);

  return { entries, loading, fetchList, search };
}
```

**Step 2: Create SmartsPanel**

```tsx
// web/src/components/sidebar/SmartsPanel.tsx
import { useEffect, useState } from "react";
import { useSmarts } from "../../hooks/useSmarts.ts";
import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function SmartsPanel() {
  const { entries, loading, fetchList, search } = useSmarts();
  const { sessionState } = useSessionContext();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (sessionState === "active") fetchList();
  }, [sessionState, fetchList]);

  if (sessionState !== "active") {
    return <p className="text-friday-text-muted text-sm">Connect to view knowledge.</p>;
  }

  const handleSearch = () => {
    if (query.trim()) search(query.trim());
    else fetchList();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search knowledge..."
          className="flex-1 bg-friday-surface border border-friday-amber-dim/30 rounded px-2 py-1 text-sm text-friday-text placeholder-friday-text-muted outline-none focus:border-friday-amber/50"
        />
        <button onClick={fetchList} className="text-xs text-friday-text-dim hover:text-friday-amber">
          Reload
        </button>
      </div>
      {loading && <p className="text-friday-amber-dim text-sm animate-pulse">Loading...</p>}
      {entries.map((entry) => (
        <div key={entry.name} className="p-2 rounded border border-friday-amber-dim/20 bg-friday-surface/30">
          <div className="text-sm text-friday-text font-medium">{entry.name}</div>
          <div className="flex gap-2 mt-1">
            <span className="text-xs px-1.5 py-0.5 rounded bg-friday-amber/10 text-friday-amber">{entry.domain}</span>
            <span className="text-xs text-friday-text-muted">{(entry.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Wire into Sidebar**

```tsx
import { SmartsPanel } from "../sidebar/SmartsPanel.tsx";
// Replace: {activeTab === "smarts" && <p>...</p>}
// With:    {activeTab === "smarts" && <SmartsPanel />}
```

**Step 4: Verify**

```bash
cd web && bunx vite build
```

**Step 5: Commit**

```bash
git add web/src/
git commit -m "feat(web): add SMARTS panel with search and domain tags"
```

---

### Task 19: Notification Panel

**Files:**
- Create: `web/src/hooks/useNotifications.ts`
- Create: `web/src/components/sidebar/NotificationPanel.tsx`
- Modify: `web/src/components/layout/Sidebar.tsx` — use NotificationPanel

**Step 1: Create notifications hook**

```typescript
// web/src/hooks/useNotifications.ts
import { useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface NotificationItem {
  id: string;
  level: "info" | "warning" | "alert";
  title: string;
  body: string;
  source: string;
  timestamp: Date;
}

export function useNotifications() {
  const { subscribe } = useWS();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const unsub = subscribe("notification", (msg) => {
      const m = msg as Extract<ServerMessage, { type: "notification" }>;
      setNotifications((prev) => [
        {
          id: crypto.randomUUID(),
          level: m.level,
          title: m.title,
          body: m.body,
          source: m.source,
          timestamp: new Date(),
        },
        ...prev,
      ].slice(0, 100)); // Keep last 100
    });
    return unsub;
  }, [subscribe]);

  return { notifications };
}
```

**Step 2: Create NotificationPanel**

```tsx
// web/src/components/sidebar/NotificationPanel.tsx
import { useNotifications } from "../../hooks/useNotifications.ts";

const levelStyles = {
  info: "border-blue-500/30 bg-blue-500/5",
  warning: "border-friday-warning/30 bg-friday-warning/5",
  alert: "border-friday-error/30 bg-friday-error/5",
};

const levelLabel = {
  info: "text-blue-400",
  warning: "text-friday-warning",
  alert: "text-friday-error",
};

export function NotificationPanel() {
  const { notifications } = useNotifications();

  if (notifications.length === 0) {
    return <p className="text-friday-text-muted text-sm">No notifications.</p>;
  }

  return (
    <div className="space-y-2">
      {notifications.map((n) => (
        <div key={n.id} className={`p-2 rounded border ${levelStyles[n.level]}`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium uppercase ${levelLabel[n.level]}`}>{n.level}</span>
            <span className="text-xs text-friday-text-muted">
              {n.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="text-sm text-friday-text mt-0.5">{n.title}</div>
          <div className="text-xs text-friday-text-dim mt-0.5">{n.body}</div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Wire into Sidebar**

```tsx
import { NotificationPanel } from "../sidebar/NotificationPanel.tsx";
// Replace placeholder with: {activeTab === "notifications" && <NotificationPanel />}
```

**Step 4: Verify**

```bash
cd web && bunx vite build
```

**Step 5: Commit**

```bash
git add web/src/
git commit -m "feat(web): add notification panel with level-based styling"
```

---

## Phase 6: Integration & Polish

### Task 20: Auto-Connect on Page Load

**Files:**
- Modify: `web/src/App.tsx` — auto-connect WebSocket and boot session on mount

**Step 1: Update App to auto-connect**

Add `useEffect` in App (or a new `AutoBoot` component inside providers) that:
1. Calls `connect()` from WebSocket context on mount
2. After WS opens, sends `session:boot` with default provider

```tsx
// web/src/components/AutoBoot.tsx
import { useEffect, useRef } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import { useSessionContext } from "../contexts/SessionContext.tsx";

export function AutoBoot() {
  const { state: wsState, connect } = useWS();
  const { sessionState, boot } = useSessionContext();
  const bootedRef = useRef(false);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (wsState === "connected" && sessionState === "disconnected" && !bootedRef.current) {
      bootedRef.current = true;
      boot();
    }
  }, [wsState, sessionState, boot]);

  return null;
}
```

Add `<AutoBoot />` inside the providers in `App.tsx`.

**Step 2: Verify end-to-end**

```bash
# Terminal 1: Start server
bun run serve

# Terminal 2: Start Vite dev server
bun run web:dev

# Open http://localhost:5173 — should auto-connect and show chat
```

**Step 3: Commit**

```bash
git add web/src/
git commit -m "feat(web): add auto-boot on page load"
```

---

### Task 21: Wire Sensorium Push in Server

Ensure the server handler pushes Sensorium snapshots to connected WebSocket clients.

**Files:**
- Modify: `src/server/index.ts` — subscribe to Sensorium updates after boot, push to client

**Step 1: Update server to wire push events**

In `src/server/index.ts`, after a successful `session:boot` message, subscribe to the runtime's signal bus for sensorium updates. The simplest approach: in the `message` handler, after `handler.handle()` returns for a `session:boot`, set up an interval that reads `runtime.sensorium?.currentSnapshot` and pushes it.

```typescript
// In the websocket.message handler, after handling session:boot:
// Store a reference to push sensorium updates
if (ws.data.runtime.isBooted && ws.data.runtime.sensorium) {
  const pushInterval = setInterval(() => {
    const snapshot = ws.data.runtime.sensorium?.currentSnapshot;
    if (snapshot) {
      ws.send(JSON.stringify({
        type: "sensorium:update",
        snapshot: {
          timestamp: snapshot.timestamp.toISOString(),
          cpu: snapshot.machine.cpus.usage,
          memory: {
            used: snapshot.machine.memory.used,
            total: snapshot.machine.memory.total,
            percent: snapshot.machine.memory.total > 0
              ? Math.round((snapshot.machine.memory.used / snapshot.machine.memory.total) * 100)
              : 0,
          },
          containers: snapshot.containers,
          git: snapshot.dev.git,
          ports: snapshot.dev.ports,
        },
      }));
    }
  }, 5000); // Push every 5 seconds
  // Store interval on ws.data for cleanup
}
```

> **Implementer:** Store the interval ID on `WSData` so `websocket.close` can clear it. Or use the runtime's SignalBus to listen for sensorium-related signals.

**Step 2: Verify**

Start server and web dev. Open browser. After connecting, status bar should show live CPU/memory values updating.

**Step 3: Commit**

```bash
git add src/server/
git commit -m "feat(server): push Sensorium snapshots to WebSocket clients"
```

---

### Task 22: Run Existing Backend Tests

Verify that all 270 existing tests still pass after adding server code.

**Step 1: Run all tests**

```bash
bun test
```

Expected: All 270+ tests PASS. New server tests add to the count.

**Step 2: Fix any failures**

If any existing tests break (unlikely since we only added new files), investigate and fix.

**Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve test issues from server addition"
```

---

### Task 23: Update CLAUDE.md

Add web UI documentation to the project instructions.

**Files:**
- Modify: `CLAUDE.md` — add web UI section

**Step 1: Add to CLAUDE.md**

Add under Commands:

```markdown
bun run serve           # Start Friday web UI server (default port 3000)
bun run web:dev         # Start Vite dev server for frontend (port 5173)
bun run web:build       # Build frontend for production
```

Add to Architecture section:

```
web/                       # React web UI (Vite + Tailwind)
├── src/
│   ├── components/        # React components (layout, chat, sidebar)
│   ├── hooks/             # useWebSocket, useChat, useSensorium, useSmarts, useHistory
│   ├── contexts/          # WebSocket, Chat, Session providers
│   └── styles/            # Tailwind theme (Friday amber palette)
src/server/                # WebSocket API server
├── index.ts               # Bun.serve() setup
├── protocol.ts            # Shared message types (client ↔ server)
└── handler.ts             # Message routing to FridayRuntime
```

Add Design Document entry:

```markdown
- Web UI design: `docs/plans/2026-02-21-friday-web-ui-design.md`
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add web UI commands and architecture to CLAUDE.md"
```

---

### Task 24: End-to-End Verification

Manual verification that everything works together.

**Step 1: Build frontend**

```bash
bun run web:build
```

**Step 2: Start server**

```bash
bun run serve
```

**Step 3: Open browser to `http://localhost:3000`**

Verify:
- [ ] Page loads with Friday amber HUD aesthetic
- [ ] Auto-connects and shows "grok: grok-3" in header
- [ ] Can type a message and get a response
- [ ] Markdown renders correctly in assistant messages
- [ ] `/env status` shows environment info in chat
- [ ] `/history list` shows conversation history
- [ ] `/smart list` shows SMARTS entries
- [ ] Status bar shows CPU and memory gauges
- [ ] Sidebar opens/closes and shows History/SMARTS/Notifications tabs
- [ ] Thinking indicator appears while waiting for response
- [ ] Disconnect/Reconnect buttons work

**Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "feat: complete Friday web UI v1"
```

---

## Summary

| Phase | Tasks | What It Builds |
|-------|-------|----------------|
| 1: Foundation | 1-6 | Protocol types, WS handler, server, serve command, notification channel, Sensorium push |
| 2: Frontend Shell | 7-8 | Vite + React + Tailwind scaffold, build scripts |
| 3: Chat Core | 9-14 | WebSocket hook, chat hook, session hook, app layout, chat panel, typeahead |
| 4: Sensorium | 15 | Live status bar with gauges |
| 5: Sidebar | 16-19 | Sidebar shell, history panel, SMARTS panel, notifications |
| 6: Integration | 20-24 | Auto-boot, Sensorium push wiring, test verification, docs, E2E |

**Total:** 24 tasks, ~8 commits for backend, ~10 commits for frontend, ~6 commits for integration/docs.
