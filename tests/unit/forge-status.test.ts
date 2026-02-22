import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { forgeStatus } from "../../src/modules/forge/status.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-status";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

describe("forge_status tool", () => {
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
    expect(forgeStatus.name).toBe("forge_status");
    expect(forgeStatus.clearance).toContain("read-fs");
  });

  test("returns empty state when no modules exist", async () => {
    const result = await forgeStatus.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("No forge modules");
  });

  test("lists modules from manifest", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.addModule("slack", "Slack notifications", "1.0.0", "Initial");

    const result = await forgeStatus.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.output).toContain("slack");
  });

  test("shows detail for a specific module", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const result = await forgeStatus.execute(
      { forgeDir: TEST_FORGE_DIR, moduleName: "weather" },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.output).toContain("1.0.0");
  });
});
