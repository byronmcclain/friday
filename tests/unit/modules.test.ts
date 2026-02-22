import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validateModule, discoverForgeModules } from "../../src/modules/loader.ts";
import type { FridayModule } from "../../src/modules/types.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";

const validModule: FridayModule = {
  name: "test-module",
  description: "A test module",
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
};

describe("Module Validation", () => {
  test("accepts a valid module manifest", () => {
    const result = validateModule(validModule);
    expect(result.valid).toBe(true);
  });

  test("rejects module without name", () => {
    const mod = { ...validModule, name: "" };
    const result = validateModule(mod);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  test("rejects module without version", () => {
    const mod = { ...validModule, version: "" };
    const result = validateModule(mod);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("version");
  });
});

const TEST_FORGE_DIR = "/tmp/friday-test-forge-loader";

describe("Forge Module Discovery", () => {
  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("returns empty when forge dir does not exist", async () => {
    const result = await discoverForgeModules("/tmp/nonexistent-forge-dir-xyz");
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  test("loads a valid forge module", async () => {
    const modDir = `${TEST_FORGE_DIR}/good`;
    await mkdir(modDir, { recursive: true });
    await writeFile(
      `${modDir}/index.ts`,
      `export default {
        name: "good",
        description: "A good module",
        version: "1.0.0",
        tools: [],
        protocols: [],
        knowledge: [],
        triggers: [],
        clearance: [],
      };`,
    );

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.name).toBe("good");
    expect(result.failed).toHaveLength(0);
  });

  test("captures failure for broken module without crashing", async () => {
    const modDir = `${TEST_FORGE_DIR}/broken`;
    await mkdir(modDir, { recursive: true });
    await writeFile(`${modDir}/index.ts`, "export default {{{ syntax error");

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.name).toBe("broken");
    expect(result.failed[0]!.error).toBeDefined();
  });

  test("loads good modules and captures bad ones in same dir", async () => {
    const goodDir = `${TEST_FORGE_DIR}/good`;
    const badDir = `${TEST_FORGE_DIR}/bad`;
    await mkdir(goodDir, { recursive: true });
    await mkdir(badDir, { recursive: true });

    await writeFile(
      `${goodDir}/index.ts`,
      `export default {
        name: "good", description: "Good", version: "1.0.0",
        tools: [], protocols: [], knowledge: [], triggers: [], clearance: [],
      };`,
    );
    await writeFile(`${badDir}/index.ts`, "throw new Error('module broke');");

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });
});
