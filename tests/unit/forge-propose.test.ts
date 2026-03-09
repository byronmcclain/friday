import { describe, test, expect } from "bun:test";
import { forgePropose } from "../../src/modules/forge/propose.ts";
import forgeModule from "../../src/modules/forge/index.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
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

describe("forge_propose tool", () => {
  test("has correct name and clearance", () => {
    expect(forgePropose.name).toBe("forge_propose");
    expect(forgePropose.clearance).toEqual([]);
  });

  test("does not expose files parameter to the LLM", () => {
    const paramNames = forgePropose.parameters.map((p) => p.name);
    expect(paramNames).not.toContain("files");
  });

  test("forge module does not declare provider clearance", () => {
    expect(forgeModule.clearance).not.toContain("provider");
  });

  test("create template includes type hints and example tool", async () => {
    const result = await forgePropose.execute(
      { action: "create", moduleName: "example-mod", description: "An example" },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("Example tool:");
    expect(result.output).toContain("FridayTool");
    expect(result.output).toContain("ToolContext");
    expect(result.output).toContain("ToolResult");
    expect(result.output).toContain("does NOT have a tools property");
    expect(result.output).toContain("artifacts");
  });

  test("requires action parameter", async () => {
    const result = await forgePropose.execute({ moduleName: "test", description: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("action");
  });

  test("requires moduleName parameter", async () => {
    const result = await forgePropose.execute({ action: "create", description: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("moduleName");
  });

  test("requires description parameter", async () => {
    const result = await forgePropose.execute({ action: "create", moduleName: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("description");
  });

  test("rejects invalid action", async () => {
    const result = await forgePropose.execute(
      { action: "delete", moduleName: "test", description: "test" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("action");
  });

  test("rejects module names with path separators", async () => {
    const result = await forgePropose.execute(
      { moduleName: "../core", description: "hack", files: [], action: "create" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("path separators");
  });

  test("generates proposal with unique ID and stores in memory", async () => {
    let storedKey = "";
    let storedValue: unknown;
    const trackingMemory = {
      ...stubMemory,
      set: async <T>(key: string, value: T): Promise<void> => {
        storedKey = key;
        storedValue = value;
      },
    };

    const result = await forgePropose.execute(
      {
        action: "create",
        moduleName: "weather",
        description: "Weather lookups via API",
      },
      { ...context, memory: trackingMemory },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.artifacts?.proposalId).toBeDefined();
    expect(storedKey).toContain("proposal:");
    expect(storedValue).toBeDefined();
  });
});
