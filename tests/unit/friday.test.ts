import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";
import { Cortex } from "../../src/core/cortex.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { stubProvider, grokStub, textResponse, createMockModel } from "../helpers/stubs.ts";

describe("Cortex", () => {
  test("system prompt is defined and non-empty", () => {
    expect(GENESIS_TEMPLATE).toBeDefined();
    expect(GENESIS_TEMPLATE.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(GENESIS_TEMPLATE).toContain("Friday");
  });

  test("defaults to grok provider", () => {
    const cortex = new Cortex({ injectedModel: createMockModel(), provider: "grok" });
    expect(cortex.providerName).toBe("grok");
  });

  test("defaults to grok-4-1-fast-reasoning-latest model", () => {
    const cortex = new Cortex({ injectedModel: createMockModel(), provider: "grok" });
    expect(cortex.modelName).toBe(PROVIDER_DEFAULTS.grok.model);
  });

  test("accepts custom model", () => {
    const cortex = new Cortex({ injectedModel: createMockModel(), model: "claude-haiku-4-5-20251001" });
    expect(cortex.modelName).toBe("claude-haiku-4-5-20251001");
  });

  test("exposes available tools (empty by default)", () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    expect(cortex.availableTools).toEqual([]);
  });

  test("registers tools", () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
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

  test("setHistory seeds conversation history", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    cortex.setHistory([
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ]);
    expect(cortex.historyLength).toBe(2);
    const history = cortex.getHistory();
    expect(history[0]!.content).toBe("Previous question");
    expect(history[1]!.content).toBe("Previous answer");
  });

  test("chat error rolls back history", async () => {
    const failingProvider: LLMProvider = {
      name: "failing",
      defaultModel: "fail-model",
      defaultFastModel: "fail-fast",
      chat: async () => { throw new Error("API error"); },
    };
    const cortex = new Cortex({ injectedProvider: failingProvider });
    expect(cortex.historyLength).toBe(0);
    try {
      await cortex.chat("hello");
    } catch {}
    expect(cortex.historyLength).toBe(0);
  });

  test("uses genesisPrompt when provided", async () => {
    let capturedPrompt = "";
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (systemPrompt) => {
        capturedPrompt = systemPrompt;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      genesisPrompt: "You are a custom identity.",
    });
    await cortex.chat("Hello");
    expect(capturedPrompt).toContain("You are a custom identity.");
    expect(capturedPrompt).not.toContain("Female Replacement Intelligent Digital Assistant Youth");
  });
});

describe("Cortex — truncation warning", () => {
  test("appends truncation warning when response is truncated", async () => {
    const truncatingProvider: LLMProvider = {
      name: "stub",
      defaultModel: "stub-model",
      defaultFastModel: "stub-fast",
      chat: async () => ({ type: "text" as const, text: "partial output", truncated: true }),
    };
    const cortex = new Cortex({ injectedProvider: truncatingProvider });
    const result = await cortex.chat("tell me everything");

    expect(result).toContain("partial output");
    expect(result).toContain("[Response truncated");
  });

  test("does not append truncation warning on normal response", async () => {
    const normalProvider: LLMProvider = {
      name: "stub",
      defaultModel: "stub-model",
      defaultFastModel: "stub-fast",
      chat: async () => ({ type: "text" as const, text: "full output", truncated: false }),
    };
    const cortex = new Cortex({ injectedProvider: normalProvider });
    const result = await cortex.chat("hello");

    expect(result).toBe("full output");
    expect(result).not.toContain("[Response truncated");
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
    defaultFastModel: "capture-fast",
    chat: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return textResponse("response with smarts");
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

  test("includes base GENESIS_TEMPLATE in enriched prompt", async () => {
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
    expect(capturedPrompt).toContain(GENESIS_TEMPLATE);
    expect(capturedPrompt).not.toContain("Active Knowledge");
    // Without sensorium, falls back to a standalone Current Time section
    expect(capturedPrompt).toContain("## Current Time");
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

describe("Cortex — Sensorium integration", () => {
  test("system prompt includes environment context when sensorium provided", async () => {
    const { Sensorium } = await import("../../src/sensorium/sensorium.ts");
    const { SignalBus } = await import("../../src/core/events.ts");
    const { NotificationManager } = await import(
      "../../src/core/notifications.ts"
    );
    const { SENSORIUM_DEFAULTS } = await import(
      "../../src/sensorium/types.ts"
    );

    const sensorium = new Sensorium({
      config: SENSORIUM_DEFAULTS,
      signals: new SignalBus(),
      notifications: new NotificationManager(),
    });
    await sensorium.poll();

    let capturedPrompt = "";
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (systemPrompt) => {
        capturedPrompt = systemPrompt;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      sensorium,
    });
    await cortex.chat("Hello");

    expect(capturedPrompt).toContain("[ENVIRONMENT]");
    expect(capturedPrompt).toContain("cores");
  });

  test("works without sensorium (backwards compatible)", async () => {
    let capturedPrompt = "";
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (systemPrompt) => {
        capturedPrompt = systemPrompt;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({ injectedProvider: capturingProvider });
    await cortex.chat("Hello");

    expect(capturedPrompt).not.toContain("[ENVIRONMENT]");
  });
});

const PAYLOAD_LOG = "/tmp/test/last-inference-payload.log";
const RESPONSE_LOG = "/tmp/test/last-inference-response.log";

describe("Cortex — debug inference logging", () => {
  afterEach(async () => {
    await unlink(PAYLOAD_LOG).catch(() => {});
    await unlink(RESPONSE_LOG).catch(() => {});
  });

  test("clears payload and response logs at start of chat()", async () => {
    await Bun.write(PAYLOAD_LOG, "STALE PAYLOAD");
    await Bun.write(RESPONSE_LOG, "STALE RESPONSE");

    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    const payload = await Bun.file(PAYLOAD_LOG).text();
    const response = await Bun.file(RESPONSE_LOG).text();
    expect(payload).not.toContain("STALE PAYLOAD");
    expect(response).not.toContain("STALE RESPONSE");
  });

  test("does NOT write logs when debug is false", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: false,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("does NOT write logs when debug is true but no projectRoot", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("passes debug options to provider chat() call", async () => {
    let capturedOptions: unknown;
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (_sys, _msgs, opts) => {
        capturedOptions = opts;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      debug: true,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    expect(capturedOptions).toBeDefined();
    const opts = capturedOptions as { debug?: { payloadPath: string; responsePath: string; round: number } };
    expect(opts.debug).toBeDefined();
    expect(opts.debug!.payloadPath).toBe("/tmp/test/last-inference-payload.log");
    expect(opts.debug!.responsePath).toBe("/tmp/test/last-inference-response.log");
    expect(opts.debug!.round).toBe(1);
  });

  test("retains debug:system-prompt audit entry", async () => {
    const { AuditLogger } = await import("../../src/audit/logger.ts");
    const audit = new AuditLogger();

    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
      projectRoot: "/tmp/test",
      audit,
    });
    await cortex.chat("Hello");

    const entries = audit.entries({ action: "debug:system-prompt" });
    expect(entries).toHaveLength(1);
  });

  test("does not pass debug to provider when debug is false", async () => {
    let capturedOptions: unknown;
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (_sys, _msgs, opts) => {
        capturedOptions = opts;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      debug: false,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    const opts = capturedOptions as { debug?: unknown };
    expect(opts.debug).toBeUndefined();
  });
});
