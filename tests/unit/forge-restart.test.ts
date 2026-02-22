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

const context: ToolContext = {
  workingDirectory: "/tmp",
  audit: new AuditLogger(),
  signal: new SignalBus(),
  memory: stubMemory,
};

describe("forge_restart tool", () => {
  test("has correct name and clearance", () => {
    expect(forgeRestart.name).toBe("forge_restart");
    expect(forgeRestart.clearance).toContain("system");
    expect(forgeRestart.clearance).toContain("forge-modify");
  });

  test("requires reason parameter", async () => {
    const result = await forgeRestart.execute({}, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("reason");
  });

  test("sets restartRequested on the provided runtime ref", async () => {
    const runtimeRef = { restartRequested: false };
    const result = await forgeRestart.execute(
      { reason: "Load new module", moduleName: "test-mod", runtimeRef },
      context,
    );
    expect(result.success).toBe(true);
    expect(runtimeRef.restartRequested).toBe(true);
    expect(result.output).toContain("Restart");
  });

  test("fails without runtimeRef", async () => {
    const result = await forgeRestart.execute(
      { reason: "Load new module", moduleName: "test-mod" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("runtime");
  });

  test("fails without moduleName", async () => {
    const result = await forgeRestart.execute(
      { reason: "Load new module" },
      context,
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
    const noReceiptCtx = { ...context, memory: noReceiptMemory };
    const runtimeRef = { restartRequested: false };
    const result = await forgeRestart.execute(
      { reason: "Load", moduleName: "unvalidated", runtimeRef },
      noReceiptCtx,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("validation");
  });
});
