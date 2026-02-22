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
