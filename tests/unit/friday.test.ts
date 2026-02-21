import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SYSTEM_PROMPT } from "../../src/core/prompts.ts";
import { Cortex } from "../../src/core/cortex.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";

const stubProvider: LLMProvider = {
  name: "stub",
  defaultModel: "stub-model",
  chat: async () => "stub response",
};

const grokStub: LLMProvider = {
  name: "grok",
  defaultModel: "grok-4-1-fast-reasoning-latest",
  chat: async () => "grok response",
};

describe("Cortex", () => {
  test("system prompt is defined and non-empty", () => {
    expect(SYSTEM_PROMPT).toBeDefined();
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(SYSTEM_PROMPT).toContain("Friday");
  });

  test("defaults to grok provider", () => {
    const cortex = new Cortex({ injectedProvider: grokStub });
    expect(cortex.providerName).toBe("grok");
  });

  test("defaults to grok-4-1-fast-reasoning-latest model", () => {
    const cortex = new Cortex({ injectedProvider: grokStub });
    expect(cortex.modelName).toBe("grok-4-1-fast-reasoning-latest");
  });

  test("accepts custom model", () => {
    const cortex = new Cortex({ injectedProvider: stubProvider, model: "claude-haiku-4-5-20251001" });
    expect(cortex.modelName).toBe("claude-haiku-4-5-20251001");
  });

  test("exposes available tools (empty by default)", () => {
    const cortex = new Cortex({ injectedProvider: stubProvider });
    expect(cortex.availableTools).toEqual([]);
  });

  test("registers tools", () => {
    const cortex = new Cortex({ injectedProvider: stubProvider });
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

const TEST_DB_CORTEX = "/tmp/friday-test-cortex-smarts.db";
const TEST_SMARTS_DIR_CORTEX = "/tmp/friday-test-cortex-smarts";

const SECURITY_SMART_FIXTURE = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Validate all input.`;

describe("Cortex — SMARTS integration", () => {
  let capturedPrompt: string;
  const capturingProvider: LLMProvider = {
    name: "capturing",
    defaultModel: "capture-model",
    chat: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return "response with smarts";
    },
  };

  let smartsStore: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    capturedPrompt = "";
    await mkdir(TEST_SMARTS_DIR_CORTEX, { recursive: true });
    await writeFile(`${TEST_SMARTS_DIR_CORTEX}/security-basics.md`, SECURITY_SMART_FIXTURE);
    memory = new SQLiteMemory(TEST_DB_CORTEX);
    smartsStore = new SmartsStore();
    await smartsStore.initialize(
      { smartsDir: TEST_SMARTS_DIR_CORTEX, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB_CORTEX),
      unlink(`${TEST_DB_CORTEX}-wal`),
      unlink(`${TEST_DB_CORTEX}-shm`),
      rm(TEST_SMARTS_DIR_CORTEX, { recursive: true }),
    ]);
  });

  test("enriches system prompt with relevant SMARTS", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    await cortex.chat("How do I prevent XSS attacks?");
    expect(capturedPrompt).toContain("Active Knowledge");
    expect(capturedPrompt).toContain("Security Basics");
  });

  test("includes base SYSTEM_PROMPT in enriched prompt", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    await cortex.chat("How do I prevent XSS attacks?");
    expect(capturedPrompt).toContain("You are Friday");
  });

  test("works without smartsStore (backwards compatible)", async () => {
    const cortex = new Cortex({ injectedProvider: capturingProvider });
    await cortex.chat("Hello");
    expect(capturedPrompt).toBe(SYSTEM_PROMPT);
    expect(capturedPrompt).not.toContain("Active Knowledge");
  });

  test("pinned SMARTS are always included", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    cortex.pinSmart("security-basics");
    await cortex.chat("Tell me about Bun");
    expect(capturedPrompt).toContain("Security Basics");
  });

  test("unpinSmart removes a pin", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    cortex.pinSmart("security-basics");
    cortex.unpinSmart("security-basics");
    await cortex.chat("Tell me about cooking");
    expect(capturedPrompt).not.toContain("Security Basics");
  });
});
