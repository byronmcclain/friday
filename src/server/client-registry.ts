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
