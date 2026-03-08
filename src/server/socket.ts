import { unlink, writeFile } from "node:fs/promises";
import type { FridayRuntime } from "../core/runtime.ts";
import { parseClientMessage, type ServerMessage } from "./protocol.ts";
import type { SessionHub } from "./session-hub.ts";
import type { SignalHandler } from "../core/events.ts";

const DEFAULT_SOCKET_PATH = `${process.env.HOME}/.friday/friday.sock`;
const DEFAULT_PID_PATH = `${process.env.HOME}/.friday/friday.pid`;

export class FridaySocketServer {
  private runtime: FridayRuntime;
  private hub: SessionHub;
  private socketPath: string;
  private pidPath: string;
  private server: ReturnType<typeof Bun.listen> | null = null;
  private socketClients = new Map<unknown, string>();
  private toolSignalHandler: SignalHandler | null = null;

  constructor(
    runtime: FridayRuntime,
    hub: SessionHub,
    socketPath = DEFAULT_SOCKET_PATH,
    pidPath = DEFAULT_PID_PATH,
  ) {
    this.runtime = runtime;
    this.hub = hub;
    this.socketPath = socketPath;
    this.pidPath = pidPath;
  }

  async start(): Promise<void> {
    // Clean up stale socket
    try { await unlink(this.socketPath); } catch {}

    // Write PID file
    await writeFile(this.pidPath, String(process.pid));

    // Broadcast audit entries to all connected clients via hub
    this.runtime.audit.onLog = (entry) => {
      if (this.hub.clientCount === 0) return;
      this.hub.broadcast({
        type: "audit:entry",
        action: entry.action,
        source: entry.source,
        detail: entry.detail,
        success: entry.success,
        timestamp: entry.timestamp.toISOString(),
      });
    };

    // Forward tool signals to connected clients for TUI thinking indicator
    if (this.runtime.signals) {
      this.toolSignalHandler = (signal) => {
        if (this.hub.clientCount === 0) return;
        this.hub.broadcast({
          type: "signal",
          name: signal.name,
          source: signal.source,
          data: signal.data,
        });
      };
      this.runtime.signals.on("tool:executing", this.toolSignalHandler);
      this.runtime.signals.on("tool:completed", this.toolSignalHandler);
    }

    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: (socket) => {
          const clientId = crypto.randomUUID();
          this.socketClients.set(socket, clientId);
        },
        data: (socket, data) => {
          const clientId = this.socketClients.get(socket);
          if (!clientId) return;

          // Newline-delimited JSON protocol
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            const msg = parseClientMessage(line);
            if (!msg) continue;

            const send = (response: ServerMessage) => {
              socket.write(JSON.stringify(response) + "\n");
            };

            void this.handleMessage(msg, send, clientId);
          }
        },
        close: (socket) => {
          const clientId = this.socketClients.get(socket);
          if (clientId) {
            void this.hub.unregisterClient(clientId);
            this.socketClients.delete(socket);
          }
        },
        error: (_socket, _error) => {
          // IPC error — log but don't crash
        },
      },
    });
  }

  async stop(): Promise<void> {
    this.runtime.audit.onLog = undefined;
    if (this.toolSignalHandler && this.runtime.signals) {
      this.runtime.signals.off("tool:executing", this.toolSignalHandler);
      this.runtime.signals.off("tool:completed", this.toolSignalHandler);
      this.toolSignalHandler = null;
    }
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
    clientId: string,
  ): Promise<void> {
    switch (msg.type) {
      case "session:identify": {
        this.hub.registerClient({
          id: clientId,
          clientType: msg.clientType,
          send,
          capabilities: new Set(["text"]),
        });
        send({
          type: "session:ready",
          requestId: msg.id,
          model: this.runtime.cortex.modelName,
          capabilities: ["text"],
        });
        break;
      }
      case "session:boot": {
        this.hub.registerClient({
          id: clientId,
          clientType: "chat",
          send,
          capabilities: new Set(["text"]),
        });
        send({
          type: "session:ready",
          requestId: msg.id,
          model: this.runtime.cortex.modelName,
          capabilities: ["text"],
        });
        break;
      }
      case "session:list-protocols": {
        const protocols = this.runtime.protocols.list().map((p) => ({
          name: p.name,
          description: p.description,
          aliases: p.aliases,
        }));
        send({
          type: "session:protocols",
          requestId: msg.id,
          protocols,
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
          this.hub.broadcast(
            { type: "conversation:message", role: "user", content: msg.content, source: "chat" },
            clientId,
          );
          break;
        }

        try {
          const stream = await this.runtime.cortex.chatStream(msg.content);

          this.hub.broadcast(
            { type: "conversation:message", role: "user", content: msg.content, source: "chat" },
            clientId,
          );

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

          this.hub.broadcast(
            { type: "conversation:message", role: "assistant", content: fullText, source: "chat" },
            clientId,
          );
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
      default: {
        send({
          type: "error",
          requestId: msg.id,
          code: "UNKNOWN_MESSAGE_TYPE",
          message: `Unhandled message type: ${msg.type}`,
        });
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
    process.kill(pid, 0);
    return true;
  } catch {
    try { await unlink(socketPath); } catch {}
    try { await unlink(pidPath); } catch {}
    return false;
  }
}

export { DEFAULT_SOCKET_PATH, DEFAULT_PID_PATH };
