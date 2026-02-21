import { describe, test, expect } from "bun:test";
import { SYSTEM_PROMPT } from "../../src/core/prompts.ts";
import { FridayCore } from "../../src/core/friday.ts";

describe("Friday Core", () => {
  test("system prompt is defined and non-empty", () => {
    expect(SYSTEM_PROMPT).toBeDefined();
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(SYSTEM_PROMPT).toContain("Friday");
  });

  test("defaults to anthropic provider", () => {
    const friday = new FridayCore();
    expect(friday.providerName).toBe("anthropic");
  });

  test("defaults to claude-sonnet-4-20250514 model", () => {
    const friday = new FridayCore();
    expect(friday.modelName).toBe("claude-sonnet-4-20250514");
  });

  test("accepts custom model", () => {
    const friday = new FridayCore({ model: "claude-haiku-4-5-20251001" });
    expect(friday.modelName).toBe("claude-haiku-4-5-20251001");
  });
});
