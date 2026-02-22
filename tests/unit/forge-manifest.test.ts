import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-manifest";

describe("ForgeManifestManager", () => {
  let manager: ForgeManifestManager;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    manager = new ForgeManifestManager(TEST_FORGE_DIR);
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("load returns empty manifest when file does not exist", async () => {
    const manifest = await manager.load();
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.modules)).toHaveLength(0);
  });

  test("save and load round-trips", async () => {
    await manager.addModule("weather", "Weather lookups", "1.0.0", "User requested");
    const manifest = await manager.load();
    expect(manifest.modules.weather).toBeDefined();
    expect(manifest.modules.weather!.version).toBe("1.0.0");
    expect(manifest.modules.weather!.history).toHaveLength(1);
    expect(manifest.modules.weather!.history[0]!.action).toBe("created");
  });

  test("updateModule bumps version and adds history", async () => {
    await manager.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await manager.updateModule("weather", "1.1.0", "patched", "Fixed API key");
    const manifest = await manager.load();
    expect(manifest.modules.weather!.version).toBe("1.1.0");
    expect(manifest.modules.weather!.history).toHaveLength(2);
    expect(manifest.modules.weather!.history[1]!.action).toBe("patched");
  });

  test("getEntry returns undefined for unknown module", async () => {
    const entry = await manager.getEntry("nonexistent");
    expect(entry).toBeUndefined();
  });

  test("isProtected returns false by default", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "Initial");
    expect(await manager.isProtected("weather")).toBe(false);
  });

  test("setProtected marks module as protected", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "Initial");
    await manager.setProtected("weather", true);
    expect(await manager.isProtected("weather")).toBe(true);
  });

  test("listModules returns all module names", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "r1");
    await manager.addModule("slack", "Slack", "1.0.0", "r2");
    const names = await manager.listModules();
    expect(names).toContain("weather");
    expect(names).toContain("slack");
  });
});
