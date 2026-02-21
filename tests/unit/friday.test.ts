import { describe, test, expect } from "bun:test";
import { SYSTEM_PROMPT } from "../../src/core/prompts.ts";
import { Cortex } from "../../src/core/cortex.ts";
import type { LLMProvider } from "../../src/providers/types.ts";

describe("Cortex", () => {
  test("system prompt is defined and non-empty", () => {
    expect(SYSTEM_PROMPT).toBeDefined();
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(SYSTEM_PROMPT).toContain("Friday");
  });

  test("defaults to anthropic provider", () => {
    const cortex = new Cortex();
    expect(cortex.providerName).toBe("anthropic");
  });

  test("defaults to claude-sonnet-4-20250514 model", () => {
    const cortex = new Cortex();
    expect(cortex.modelName).toBe("claude-sonnet-4-20250514");
  });

  test("accepts custom model", () => {
    const cortex = new Cortex({ model: "claude-haiku-4-5-20251001" });
    expect(cortex.modelName).toBe("claude-haiku-4-5-20251001");
  });

  test("exposes available tools (empty by default)", () => {
    const cortex = new Cortex();
    expect(cortex.availableTools).toEqual([]);
  });

  test("registers tools", () => {
    const cortex = new Cortex();
    cortex.registerTool({
      name: "test-tool",
      description: "A test tool",
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, output: "done" }),
    });
    expect(cortex.availableTools).toHaveLength(1);
    expect(cortex.availableTools[0]!.name).toBe("test-tool");
  });

  test("chat error rolls back history", async () => {
    const failingProvider: LLMProvider = {
      name: "failing",
      defaultModel: "fail-model",
      chat: async () => { throw new Error("API error"); },
    };
    const cortex = new Cortex({ injectedProvider: failingProvider });
    expect(cortex.historyLength).toBe(0);
    try {
      await cortex.chat("hello");
    } catch {}
    expect(cortex.historyLength).toBe(0);
  });
});
