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
