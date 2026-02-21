import { describe, test, expect } from "bun:test";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import type { FridayProtocol, ProtocolResult } from "../../src/modules/types.ts";

function makeProtocol(name: string, aliases: string[] = []): FridayProtocol {
  return {
    name,
    description: `${name} protocol`,
    aliases,
    parameters: [],
    clearance: [],
    execute: async (): Promise<ProtocolResult> => ({
      success: true,
      summary: `${name} done`,
    }),
  };
}

describe("ProtocolRegistry", () => {
  test("registers and retrieves a protocol by name", () => {
    const registry = new ProtocolRegistry();
    const proto = makeProtocol("deploy");
    registry.register(proto);
    expect(registry.get("deploy")).toBe(proto);
  });

  test("retrieves by alias", () => {
    const registry = new ProtocolRegistry();
    const proto = makeProtocol("security-scan", ["scan", "sec"]);
    registry.register(proto);
    expect(registry.get("scan")).toBe(proto);
    expect(registry.get("sec")).toBe(proto);
  });

  test("returns undefined for unknown protocol", () => {
    const registry = new ProtocolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("lists all registered protocols", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    registry.register(makeProtocol("scan"));
    const names = registry.list().map((p) => p.name);
    expect(names).toContain("deploy");
    expect(names).toContain("scan");
  });

  test("isProtocol detects /command syntax", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    expect(registry.isProtocol("/deploy")).toBe(true);
    expect(registry.isProtocol("/unknown")).toBe(false);
    expect(registry.isProtocol("just a message")).toBe(false);
  });

  test("parseProtocolInput extracts name and args", () => {
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol("deploy"));
    const parsed = registry.parseProtocolInput("/deploy --env production");
    expect(parsed?.name).toBe("deploy");
    expect(parsed?.rawArgs).toBe("--env production");
  });
});
