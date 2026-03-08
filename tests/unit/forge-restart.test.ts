import { describe, test, expect } from "bun:test";
import { forgeRestart } from "../../src/modules/forge/restart.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const stubMemory = {
  get: async <T>(key: string): Promise<T | undefined> => {
    if (key === "validation:test-mod") return { moduleName: "test-mod", validatedAt: "2026-01-01" } as T;
    return undefined;
  },
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

function makeContext(): ToolContext {
  return {
    workingDirectory: "/tmp",
    audit: new AuditLogger(),
    signal: new SignalBus(),
    memory: stubMemory,
  };
}

describe("forge_restart tool", () => {
  test("has correct name and clearance", () => {
    expect(forgeRestart.name).toBe("forge_restart");
    expect(forgeRestart.clearance).toContain("system");
    expect(forgeRestart.clearance).toContain("forge-modify");
  });

  test("requires reason parameter", async () => {
    const result = await forgeRestart.execute({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("reason");
  });

  test("emits forge-restart-requested signal on success", async () => {
    const context = makeContext();
    const signals = context.signal as SignalBus;
    let emitted = false;
    signals.on("custom:forge-restart-requested", () => {
      emitted = true;
    });

    const result = await forgeRestart.execute(
      { reason: "Load new module", moduleName: "test-mod" },
      context,
    );
    expect(result.success).toBe(true);
    expect(emitted).toBe(true);
    expect(result.output).toContain("Restart");
  });

  test("fails without moduleName", async () => {
    const result = await forgeRestart.execute(
      { reason: "Load new module" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("moduleName");
  });

  test("fails without validation receipt", async () => {
    const noReceiptMemory = {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    };
    const context = makeContext();
    const noReceiptCtx = { ...context, memory: noReceiptMemory };
    const result = await forgeRestart.execute(
      { reason: "Load", moduleName: "unvalidated" },
      noReceiptCtx,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("validation");
  });
});
