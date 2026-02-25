import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, chmod } from "node:fs/promises";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis-cli";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("friday genesis CLI", () => {
  beforeEach(async () => {
    await mkdir(TEST_GENESIS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
  });

  test("genesis init creates file from template", async () => {
    const { seedGenesis } = await import("../../src/core/genesis.ts");
    const created = await seedGenesis(TEST_GENESIS_PATH);
    expect(created).toBe(true);
    const content = await Bun.file(TEST_GENESIS_PATH).text();
    expect(content).toBe(GENESIS_TEMPLATE);
  });

  test("genesis check reports valid file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "Valid prompt");
    await chmod(TEST_GENESIS_PATH, 0o600);
    const { checkGenesis } = await import("../../src/core/genesis.ts");
    const result = await checkGenesis(TEST_GENESIS_PATH);
    expect(result.ok).toBe(true);
  });

  test("genesis check reports missing file", async () => {
    const { checkGenesis } = await import("../../src/core/genesis.ts");
    const result = await checkGenesis(`${TEST_GENESIS_DIR}/missing.md`);
    expect(result.ok).toBe(false);
  });
});
