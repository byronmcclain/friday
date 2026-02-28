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
