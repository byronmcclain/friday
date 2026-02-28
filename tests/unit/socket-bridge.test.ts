import { describe, test, expect } from "bun:test";
import { SocketBridge } from "../../src/core/bridges/socket.ts";

describe("SocketBridge", () => {
  test("isBooted returns false when not connected", () => {
    const bridge = new SocketBridge("/tmp/nonexistent.sock");
    expect(bridge.isBooted()).toBe(false);
  });
});
