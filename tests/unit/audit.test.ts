import { describe, test, expect } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { AuditEntry } from "../../src/audit/types.ts";

describe("AuditLogger", () => {
  test("logs an entry and retrieves it", () => {
    const logger = new AuditLogger();
    logger.log({
      action: "tool:execute",
      source: "git-ops",
      detail: "Ran git status",
      success: true,
    });
    const entries = logger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("tool:execute");
    expect(entries[0]!.source).toBe("git-ops");
    expect(entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  test("stores multiple entries in order", () => {
    const logger = new AuditLogger();
    logger.log({ action: "protocol:execute", source: "core", detail: "first", success: true });
    logger.log({ action: "directive:fire", source: "core", detail: "second", success: false });
    const entries = logger.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.detail).toBe("first");
    expect(entries[1]!.detail).toBe("second");
  });

  test("filters entries by source", () => {
    const logger = new AuditLogger();
    logger.log({ action: "tool:execute", source: "git-ops", detail: "a", success: true });
    logger.log({ action: "tool:execute", source: "code-analysis", detail: "b", success: true });
    logger.log({ action: "tool:execute", source: "git-ops", detail: "c", success: true });
    const filtered = logger.entries({ source: "git-ops" });
    expect(filtered).toHaveLength(2);
  });

  test("evicts oldest entries when exceeding max capacity", () => {
    const logger = new AuditLogger();
    for (let i = 0; i < 10_001; i++) {
      logger.log({ action: `action-${i}`, source: "test", detail: "x", success: true });
    }
    const all = logger.entries();
    expect(all.length).toBe(10_000);
    expect(all[0]!.action).toBe("action-1");
  });

  test("clears all entries", () => {
    const logger = new AuditLogger();
    logger.log({ action: "tool:execute", source: "core", detail: "x", success: true });
    logger.clear();
    expect(logger.entries()).toHaveLength(0);
  });
});
