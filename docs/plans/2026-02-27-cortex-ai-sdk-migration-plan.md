# Cortex AI SDK Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Friday's hand-rolled provider layer and Cortex tool loop with the Vercel AI SDK, gaining unified multi-provider support, native streaming, token-budget history management, and structured observability.

**Architecture:** The Vercel AI SDK (`ai` + `@ai-sdk/xai` + `@ai-sdk/anthropic`) replaces `@anthropic-ai/sdk` and `openai`. Cortex's manual tool loop becomes a single `streamText()` call with `maxSteps`. A new `HistoryManager` tracks token usage and auto-summarizes old messages. Streaming flows to TUI and web via `chatStream()`.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK v4, `@ai-sdk/xai`, `@ai-sdk/anthropic`, Zod, bun:test

**Design doc:** `docs/plans/2026-02-27-cortex-ai-sdk-migration-design.md`

---

## Task 1: Install Dependencies & Verify Build

**Files:**
- Modify: `package.json`

**Step 1: Install new AI SDK packages**

Run:
```bash
bun add ai @ai-sdk/xai @ai-sdk/anthropic zod
```

**Step 2: Verify everything still compiles**

Run: `bun run typecheck`
Expected: PASS (new packages don't conflict with existing code yet)

**Step 3: Run existing tests**

Run: `bun test`
Expected: 956 pass (same as before — nothing changed yet)

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add Vercel AI SDK dependencies (ai, @ai-sdk/xai, @ai-sdk/anthropic, zod)"
```

---

## Task 2: Zod Schema Converter

**Files:**
- Create: `src/providers/schemas.ts`
- Test: `tests/unit/provider-schemas.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/provider-schemas.test.ts
import { describe, test, expect } from "bun:test";
import { toZodSchema } from "../../src/providers/schemas.ts";
import type { ToolParameter } from "../../src/modules/types.ts";

describe("toZodSchema", () => {
  test("converts string parameters", () => {
    const params: ToolParameter[] = [
      { name: "path", type: "string", description: "File path", required: true },
    ];
    const schema = toZodSchema(params);
    const result = schema.safeParse({ path: "/tmp/test" });
    expect(result.success).toBe(true);
  });

  test("rejects missing required parameters", () => {
    const params: ToolParameter[] = [
      { name: "path", type: "string", description: "File path", required: true },
    ];
    const schema = toZodSchema(params);
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("accepts missing optional parameters", () => {
    const params: ToolParameter[] = [
      { name: "limit", type: "number", description: "Max results", required: false, default: 10 },
    ];
    const schema = toZodSchema(params);
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("converts all parameter types", () => {
    const params: ToolParameter[] = [
      { name: "name", type: "string", description: "Name", required: true },
      { name: "count", type: "number", description: "Count", required: true },
      { name: "active", type: "boolean", description: "Active", required: true },
      { name: "items", type: "array", description: "Items", required: false },
      { name: "config", type: "object", description: "Config", required: false },
    ];
    const schema = toZodSchema(params);
    const result = schema.safeParse({
      name: "test",
      count: 42,
      active: true,
      items: [1, 2],
      config: { key: "val" },
    });
    expect(result.success).toBe(true);
  });

  test("includes descriptions in schema", () => {
    const params: ToolParameter[] = [
      { name: "path", type: "string", description: "The file path to read", required: true },
    ];
    const schema = toZodSchema(params);
    // Zod stores description on the shape — verify schema parses correctly
    expect(schema.shape.path).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/provider-schemas.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/schemas.ts
import { z } from "zod";
import type { ToolParameter } from "../modules/types.ts";

/**
 * Convert FridayTool ToolParameter[] to a Zod object schema
 * for use with the Vercel AI SDK tool() function.
 */
export function toZodSchema(params: ToolParameter[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of params) {
    let field: z.ZodTypeAny;

    switch (param.type) {
      case "string":
        field = z.string().describe(param.description);
        break;
      case "number":
        field = z.number().describe(param.description);
        break;
      case "boolean":
        field = z.boolean().describe(param.description);
        break;
      case "array":
        field = z.array(z.unknown()).describe(param.description);
        break;
      case "object":
        field = z.record(z.unknown()).describe(param.description);
        break;
    }

    if (!param.required) {
      field = field.optional();
      if (param.default !== undefined) {
        field = field.default(param.default);
      }
    }

    shape[param.name] = field;
  }

  return z.object(shape);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/provider-schemas.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/schemas.ts tests/unit/provider-schemas.test.ts
git commit -m "feat(providers): add Zod schema converter for AI SDK tool definitions"
```

---

## Task 3: Mock Model Test Helper

**Files:**
- Modify: `tests/helpers/stubs.ts`
- Test: `tests/unit/mock-model.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/mock-model.test.ts
import { describe, test, expect } from "bun:test";
import { createMockModel } from "../helpers/stubs.ts";
import { generateText } from "ai";

describe("createMockModel", () => {
  test("generates default text response", async () => {
    const model = createMockModel();
    const result = await generateText({
      model,
      prompt: "Hello",
    });
    expect(result.text).toBe("stub response");
  });

  test("generates custom text response", async () => {
    const model = createMockModel({ text: "custom reply" });
    const result = await generateText({
      model,
      prompt: "Hello",
    });
    expect(result.text).toBe("custom reply");
  });

  test("reports token usage", async () => {
    const model = createMockModel({ usage: { promptTokens: 50, completionTokens: 100 } });
    const result = await generateText({
      model,
      prompt: "Hello",
    });
    expect(result.usage.promptTokens).toBe(50);
    expect(result.usage.completionTokens).toBe(100);
  });

  test("streams text response", async () => {
    const model = createMockModel({ text: "streamed" });
    const { streamText } = await import("ai");
    const result = streamText({
      model,
      prompt: "Hello",
    });
    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
    }
    expect(text).toBe("streamed");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mock-model.test.ts`
Expected: FAIL — `createMockModel` not exported

**Step 3: Write the implementation**

Add to `tests/helpers/stubs.ts` — keep existing exports for backward compat during migration:

```typescript
// tests/helpers/stubs.ts
import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";
import type { LanguageModelV1, LanguageModelV1StreamPart } from "ai";

/** Helper to create a text ChatResponse */
export function textResponse(text: string): ChatResponse {
  return { type: "text", text, truncated: false };
}

// --- Legacy stubs (kept during migration, removed in Task 12) ---

export const stubProvider: LLMProvider = {
  name: "stub",
  defaultModel: "stub-model",
  defaultFastModel: "stub-fast-model",
  chat: async () => textResponse("stub response"),
};

export const grokStub: LLMProvider = {
  name: "grok",
  defaultModel: PROVIDER_DEFAULTS.grok.model,
  defaultFastModel: PROVIDER_DEFAULTS.grok.fastModel,
  chat: async () => textResponse("grok response"),
};

// --- New AI SDK mock model ---

export interface MockModelOptions {
  text?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  usage?: { promptTokens: number; completionTokens: number };
}

export function createMockModel(options: MockModelOptions = {}): LanguageModelV1 {
  const text = options.text ?? "stub response";
  const usage = options.usage ?? { promptTokens: 10, completionTokens: 20 };

  return {
    specificationVersion: "v1",
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json",

    doGenerate: async () => ({
      text,
      toolCalls: options.toolCalls?.map((tc, i) => ({
        toolCallType: "function" as const,
        toolCallId: `call_${i}`,
        toolName: tc.name,
        args: JSON.stringify(tc.args),
      })) ?? [],
      finishReason: "stop" as const,
      usage,
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),

    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          // Emit tool calls first if any
          if (options.toolCalls) {
            for (let i = 0; i < options.toolCalls.length; i++) {
              const tc = options.toolCalls[i]!;
              controller.enqueue({
                type: "tool-call",
                toolCallType: "function",
                toolCallId: `call_${i}`,
                toolName: tc.name,
                args: JSON.stringify(tc.args),
              });
            }
          }
          // Emit text
          controller.enqueue({ type: "text-delta", textDelta: text });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage,
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mock-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/helpers/stubs.ts tests/unit/mock-model.test.ts
git commit -m "test: add createMockModel helper for AI SDK LanguageModelV1"
```

---

## Task 4: Provider Layer — `createModel()`

**Files:**
- Modify: `src/providers/index.ts`
- Test: `tests/unit/provider-create-model.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/provider-create-model.test.ts
import { describe, test, expect } from "bun:test";
import { createModel, PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

describe("createModel", () => {
  test("creates xai model for grok provider", () => {
    const model = createModel("grok", PROVIDER_DEFAULTS.grok.model);
    expect(model.modelId).toContain("grok");
    expect(model.provider).toContain("xai");
  });

  test("creates anthropic model for anthropic provider", () => {
    const model = createModel("anthropic", PROVIDER_DEFAULTS.anthropic.model);
    expect(model.modelId).toContain("claude");
    expect(model.provider).toContain("anthropic");
  });

  test("throws for unknown provider", () => {
    expect(() => createModel("unknown" as any, "some-model")).toThrow("Unknown provider");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/provider-create-model.test.ts`
Expected: FAIL — `createModel` not exported

**Step 3: Write the implementation**

Replace `src/providers/index.ts`:

```typescript
// src/providers/index.ts
import type { ProviderName } from "../core/types.ts";
import type { LanguageModelV1 } from "ai";
import { xai } from "@ai-sdk/xai";
import { anthropic } from "@ai-sdk/anthropic";

// Re-export legacy types during migration (remove in Task 12)
export type { LLMProvider, ChatOptions, ChatResponse, ToolCallRequest, ToolDefinition } from "./types.ts";
export { toJsonSchema } from "./tool-schema.ts";

export const DEFAULT_PROVIDER: ProviderName = "grok";

export const PROVIDER_DEFAULTS: Record<ProviderName, { model: string; fastModel: string }> = {
  anthropic: { model: "claude-sonnet-4-20250514", fastModel: "claude-haiku-4-5-20251001" },
  grok: { model: "grok-4-1-fast-reasoning-latest", fastModel: "grok-4-1-fast-non-reasoning" },
};

/** Create an AI SDK LanguageModelV1 for the given provider and model ID */
export function createModel(provider: ProviderName, modelId: string): LanguageModelV1 {
  switch (provider) {
    case "grok":
      return xai(modelId);
    case "anthropic":
      return anthropic(modelId);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Legacy — keep during migration (remove in Task 12)
export { createProvider } from "./legacy.ts";
```

Also create `src/providers/legacy.ts` to preserve old code during migration:

```typescript
// src/providers/legacy.ts — temporary, removed in Task 12
import type { ProviderName } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GrokProvider } from "./grok.ts";
import type { LLMProvider } from "./types.ts";

export function createProvider(name: ProviderName): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "grok":
      return new GrokProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
```

**Step 4: Run tests**

Run: `bun test tests/unit/provider-create-model.test.ts`
Expected: PASS

Run: `bun test`
Expected: All existing tests still pass (legacy exports preserved)

**Step 5: Commit**

```bash
git add src/providers/index.ts src/providers/legacy.ts tests/unit/provider-create-model.test.ts
git commit -m "feat(providers): add createModel() for AI SDK, preserve legacy during migration"
```

---

## Task 5: ChatStream Type & HistoryManager

**Files:**
- Create: `src/core/stream-types.ts`
- Create: `src/core/history-manager.ts`
- Test: `tests/unit/history-manager.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/history-manager.test.ts
import { describe, test, expect } from "bun:test";
import { HistoryManager } from "../../src/core/history-manager.ts";

describe("HistoryManager", () => {
  test("push and toMessages returns messages", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "Hello" });
    hm.push({ role: "assistant", content: "Hi there" });
    const msgs = hm.toMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
  });

  test("pop removes last message", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "Hello" });
    hm.push({ role: "assistant", content: "Hi" });
    hm.pop();
    expect(hm.toMessages()).toHaveLength(1);
  });

  test("clear resets everything", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "Hello" });
    hm.clear();
    expect(hm.toMessages()).toHaveLength(0);
  });

  test("compact does nothing under budget", async () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "Hello" });
    await hm.compact();
    expect(hm.toMessages()).toHaveLength(1);
  });

  test("compact summarizes old messages when over budget", async () => {
    const summarizeFn = async () => "Summary of earlier conversation.";
    const hm = new HistoryManager({ maxTokens: 100, summarize: summarizeFn });

    // Push enough to exceed 100 token estimate (chars/4)
    for (let i = 0; i < 20; i++) {
      hm.push({ role: "user", content: `Message number ${i} with enough text to accumulate tokens` });
      hm.push({ role: "assistant", content: `Response number ${i} with sufficient length for testing` });
    }

    await hm.compact();
    const msgs = hm.toMessages();
    // Should have synthetic summary pair + recent messages
    expect(msgs[0]!.content).toContain("Summary of earlier conversation");
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs.length).toBeLessThan(40); // less than original 40
  });

  test("recordUsage calibrates token count", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "Hello" });
    hm.recordUsage(5000);
    expect(hm.tokenEstimate).toBe(5000);
  });

  test("setHistory replaces all messages", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "old" });
    hm.setHistory([
      { role: "user", content: "new1" },
      { role: "assistant", content: "new2" },
    ]);
    const msgs = hm.toMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toBe("new1");
  });

  test("length returns message count", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "a" });
    hm.push({ role: "assistant", content: "b" });
    expect(hm.length).toBe(2);
  });

  test("getHistory returns defensive copy", () => {
    const hm = new HistoryManager({ maxTokens: 100_000 });
    hm.push({ role: "user", content: "a" });
    const copy = hm.getHistory();
    copy.push({ role: "assistant", content: "injected" });
    expect(hm.toMessages()).toHaveLength(1); // original unchanged
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/history-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Write `ChatStream` type**

```typescript
// src/core/stream-types.ts

/** Streaming response from Cortex.chatStream() */
export interface ChatStream {
  /** Async iterable of text chunks as they arrive */
  textStream: AsyncIterable<string>;
  /** Resolves to the full text when streaming completes */
  fullText: Promise<string>;
  /** Resolves to token usage after completion */
  usage: Promise<{ promptTokens: number; completionTokens: number }>;
}
```

**Step 4: Write `HistoryManager`**

```typescript
// src/core/history-manager.ts
import type { CoreMessage } from "ai";

/** Function signature for the summarize callback */
export type SummarizeFn = (messages: CoreMessage[]) => Promise<string | undefined>;

export interface HistoryManagerConfig {
  /** Token budget — compact() triggers when tokenEstimate exceeds this */
  maxTokens: number;
  /** Optional summarize callback — if not provided, compact() just truncates */
  summarize?: SummarizeFn;
}

export class HistoryManager {
  private messages: CoreMessage[] = [];
  private _tokenEstimate = 0;
  private summaryPrefix?: string;
  private config: HistoryManagerConfig;

  constructor(config: HistoryManagerConfig) {
    this.config = config;
  }

  get tokenEstimate(): number {
    return this._tokenEstimate;
  }

  get length(): number {
    return this.messages.length;
  }

  push(message: CoreMessage, tokens?: number): void {
    this.messages.push(message);
    this._tokenEstimate += tokens ?? this.estimateTokens(message);
  }

  pop(): CoreMessage | undefined {
    const removed = this.messages.pop();
    if (removed) {
      this._tokenEstimate = Math.max(0, this._tokenEstimate - this.estimateTokens(removed));
    }
    return removed;
  }

  clear(): void {
    this.messages = [];
    this._tokenEstimate = 0;
    this.summaryPrefix = undefined;
  }

  setHistory(messages: CoreMessage[]): void {
    this.messages = [...messages];
    this._tokenEstimate = messages.reduce((sum, m) => sum + this.estimateTokens(m), 0);
    this.summaryPrefix = undefined;
  }

  getHistory(): CoreMessage[] {
    return [...this.messages];
  }

  /** Calibrate token count with real usage from API */
  recordUsage(tokens: number): void {
    this._tokenEstimate = tokens;
  }

  /** Compact history if over token budget */
  async compact(): Promise<void> {
    if (this._tokenEstimate < this.config.maxTokens) return;
    if (this.messages.length <= 4) return; // too few to compact

    const keepCount = Math.max(4, Math.floor(this.messages.length * 0.3));
    const old = this.messages.slice(0, -keepCount);
    const recent = this.messages.slice(-keepCount);

    if (this.config.summarize) {
      const summary = await this.config.summarize(old);
      if (summary) {
        this.summaryPrefix = summary;
      }
    }

    this.messages = recent;
    this._tokenEstimate = recent.reduce((sum, m) => sum + this.estimateTokens(m), 0);
    if (this.summaryPrefix) {
      this._tokenEstimate += Math.ceil(this.summaryPrefix.length / 4);
    }
  }

  /** Get messages ready to send to the model */
  toMessages(): CoreMessage[] {
    if (this.summaryPrefix) {
      return [
        { role: "user", content: `[Previous context summary: ${this.summaryPrefix}]` },
        { role: "assistant", content: "Understood, I have the context." },
        ...this.messages,
      ];
    }
    return [...this.messages];
  }

  private estimateTokens(message: CoreMessage | string): number {
    if (typeof message === "string") return Math.ceil(message.length / 4);
    const content = typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
    return Math.ceil(content.length / 4);
  }
}
```

**Step 5: Run tests**

Run: `bun test tests/unit/history-manager.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/stream-types.ts src/core/history-manager.ts tests/unit/history-manager.test.ts
git commit -m "feat(core): add HistoryManager with token-budget compaction and ChatStream type"
```

---

## Task 6: Cortex Rewrite — Core

This is the largest task. Replace the tool loop, add `chatStream()`, integrate `HistoryManager`.

**Files:**
- Modify: `src/core/cortex.ts`
- Test: `tests/unit/cortex-ai-sdk.test.ts` (new focused tests for the new behavior)

**Step 1: Write failing tests for the new Cortex behavior**

```typescript
// tests/unit/cortex-ai-sdk.test.ts
import { describe, test, expect, mock } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { AuditLogger } from "../../src/audit/logger.ts";

describe("Cortex (AI SDK)", () => {
  test("chat returns text response", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel({ text: "Hello from AI SDK" }) });
    const result = await cortex.chat("Hi");
    expect(result).toBe("Hello from AI SDK");
  });

  test("chatStream returns streaming response", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel({ text: "Streamed" }) });
    const stream = await cortex.chatStream("Hi");

    let text = "";
    for await (const chunk of stream.textStream) {
      text += chunk;
    }
    expect(text).toBe("Streamed");

    const full = await stream.fullText;
    expect(full).toBe("Streamed");
  });

  test("chat stores user and assistant messages in history", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel({ text: "reply" }) });
    await cortex.chat("hello");
    expect(cortex.historyLength).toBe(2);
    const history = cortex.getHistory();
    expect(history[0]!.role).toBe("user");
    expect(history[1]!.role).toBe("assistant");
  });

  test("clearHistory resets history", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    await cortex.chat("hi");
    cortex.clearHistory();
    expect(cortex.historyLength).toBe(0);
  });

  test("setHistory replaces history", async () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    cortex.setHistory([
      { role: "user", content: "old" },
      { role: "assistant", content: "also old" },
    ]);
    expect(cortex.historyLength).toBe(2);
  });

  test("registerTool makes tool available", () => {
    const cortex = new Cortex({ injectedModel: createMockModel() });
    cortex.registerTool({
      name: "test.tool",
      description: "A test tool",
      parameters: [],
      clearance: [],
      execute: async () => ({ success: true, output: "ok" }),
    });
    expect(cortex.availableTools).toHaveLength(1);
  });

  test("debug mode logs system prompt to audit", async () => {
    const audit = new AuditLogger();
    const entries: Array<{ action: string }> = [];
    const originalLog = audit.log.bind(audit);
    audit.log = (entry: any) => { entries.push(entry); originalLog(entry); };

    const cortex = new Cortex({
      injectedModel: createMockModel(),
      audit,
      debug: true,
      projectRoot: "/tmp",
    });
    await cortex.chat("test");

    const debugEntry = entries.find((e) => e.action === "debug:system-prompt");
    expect(debugEntry).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cortex-ai-sdk.test.ts`
Expected: FAIL — `injectedModel` not recognized, `chatStream` not a function

**Step 3: Rewrite `src/core/cortex.ts`**

Replace the full file. Key changes:
- `CortexConfig.injectedModel?: LanguageModelV1` replaces `injectedProvider?: LLMProvider`
- `private model: LanguageModelV1` replaces `private provider: LLMProvider` + `private model: string`
- `private historyManager: HistoryManager` replaces `private conversationHistory: ConversationMessage[]`
- `chatStream()` uses `streamText()` from `ai` with `maxSteps` and `onStepFinish`
- `chat()` becomes a thin wrapper over `chatStream().fullText`
- `buildAiSdkTools()` replaces `toToolDefinitions()` + `executeToolCall()`
- `toolContext` computed once, reused across calls

The full implementation should follow the design doc's Section 2 code. Key imports:

```typescript
import { streamText, tool, type CoreMessage, type LanguageModelV1, type CoreTool } from "ai";
import { createModel, PROVIDER_DEFAULTS } from "../providers/index.ts";
import { toZodSchema } from "../providers/schemas.ts";
import { HistoryManager, type SummarizeFn } from "./history-manager.ts";
import type { ChatStream } from "./stream-types.ts";
```

Preserve the existing public API surface:
- `chat(userMessage: string): Promise<string>` — backward compat
- `chatStream(userMessage: string): Promise<ChatStream>` — new
- `registerTool(tool: FridayTool): void` — unchanged
- `clearHistory(): void` — delegates to `historyManager.clear()`
- `setHistory(messages): void` — delegates to `historyManager.setHistory()`
- `getHistory(): CoreMessage[]` — delegates to `historyManager.getHistory()`
- `historyLength: number` — delegates to `historyManager.length`
- `availableTools: FridayTool[]` — unchanged
- `providerName: string` — derived from config
- `modelName: string` — derived from config
- `llmProvider` — **removed** (no longer exists). Callers that need a model get `LanguageModelV1` instead.
- `pinSmart()`/`unpinSmart()` — unchanged
- `buildSystemPrompt()` — unchanged

**Step 4: Run the new tests**

Run: `bun test tests/unit/cortex-ai-sdk.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/cortex-ai-sdk.test.ts
git commit -m "feat(cortex): rewrite to use AI SDK streamText with maxSteps"
```

---

## Task 7: Runtime Migration

**Files:**
- Modify: `src/core/runtime.ts`

**Step 1: Update imports and `RuntimeConfig`**

In `src/core/runtime.ts`:
- Replace `import { type LLMProvider } from "../providers/index.ts"` with `import type { LanguageModelV1 } from "ai"`
- `RuntimeConfig.injectedProvider?: LLMProvider` → `RuntimeConfig.injectedModel?: LanguageModelV1`
- Replace `createProvider()` with `createModel()`

**Step 2: Update boot sequence**

Lines 259-274 where Cortex is constructed:
- Pass `injectedModel: config.injectedModel` instead of `injectedProvider: config.injectedProvider`
- The Cortex constructor handles the rest

Lines 310-312 where `SmartsCurator` and `ConversationSummarizer` are created:
- These still use `this._cortex.llmProvider` — this accessor is **removed**. Instead, create a separate fast model:

```typescript
const fastModel = config.injectedModel ?? createModel(providerName, this._fastModel);
this._curator = new SmartsCurator(this._smarts, fastModel, this._fastModel);
this._summarizer = new ConversationSummarizer(fastModel, this._fastModel);
```

Note: SmartsCurator and Summarizer need to be updated in Tasks 8-9 to accept `LanguageModelV1`.

**Step 3: Run existing runtime tests**

Run: `bun test tests/unit/runtime.test.ts`
Expected: Some failures due to `injectedProvider` → `injectedModel`. Fix in Task 10.

**Step 4: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat(runtime): migrate boot sequence to createModel and injectedModel"
```

---

## Task 8: ConversationSummarizer Migration

**Files:**
- Modify: `src/core/summarizer.ts`
- Modify: `tests/unit/summarizer.test.ts`

**Step 1: Update summarizer to use `generateText`**

```typescript
// src/core/summarizer.ts
import type { LanguageModelV1 } from "ai";
import { generateText } from "ai";
import { type ConversationMessage, getTextContent } from "./types.ts";
import { withTimeout } from "../utils/timeout.ts";

const MIN_MESSAGES_FOR_SUMMARY = 4;
const MAX_SUMMARIZER_CHARS = 16_000;

export const SUMMARY_PROMPT = `You are a conversation summarizer...`; // unchanged

export class ConversationSummarizer {
  constructor(
    private model: LanguageModelV1,
    private _modelId: string,
  ) {}

  async summarize(messages: ConversationMessage[]): Promise<string | undefined> {
    if (messages.length < MIN_MESSAGES_FOR_SUMMARY) return undefined;

    try {
      let conversationText = messages
        .map((m) => `${m.role}: ${getTextContent(m.content)}`)
        .join("\n\n");

      if (conversationText.length > MAX_SUMMARIZER_CHARS) {
        conversationText = `[Earlier messages omitted]\n\n${conversationText.slice(-MAX_SUMMARIZER_CHARS)}`;
      }

      const result = await withTimeout(
        generateText({
          model: this.model,
          system: SUMMARY_PROMPT,
          messages: [{ role: "user", content: conversationText }],
          maxTokens: 256,
        }),
        30_000,
        "conversation summarization",
      );

      const trimmed = result.text.trim();
      return trimmed || undefined;
    } catch (error) {
      console.warn("Conversation summarization failed:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }
}
```

**Step 2: Update tests — replace `stubProvider` with `createMockModel()`**

In `tests/unit/summarizer.test.ts`, change constructor calls from:
```typescript
new ConversationSummarizer(stubProvider, "stub-model")
```
to:
```typescript
new ConversationSummarizer(createMockModel({ text: "summary text" }), "mock-model")
```

**Step 3: Run tests**

Run: `bun test tests/unit/summarizer.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/summarizer.ts tests/unit/summarizer.test.ts
git commit -m "feat(summarizer): migrate to AI SDK generateText"
```

---

## Task 9: SmartsCurator Migration

**Files:**
- Modify: `src/smarts/curator.ts`
- Modify: `tests/unit/smarts-curator.test.ts`

**Step 1: Update curator to use `generateText`**

Same pattern as Task 8: replace `LLMProvider` with `LanguageModelV1`, replace `this.provider.chat()` with `generateText()`.

The constructor changes from:
```typescript
constructor(private store: SmartsStore, private provider: LLMProvider, fastModel?: string)
```
to:
```typescript
constructor(private store: SmartsStore, private model: LanguageModelV1, modelId?: string)
```

The `extractFromConversation` method replaces `this.provider.chat(prompt, [...], { model, maxTokens })` with:
```typescript
const result = await withTimeout(
  generateText({
    model: this.model,
    system: prompt,
    messages: [{ role: "user", content: conversationText }],
    maxTokens: 4096,
  }),
  30_000,
  "SMARTS knowledge extraction",
);
const response = result.text;
```

**Step 2: Update tests**

Replace `stubProvider` / `grokStub` with `createMockModel()` in `tests/unit/smarts-curator.test.ts`.

**Step 3: Run tests**

Run: `bun test tests/unit/smarts-curator.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/smarts/curator.ts tests/unit/smarts-curator.test.ts
git commit -m "feat(smarts): migrate SmartsCurator to AI SDK generateText"
```

---

## Task 10: Test Migration — Bulk `injectedProvider` → `injectedModel`

**Files:**
- Modify: All test files that reference `injectedProvider`, `stubProvider`, or `grokStub`

Files to update (from grep):
- `tests/unit/friday.test.ts`
- `tests/unit/runtime.test.ts`
- `tests/unit/cortex-tools.test.ts`
- `tests/unit/vox-cortex.test.ts`
- `tests/unit/vox-runtime.test.ts`
- `tests/unit/arc-rhythm-executor.test.ts`
- `tests/unit/arc-rhythm-protocol.test.ts`
- `tests/unit/arc-rhythm-runtime.test.ts`
- `tests/unit/arc-rhythm-scheduler.test.ts`
- `tests/unit/server-handler.test.ts`

**Step 1: Mechanical replacement pattern**

In each file:
1. Replace `import { stubProvider, ... }` with `import { createMockModel, ... }`
2. Replace `injectedProvider: stubProvider` with `injectedModel: createMockModel()`
3. Replace `injectedProvider: grokStub` with `injectedModel: createMockModel({ text: "grok response" })`
4. Where tests check specific response text, ensure `createMockModel()` text matches

**Step 2: Run all tests**

Run: `bun test`
Expected: All passing (same count as before)

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: migrate all tests from injectedProvider to injectedModel"
```

---

## Task 11: TUI Streaming Integration

**Files:**
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/app.tsx`

**Step 1: Add streaming actions to state reducer**

In `src/cli/tui/state.ts`, add to `AppAction`:
```typescript
| { type: "append-chunk"; messageId: string; chunk: string }
| { type: "message-complete"; messageId: string; text: string }
```

Add to `appReducer`:
```typescript
case "append-chunk":
  return {
    ...state,
    messages: state.messages.map((m) =>
      m.id === action.messageId
        ? { ...m, content: m.content + action.chunk }
        : m,
    ),
  };
case "message-complete":
  return {
    ...state,
    messages: state.messages.map((m) =>
      m.id === action.messageId
        ? { ...m, content: action.text }
        : m,
    ),
  };
```

**Step 2: Update TUI app to use chatStream**

In `src/cli/tui/app.tsx`, update the message handler (around line 310):

Replace:
```typescript
const result = await runtime.process(input);
dispatch({ type: "set-thinking", value: false });
dispatch({ type: "add-message", message: createMessage("assistant", result.output) });
```

With streaming-aware code:
```typescript
if (runtime.protocols.isProtocol(input)) {
  // Protocols stay blocking
  const result = await runtime.process(input);
  dispatch({ type: "set-thinking", value: false });
  dispatch({ type: "add-message", message: createMessage("assistant", result.output) });
} else {
  // LLM chat uses streaming
  const msgId = crypto.randomUUID();
  dispatch({ type: "add-message", message: { id: msgId, role: "assistant", content: "", timestamp: new Date() } });
  dispatch({ type: "set-thinking", value: false });

  const stream = await runtime.cortex.chatStream(input);
  for await (const chunk of stream.textStream) {
    dispatch({ type: "append-chunk", messageId: msgId, chunk });
  }
  const fullText = await stream.fullText;
  dispatch({ type: "message-complete", messageId: msgId, text: fullText });
}
```

**Step 3: Run TUI state tests**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: PASS (may need to add tests for new actions)

**Step 4: Commit**

```bash
git add src/cli/tui/state.ts src/cli/tui/app.tsx
git commit -m "feat(tui): integrate streaming via chatStream with chunk dispatch"
```

---

## Task 12: Web Server Streaming & Protocol Update

**Files:**
- Modify: `src/server/protocol.ts`
- Modify: `src/server/handler.ts`

**Step 1: Add `chunk` message type to protocol**

In `src/server/protocol.ts`, add to `ServerMessage`:
```typescript
| { type: "chat:chunk"; requestId: string; content: string }
```

**Step 2: Update handler to stream**

In `src/server/handler.ts`, update the `case "chat":` handler to use streaming when the input is not a protocol:

```typescript
case "chat": {
  if (this.runtime.protocols.isProtocol(msg.content)) {
    const result = await this.runtime.process(msg.content);
    send({ type: "chat:response", requestId: msg.id, content: result.output, source: result.source });
  } else {
    const stream = await this.runtime.cortex.chatStream(msg.content);
    for await (const chunk of stream.textStream) {
      send({ type: "chat:chunk", requestId: msg.id, content: chunk });
    }
    const fullText = await stream.fullText;
    send({ type: "chat:response", requestId: msg.id, content: fullText, source: "cortex" });
  }
  break;
}
```

**Step 3: Run server tests**

Run: `bun test tests/unit/server-handler.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server/protocol.ts src/server/handler.ts
git commit -m "feat(server): stream chat chunks over WebSocket"
```

---

## Task 13: Delete Legacy Provider Files

**Files:**
- Delete: `src/providers/anthropic.ts`
- Delete: `src/providers/grok.ts`
- Delete: `src/providers/types.ts`
- Delete: `src/providers/tool-schema.ts`
- Delete: `src/providers/legacy.ts`
- Modify: `src/providers/index.ts` — remove legacy re-exports
- Delete: Provider-specific test files

**Step 1: Remove legacy re-exports from `src/providers/index.ts`**

Remove these lines:
```typescript
export type { LLMProvider, ChatOptions, ChatResponse, ToolCallRequest, ToolDefinition } from "./types.ts";
export { toJsonSchema } from "./tool-schema.ts";
export { createProvider } from "./legacy.ts";
```

**Step 2: Delete the files**

```bash
rm src/providers/anthropic.ts src/providers/grok.ts src/providers/types.ts src/providers/tool-schema.ts src/providers/legacy.ts
```

**Step 3: Remove old stubs from `tests/helpers/stubs.ts`**

Remove `stubProvider`, `grokStub`, `textResponse`, and the `LLMProvider` import. Keep only `createMockModel` and related types.

**Step 4: Fix any remaining imports**

Search for any remaining imports of deleted modules:
```bash
grep -r "providers/types\|providers/anthropic\|providers/grok\|providers/tool-schema\|providers/legacy" src/ tests/
```

Fix any found references.

**Step 5: Remove old dependencies**

```bash
bun remove @anthropic-ai/sdk openai
```

**Step 6: Run all tests**

Run: `bun test`
Expected: All passing

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove legacy provider layer (anthropic.ts, grok.ts, types.ts, tool-schema.ts)"
```

---

## Task 14: Update Types & Clean Up

**Files:**
- Modify: `src/core/types.ts` — align `ConversationMessage` with AI SDK `CoreMessage`
- Modify: `src/cli/commands/chat.ts` — if it references old provider types
- Modify: `src/cli/commands/serve.ts` — if it references old provider types

**Step 1: Audit `ConversationMessage` usage**

The `ConversationMessage` type in `src/core/types.ts` may need to become a type alias for `CoreMessage` from `ai`, or we keep it as-is if the `HistoryManager` handles the translation. Check what `memory.saveConversation()` expects.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: Clean

**Step 4: Run full test suite**

Run: `bun test`
Expected: All passing

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up types and fix remaining imports after AI SDK migration"
```

---

## Task 15: Update Documentation

**Files:**
- Modify: `CLAUDE.md` — update provider info, add AI SDK details, update architecture section
- Modify: `README.md` — update dependencies section, provider info

**Step 1: Update CLAUDE.md**

Key changes:
- Replace references to `@anthropic-ai/sdk` and `openai` with `ai`, `@ai-sdk/xai`, `@ai-sdk/anthropic`
- Update architecture section to mention `streamText`, `HistoryManager`, `ChatStream`
- Update testing section to mention `createMockModel()` instead of `stubProvider`
- Add note about `chatStream()` vs `chat()` dual method pattern
- Update test count

**Step 2: Run final tests**

Run: `bun test`
Expected: All passing

**Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README.md for AI SDK migration"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — no type errors
- [ ] `bun run lint` — clean
- [ ] `grep -r "anthropic-ai/sdk\|from.*openai" src/` — no old SDK imports
- [ ] `grep -r "LLMProvider\|injectedProvider\|stubProvider\|grokStub" src/ tests/` — no legacy references
- [ ] `bun run start chat --provider grok` — manual smoke test with Grok
- [ ] `bun run start chat --provider anthropic` — manual smoke test with Anthropic
- [ ] Streaming visible in TUI (text appears incrementally)
- [ ] `bun run serve` — web server streams chunks
