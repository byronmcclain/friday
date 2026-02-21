import { describe, test, expect } from "bun:test";
import { validateModule } from "../../src/modules/loader.ts";
import type { FridayModule } from "../../src/modules/types.ts";

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
