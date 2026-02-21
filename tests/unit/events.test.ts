import { describe, test, expect, mock } from "bun:test";
import { SignalBus } from "../../src/core/events.ts";
import type { Signal, SignalName } from "../../src/core/events.ts";

describe("SignalBus", () => {
  test("emits a signal to registered listeners", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("session:start", handler);
    await bus.emit("session:start", "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("passes signal data to handler", async () => {
    const bus = new SignalBus();
    let received: Signal | undefined;
    bus.on("file:changed", (signal) => { received = signal; });
    await bus.emit("file:changed", "test", { path: "/foo.ts" });
    expect(received?.name).toBe("file:changed");
    expect(received?.source).toBe("test");
    expect(received?.data?.path).toBe("/foo.ts");
  });

  test("supports multiple listeners on same signal", async () => {
    const bus = new SignalBus();
    const h1 = mock(() => {});
    const h2 = mock(() => {});
    bus.on("test:passed", h1);
    bus.on("test:passed", h2);
    await bus.emit("test:passed", "test");
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test("off() removes a listener", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("session:end", handler);
    bus.off("session:end", handler);
    await bus.emit("session:end", "test");
    expect(handler).not.toHaveBeenCalled();
  });

  test("once() fires only once", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.once("error:unhandled", handler);
    await bus.emit("error:unhandled", "test");
    await bus.emit("error:unhandled", "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("supports custom signal names", async () => {
    const bus = new SignalBus();
    const handler = mock(() => {});
    bus.on("custom:my-event" as SignalName, handler);
    await bus.emit("custom:my-event" as SignalName, "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("failing handler does not prevent others from running", async () => {
    const bus = new SignalBus();
    const h1 = mock(() => { throw new Error("boom"); });
    const h2 = mock(() => {});
    bus.on("file:changed", h1);
    bus.on("file:changed", h2);
    await bus.emit("file:changed", "test");
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
