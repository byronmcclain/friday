import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, realpath } from "node:fs/promises";
import { fsWrite } from "../../src/modules/filesystem/write.ts";
import { fsDelete } from "../../src/modules/filesystem/delete.ts";
import { setProtectedPaths } from "../../src/modules/filesystem/containment.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

// Resolve /tmp symlink on macOS (/tmp -> /private/tmp)
let TEST_DIR = "/tmp/friday-test-genesis-fs";
let PROTECTED_PATH = `${TEST_DIR}/GENESIS.md`;

function makeContext(): ToolContext {
  return {
    workingDirectory: TEST_DIR,
    audit: new AuditLogger(),
    signal: new SignalBus(),
    memory: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    },
  };
}

describe("Genesis filesystem protection", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    // Resolve symlinks so containment checks work (macOS /tmp -> /private/tmp)
    TEST_DIR = await realpath(TEST_DIR);
    PROTECTED_PATH = `${TEST_DIR}/GENESIS.md`;
    await Bun.write(PROTECTED_PATH, "Protected content");
    setProtectedPaths([PROTECTED_PATH]);
  });

  afterEach(async () => {
    setProtectedPaths([]);
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("fs.write rejects writes to protected path", async () => {
    const result = await fsWrite.execute(
      { path: "GENESIS.md", content: "hacked" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("path is protected");
  });

  test("fs.write allows writes to non-protected paths", async () => {
    const result = await fsWrite.execute(
      { path: "normal.txt", content: "hello" },
      makeContext(),
    );
    expect(result.success).toBe(true);
  });

  test("fs.delete rejects deletion of protected path", async () => {
    const result = await fsDelete.execute(
      { path: "GENESIS.md" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("path is protected");
  });
});
