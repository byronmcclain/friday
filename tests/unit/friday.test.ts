import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { GROK_DEFAULTS } from "../../src/providers/index.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createMockModel, createErrorModel } from "../helpers/stubs.ts";

/** Extract the system prompt string from a mock model's recorded doStreamCalls */
function getSystemPrompt(model: ReturnType<typeof createMockModel>): string {
	const call = model.doStreamCalls[0];
	if (!call) throw new Error("No doStreamCalls recorded");
	const systemPart = (call.prompt as Array<{ role: string; content: string }>).find(
		(p) => p.role === "system",
	);
	return systemPart?.content ?? "";
}

describe("Cortex", () => {
  test("system prompt is defined and non-empty", () => {
    expect(GENESIS_TEMPLATE).toBeDefined();
    expect(GENESIS_TEMPLATE.length).toBeGreaterThan(0);
  });

  test("system prompt includes Friday's identity", () => {
    expect(GENESIS_TEMPLATE).toContain("Friday");
  });

  test("defaults to grok-4-1-fast-reasoning-latest model", () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    expect(cortex.modelName).toBe(GROK_DEFAULTS.model);
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
    const cortex = new Cortex({ injectedModel: createErrorModel() });
    expect(cortex.historyLength).toBe(0);
    try {
      await cortex.chat("hello");
    } catch {}
    expect(cortex.historyLength).toBe(0);
  });

  test("uses genesisPrompt when provided", async () => {
    const model = createMockModel();
    const cortex = new Cortex({
      injectedModel: model,
      genesisPrompt: "You are a custom identity.",
    });
    await cortex.chat("Hello");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain("You are a custom identity.");
    expect(systemPrompt).not.toContain("Female Replacement Intelligent Digital Assistant Youth");
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
  let smartsStore: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
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
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model, smartsStore });
    await cortex.chat("How do I prevent XSS attacks?");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain("Active Knowledge");
    expect(systemPrompt).toContain("Security Basics");
  });

  test("includes base GENESIS_TEMPLATE in enriched prompt", async () => {
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model, smartsStore });
    await cortex.chat("How do I prevent XSS attacks?");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain("You are Friday");
  });

  test("works without smartsStore (backwards compatible)", async () => {
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model });
    await cortex.chat("Hello");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain(GENESIS_TEMPLATE);
    expect(systemPrompt).not.toContain("Active Knowledge");
    expect(systemPrompt).toContain("## Current Time");
  });

  test("pinned SMARTS are always included", async () => {
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model, smartsStore });
    cortex.pinSmart("security-basics");
    await cortex.chat("Tell me about Bun");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain("Security Basics");
  });

  test("unpinSmart removes a pin", async () => {
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model, smartsStore });
    cortex.pinSmart("security-basics");
    cortex.unpinSmart("security-basics");
    await cortex.chat("Tell me about cooking");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).not.toContain("Security Basics");
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

    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model, sensorium });
    await cortex.chat("Hello");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).toContain("[ENVIRONMENT]");
    expect(systemPrompt).toContain("cores");
  });

  test("works without sensorium (backwards compatible)", async () => {
    const model = createMockModel();
    const cortex = new Cortex({ injectedModel: model });
    await cortex.chat("Hello");
    const systemPrompt = getSystemPrompt(model);
    expect(systemPrompt).not.toContain("[ENVIRONMENT]");
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
      injectedModel: createMockModel(),
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
      injectedModel: createMockModel(),
      debug: false,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("does NOT write logs when debug is true but no projectRoot", async () => {
    const cortex = new Cortex({
      injectedModel: createMockModel(),
      debug: true,
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("retains debug:system-prompt audit entry", async () => {
    const { AuditLogger } = await import("../../src/audit/logger.ts");
    const audit = new AuditLogger();

    const cortex = new Cortex({
      injectedModel: createMockModel(),
      debug: true,
      projectRoot: "/tmp/test",
      audit,
    });
    await cortex.chat("Hello");

    const entries = audit.entries({ action: "debug:system-prompt" });
    expect(entries).toHaveLength(1);
  });
});
