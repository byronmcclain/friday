import { describe, test, expect, mock, beforeEach } from "bun:test";
import { DirectiveEngine } from "../../src/directives/engine.ts";
import { DirectiveStore } from "../../src/directives/store.ts";
import { SignalBus } from "../../src/core/events.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import type { FridayDirective } from "../../src/directives/types.ts";

describe("DirectiveEngine", () => {
  let store: DirectiveStore;
  let signals: SignalBus;
  let audit: AuditLogger;
  let clearance: ClearanceManager;
  let engine: DirectiveEngine;

  beforeEach(() => {
    store = new DirectiveStore();
    signals = new SignalBus();
    audit = new AuditLogger();
    clearance = new ClearanceManager(["read-fs", "exec-shell", "provider"]);
    engine = new DirectiveEngine({ store, signals, audit, clearance });
  });

  test("fires a directive when its signal triggers", async () => {
    const executed = mock(() => {});
    const directive: FridayDirective = {
      id: "d1",
      name: "on-file-change",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "file:changed" },
      action: { type: "prompt", prompt: "Analyze the change" },
      clearance: ["read-fs"],
      executionCount: 0,
    };
    store.add(directive);
    engine.onDirectiveAction(executed);
    engine.start();
    await signals.emit("file:changed", "test", { path: "/foo.ts" });
    expect(executed).toHaveBeenCalledTimes(1);
  });

  test("does not fire disabled directives", async () => {
    const executed = mock(() => {});
    store.add({
      id: "d1",
      name: "disabled",
      description: "Test",
      enabled: false,
      trigger: { type: "signal", signal: "file:changed" },
      action: { type: "prompt", prompt: "test" },
      clearance: [],
      executionCount: 0,
    });
    engine.onDirectiveAction(executed);
    engine.start();
    await signals.emit("file:changed", "test");
    expect(executed).not.toHaveBeenCalled();
  });

  test("blocks directive when clearance denied", async () => {
    const executed = mock(() => {});
    const restrictedClearance = new ClearanceManager([]);
    const restrictedEngine = new DirectiveEngine({
      store,
      signals,
      audit,
      clearance: restrictedClearance,
    });
    store.add({
      id: "d1",
      name: "needs-shell",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "test:failed" },
      action: { type: "tool", tool: "shell.exec" },
      clearance: ["exec-shell"],
      executionCount: 0,
    });
    restrictedEngine.onDirectiveAction(executed);
    restrictedEngine.start();
    await signals.emit("test:failed", "test");
    expect(executed).not.toHaveBeenCalled();
    expect(audit.entries().some((e) => !e.success)).toBe(true);
  });

  test("increments execution count", async () => {
    const directive: FridayDirective = {
      id: "d1",
      name: "counter",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "session:start" },
      action: { type: "prompt", prompt: "hello" },
      clearance: [],
      executionCount: 0,
    };
    store.add(directive);
    engine.onDirectiveAction(() => {});
    engine.start();
    await signals.emit("session:start", "test");
    expect(store.get("d1")?.executionCount).toBe(1);
  });

  test("does not increment count when handler throws", async () => {
    store.add({
      id: "d1",
      name: "failing",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "file:changed" },
      action: { type: "tool", tool: "bad-tool" },
      clearance: [],
      executionCount: 0,
    });
    engine.onDirectiveAction(() => { throw new Error("handler failed"); });
    engine.start();
    await signals.emit("file:changed", "test");
    expect(store.get("d1")?.executionCount).toBe(0);
    expect(audit.entries().some((e) => e.action === "directive:error")).toBe(true);
  });

  test("fires directive added after start with custom signal", async () => {
    const executed = mock(() => {});
    engine.onDirectiveAction(executed);
    engine.start();
    store.add({
      id: "d1",
      name: "deploy-watcher",
      description: "Test",
      enabled: true,
      trigger: { type: "signal", signal: "custom:deploy" },
      action: { type: "prompt", prompt: "deploy triggered" },
      clearance: [],
      executionCount: 0,
    });
    await signals.emit("custom:deploy", "test");
    expect(executed).toHaveBeenCalledTimes(1);
  });
});
