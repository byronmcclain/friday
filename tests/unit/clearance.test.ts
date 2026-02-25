import { describe, test, expect } from "bun:test";
import { ClearanceManager } from "../../src/core/clearance.ts";
import type { ClearanceName } from "../../src/core/clearance.ts";

describe("ClearanceManager", () => {
  test("grants clearance when permission is in granted set", () => {
    const manager = new ClearanceManager(["read-fs", "git-read"]);
    const result = manager.check("read-fs");
    expect(result.granted).toBe(true);
  });

  test("denies clearance when permission is not granted", () => {
    const manager = new ClearanceManager(["read-fs"]);
    const result = manager.check("exec-shell");
    expect(result.granted).toBe(false);
    expect(result.reason).toContain("exec-shell");
  });

  test("checkAll passes when all permissions are granted", () => {
    const manager = new ClearanceManager(["read-fs", "write-fs", "git-read"]);
    const result = manager.checkAll(["read-fs", "git-read"]);
    expect(result.granted).toBe(true);
  });

  test("checkAll fails when any permission is missing", () => {
    const manager = new ClearanceManager(["read-fs"]);
    const result = manager.checkAll(["read-fs", "exec-shell"]);
    expect(result.granted).toBe(false);
    expect(result.reason).toContain("exec-shell");
  });

  test("grant adds a new clearance", () => {
    const manager = new ClearanceManager([]);
    manager.grant("network");
    expect(manager.check("network").granted).toBe(true);
  });

  test("revoke removes a clearance", () => {
    const manager = new ClearanceManager(["write-fs"]);
    manager.revoke("write-fs");
    expect(manager.check("write-fs").granted).toBe(false);
  });

  test("lists all granted clearances", () => {
    const manager = new ClearanceManager(["read-fs", "git-read"]);
    expect(manager.granted).toEqual(["read-fs", "git-read"]);
  });

  test("grants and checks forge-modify clearance", () => {
    const mgr = new ClearanceManager(["forge-modify"]);
    expect(mgr.check("forge-modify").granted).toBe(true);
  });

  test("supports email-send clearance", () => {
    const mgr = new ClearanceManager(["email-send"]);
    expect(mgr.check("email-send").granted).toBe(true);
  });

  test("denies email-send when not granted", () => {
    const mgr = new ClearanceManager(["network"]);
    const result = mgr.check("email-send");
    expect(result.granted).toBe(false);
  });
});
