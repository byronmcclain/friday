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
  onConversationMessage?: (msg: Extract<ServerMessage, { type: "conversation:message" }>) => void;
  onAuditEntry?: (entry: Extract<ServerMessage, { type: "audit:entry" }>) => void;
  onToolExecuting?: (name: string, args: Record<string, unknown>) => void;
  onToolCompleted?: () => void;
  onNotification?: (msg: Extract<ServerMessage, { type: "notification" }>) => void;

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
        // Drain all pending callbacks with a connection-closed error
        for (const [, cb] of this.pendingCallbacks) {
          cb.onError(new Error("connection closed"));
        }
        this.pendingCallbacks.clear();
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

    try {
      while (!done) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          await new Promise<void>((r) => { resolveWait = r; });
        }
      }

      while (chunks.length > 0) {
        yield chunks.shift()!;
      }

      if (error) throw error;
    } finally {
      this.pendingCallbacks.delete(requestId);
    }
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

  /** Ask the server for its actual model name. */
  async identify(): Promise<{ model: string }> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(requestId, {
        onComplete: (msg) => {
          this.pendingCallbacks.delete(requestId);
          if (msg.type === "session:ready") {
            resolve({ model: msg.model });
          } else {
            resolve({ model: "unknown" });
          }
        },
        onError: (err) => {
          this.pendingCallbacks.delete(requestId);
          reject(err);
        },
      });

      this.send({ type: "session:identify", id: requestId, clientType: "tui" });
    });
  }

  /** Ask the server for its available protocol commands. */
  async listProtocols(): Promise<{ name: string; description: string; aliases?: string[] }[]> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(requestId, {
        onComplete: (msg) => {
          this.pendingCallbacks.delete(requestId);
          if (msg.type === "session:protocols") {
            resolve(msg.protocols);
          } else {
            resolve([]);
          }
        },
        onError: (err) => {
          this.pendingCallbacks.delete(requestId);
          reject(err);
        },
      });

      this.send({ type: "session:list-protocols", id: requestId });
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
    // Handle push messages (no requestId)
    if (msg.type === "conversation:message") {
      this.onConversationMessage?.(msg);
      return;
    }
    if (msg.type === "audit:entry") {
      this.onAuditEntry?.(msg);
      return;
    }
    if (msg.type === "notification") {
      this.onNotification?.(msg);
      return;
    }
    if (msg.type === "signal") {
      if (msg.name === "tool:executing") {
        this.onToolExecuting?.(msg.source, (msg.data?.args as Record<string, unknown>) ?? {});
      } else if (msg.name === "tool:completed") {
        this.onToolCompleted?.();
      }
      return;
    }

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
      case "session:protocols":
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
