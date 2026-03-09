import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { createForgeProtocol } from "../../src/modules/forge/protocol.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-protocol";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

const context: ProtocolContext = {
  workingDirectory: TEST_FORGE_DIR,
  audit: new AuditLogger(),
  signal: new SignalBus(),
  memory: stubMemory,
  tools: new Map(),
};

describe("/forge protocol", () => {
  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("protocol has correct name and aliases", () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    expect(protocol.name).toBe("forge");
    expect(protocol.aliases).toContain("workshop");
  });

  test("list returns empty when no modules", async () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "list" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("No forge modules");
  });

  test("list shows modules", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "list" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("weather");
  });

  test("status shows module detail", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "status weather" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("1.0.0");
  });

  test("history shows version history", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.updateModule("weather", "1.1.0", "patched", "Fixed bug");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "history weather" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("1.0.0");
    expect(result.summary).toContain("1.1.0");
  });

  test("protect marks module as protected", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    await protocol.execute({ rawArgs: "protect weather" }, context);
    expect(await mgr.isProtected("weather")).toBe(true);
  });

  test("unprotect removes protection", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.setProtected("weather", true);

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    await protocol.execute({ rawArgs: "unprotect weather" }, context);
    expect(await mgr.isProtected("weather")).toBe(false);
  });

  test("manifest dumps raw JSON", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "manifest" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain('"version"');
  });

  test("unknown subcommand directs to help", async () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "invalid" }, context);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("/forge help");
  });

  test("empty subcommand shows help screen", async () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("/forge list");
    expect(result.summary).toContain("/forge status <name>");
    expect(result.summary).toContain("/forge protect <name>");
    expect(result.summary).toContain("Alias: /workshop");
  });
});
