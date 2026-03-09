import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { forgeValidate } from "../../src/modules/forge/validate.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-validate";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

describe("forge_validate tool", () => {
  let context: ToolContext;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    context = {
      workingDirectory: TEST_FORGE_DIR,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: stubMemory,
    };
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("has correct name and clearance", () => {
    expect(forgeValidate.name).toBe("forge_validate");
    expect(forgeValidate.clearance).toContain("exec-shell");
  });

  test("requires moduleName parameter", async () => {
    const result = await forgeValidate.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("moduleName");
  });

  test("fails if module directory does not exist", async () => {
    const result = await forgeValidate.execute(
      { moduleName: "nonexistent", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  test("passes import test for valid module", async () => {
    const modDir = `${TEST_FORGE_DIR}/good-mod`;
    await mkdir(modDir, { recursive: true });
    await Bun.write(
      `${modDir}/index.ts`,
      `export default {
        name: "good-mod",
        description: "A good module",
        version: "1.0.0",
        tools: [],
        protocols: [],
        knowledge: [],
        triggers: [],
        clearance: [],
      };`,
    );

    let storedReceipt: unknown;
    const receiptMemory = {
      ...stubMemory,
      set: async <T>(_key: string, value: T): Promise<void> => {
        storedReceipt = value;
      },
    };

    const result = await forgeValidate.execute(
      { moduleName: "good-mod", forgeDir: TEST_FORGE_DIR },
      { ...context, memory: receiptMemory },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("passed");
    expect(storedReceipt).toBeDefined();
  });

  test("auto-sanitizes HTML entities before validation", async () => {
    const modDir = `${TEST_FORGE_DIR}/entity-mod`;
    await mkdir(modDir, { recursive: true });
    await Bun.write(
      `${modDir}/index.ts`,
      `export default {
        name: "entity-mod",
        description: "Has HTML entities",
        version: "1.0.0",
        tools: [{
          name: "entity.test",
          description: "test",
          parameters: [],
          clearance: [],
          execute: async (args: Record&lt;string, unknown&gt;) =&gt; ({ success: true, output: "ok" }),
        }],
        protocols: [],
        knowledge: [],
        triggers: [],
        clearance: [],
      };`,
    );

    const result = await forgeValidate.execute(
      { moduleName: "entity-mod", forgeDir: TEST_FORGE_DIR },
      context,
    );

    // Should have auto-fixed the entities and passed import + manifest
    expect(result.output).toContain("Auto-fixed HTML entities");
    const content = await Bun.file(`${modDir}/index.ts`).text();
    expect(content).not.toContain("&lt;");
    expect(content).not.toContain("&gt;");
    expect(content).toContain("Record<string, unknown>");
  });

  test("fails import test for module with syntax error", async () => {
    const modDir = `${TEST_FORGE_DIR}/bad-mod`;
    await mkdir(modDir, { recursive: true });
    await Bun.write(`${modDir}/index.ts`, "export default {{{broken syntax");

    const result = await forgeValidate.execute(
      { moduleName: "bad-mod", forgeDir: TEST_FORGE_DIR },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("import");
  });
});
