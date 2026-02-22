# Agentic Tool Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Friday's registered tools to LLM providers via a proper agentic loop so the LLM can call tools, receive results, and iterate.

**Architecture:** Provider-level abstraction — each provider translates `FridayTool` definitions into its native API format. Cortex owns the loop: send tools to provider, handle `tool_use` responses, execute tools with clearance checks, inject results, repeat until text response or max 10 iterations.

**Tech Stack:** TypeScript, Bun, `@anthropic-ai/sdk`, `openai` SDK (for Grok/xAI), `bun:test`

**Design doc:** `docs/plans/2026-02-21-agentic-tool-loop-design.md`

---

### Task 1: Evolve Core Types

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Write the failing test**

Create `tests/unit/types.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type {
  ConversationMessage,
  MessageContent,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
} from "../../src/core/types.ts";

describe("ConversationMessage types", () => {
  test("accepts string content (backwards compatible)", () => {
    const msg: ConversationMessage = { role: "user", content: "hello" };
    expect(msg.content).toBe("hello");
  });

  test("accepts ContentBlock[] content", () => {
    const msg: ConversationMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check that." },
        { type: "tool_use", id: "call_1", name: "fs.read", input: { path: "/tmp/test" } },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
    expect((msg.content as ContentBlock[])[0]!.type).toBe("text");
    expect((msg.content as ContentBlock[])[1]!.type).toBe("tool_use");
  });

  test("accepts tool_result content blocks", () => {
    const msg: ConversationMessage = {
      role: "user",
      content: [
        { type: "tool_result", toolCallId: "call_1", content: "file contents here", isError: false },
      ],
    };
    const blocks = msg.content as ToolResultBlock[];
    expect(blocks[0]!.type).toBe("tool_result");
    expect(blocks[0]!.isError).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/types.test.ts`
Expected: FAIL — types `MessageContent`, `TextBlock`, `ToolUseBlock`, `ToolResultBlock`, `ContentBlock` do not exist yet

**Step 3: Write the implementation**

Update `src/core/types.ts`:

```typescript
/** Supported LLM provider names */
export type ProviderName = "anthropic" | "grok";

/** Configuration for FridayCore */
export interface FridayConfig {
  /** Which LLM provider to use */
  provider: ProviderName;
  /** Model identifier (provider-specific) */
  model: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}

// -- Content block types for rich conversation messages --

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** Message content: plain string for simple text, ContentBlock[] for tool interactions */
export type MessageContent = string | ContentBlock[];

/** A single message in the conversation history */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: MessageContent;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/types.test.ts`
Expected: PASS

**Step 5: Add a `getTextContent` helper**

Many consumers need to extract text from `MessageContent`. Add a helper to `src/core/types.ts`:

```typescript
/** Extract plain text from a message's content, joining text blocks */
export function getTextContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
```

Add tests for `getTextContent` in the same test file:

```typescript
import { getTextContent } from "../../src/core/types.ts";

describe("getTextContent", () => {
  test("returns string content as-is", () => {
    expect(getTextContent("hello")).toBe("hello");
  });

  test("extracts text from ContentBlock[]", () => {
    expect(getTextContent([
      { type: "text", text: "part 1" },
      { type: "tool_use", id: "x", name: "t", input: {} },
      { type: "text", text: " part 2" },
    ])).toBe("part 1 part 2");
  });

  test("returns empty string when no text blocks", () => {
    expect(getTextContent([
      { type: "tool_use", id: "x", name: "t", input: {} },
    ])).toBe("");
  });
});
```

**Step 6: Run all tests**

Run: `bun test tests/unit/types.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/types.ts tests/unit/types.test.ts
git commit -m "feat(types): evolve ConversationMessage to support rich content blocks"
```

---

### Task 2: Add Provider Types and Tool Schema Converter

**Files:**
- Modify: `src/providers/types.ts`
- Create: `src/providers/tool-schema.ts`
- Modify: `src/providers/index.ts` (re-export new types)

**Step 1: Write the failing test**

Create `tests/unit/tool-schema.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { toJsonSchema } from "../../src/providers/tool-schema.ts";
import type { ToolParameter } from "../../src/modules/types.ts";

describe("toJsonSchema", () => {
  test("converts empty parameters to empty schema", () => {
    const schema = toJsonSchema([]);
    expect(schema).toEqual({ type: "object", properties: {}, required: [] });
  });

  test("converts required string parameter", () => {
    const params: ToolParameter[] = [
      { name: "path", type: "string", description: "File path", required: true },
    ];
    const schema = toJsonSchema(params);
    expect(schema.properties.path).toEqual({ type: "string", description: "File path" });
    expect(schema.required).toEqual(["path"]);
  });

  test("converts optional number parameter with default", () => {
    const params: ToolParameter[] = [
      { name: "limit", type: "number", description: "Max items", required: false, default: 10 },
    ];
    const schema = toJsonSchema(params);
    expect(schema.properties.limit).toEqual({ type: "number", description: "Max items", default: 10 });
    expect(schema.required).toEqual([]);
  });

  test("converts all supported types", () => {
    const params: ToolParameter[] = [
      { name: "a", type: "string", description: "s", required: true },
      { name: "b", type: "number", description: "n", required: true },
      { name: "c", type: "boolean", description: "b", required: false },
      { name: "d", type: "array", description: "a", required: false },
      { name: "e", type: "object", description: "o", required: false },
    ];
    const schema = toJsonSchema(params);
    expect(schema.properties.a).toMatchObject({ type: "string" });
    expect(schema.properties.b).toMatchObject({ type: "number" });
    expect(schema.properties.c).toMatchObject({ type: "boolean" });
    expect(schema.properties.d).toMatchObject({ type: "array" });
    expect(schema.properties.e).toMatchObject({ type: "object" });
    expect(schema.required).toEqual(["a", "b"]);
  });

  test("converts real fs.read parameters", () => {
    const params: ToolParameter[] = [
      { name: "path", type: "string", description: "File path to read", required: true },
      { name: "offset", type: "number", description: "Line offset", required: false, default: 1 },
      { name: "limit", type: "number", description: "Lines to return", required: false, default: 200 },
    ];
    const schema = toJsonSchema(params);
    expect(schema.required).toEqual(["path"]);
    expect(Object.keys(schema.properties)).toHaveLength(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/tool-schema.test.ts`
Expected: FAIL — `toJsonSchema` module doesn't exist

**Step 3: Update `src/providers/types.ts`**

```typescript
import type { ConversationMessage } from "../core/types.ts";
import type { ToolParameter } from "../modules/types.ts";

export interface ChatOptions {
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
}

/** Tool call requested by the LLM */
export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Single chat turn result — either final text or tool-call requests */
export type ChatResponse =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCalls: ToolCallRequest[] };

/** Provider-agnostic tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/** Contract that every LLM provider must implement */
export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse>;
}
```

**Step 4: Create `src/providers/tool-schema.ts`**

```typescript
import type { ToolParameter } from "../modules/types.ts";

export interface JsonSchema {
  type: "object";
  properties: Record<string, object>;
  required: string[];
}

export function toJsonSchema(params: ToolParameter[]): JsonSchema {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const param of params) {
    const prop: Record<string, unknown> = {
      type: param.type,
      description: param.description,
    };
    if (param.default !== undefined) {
      prop.default = param.default;
    }
    properties[param.name] = prop;
    if (param.required) {
      required.push(param.name);
    }
  }

  return { type: "object", properties, required };
}
```

**Step 5: Update `src/providers/index.ts` to re-export new types**

Add to the existing re-export line:

```typescript
export type { LLMProvider, ChatOptions, ChatResponse, ToolCallRequest, ToolDefinition } from "./types.ts";
export { toJsonSchema } from "./tool-schema.ts";
```

**Step 6: Run test to verify it passes**

Run: `bun test tests/unit/tool-schema.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/providers/types.ts src/providers/tool-schema.ts src/providers/index.ts tests/unit/tool-schema.test.ts
git commit -m "feat(providers): add ChatResponse, ToolDefinition types and JSON Schema converter"
```

---

### Task 3: Update Stub Provider and Fix Existing Tests

All existing tests use `stubProvider` which returns `string`. Now `LLMProvider.chat()` returns `Promise<ChatResponse>`. Update the stubs and all existing tests to use `ChatResponse`.

**Files:**
- Modify: `tests/helpers/stubs.ts`
- Modify: `tests/unit/friday.test.ts`
- Modify: `tests/unit/runtime.test.ts`
- Modify: `tests/unit/smarts-curator.test.ts`

**Step 1: Update `tests/helpers/stubs.ts`**

```typescript
import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

/** Helper to create a text ChatResponse */
export function textResponse(text: string): ChatResponse {
  return { type: "text", text };
}

export const stubProvider: LLMProvider = {
  name: "stub",
  defaultModel: "stub-model",
  chat: async () => textResponse("stub response"),
};

export const grokStub: LLMProvider = {
  name: "grok",
  defaultModel: PROVIDER_DEFAULTS.grok,
  chat: async () => textResponse("grok response"),
};
```

**Step 2: Update `tests/unit/friday.test.ts`**

Every inline `LLMProvider` that returns a string must return `ChatResponse` instead. The key changes:

- Line 70: `chat: async () => { throw new Error("API error"); }` — no change needed (still throws)
- Line 103-106: `chat: async (systemPrompt) => { capturedPrompt = systemPrompt; return "response with smarts"; }` → change return to `textResponse("response with smarts")`
- Lines 204, 225: `return "ok"` → `return textResponse("ok")`
- Lines 150-155, 178-183 (runtime.test.ts): `return "[]"` → `return textResponse("[]")`
- Lines 323-326 (runtime.test.ts): `return "I can see the system!"` → `return textResponse("I can see the system!")`

Import `textResponse` from `../helpers/stubs.ts` and `{ type: "text" }` from types.

Also, in `friday.test.ts`:

- Line 62-63: `history[0]!.content` — this still works because content is `string | ContentBlock[]` and we pushed a string.

**Step 3: Update `tests/unit/smarts-curator.test.ts`**

The `SmartsCurator` calls `provider.chat()` and expects a string back. Since `chat()` now returns `ChatResponse`, the curator needs to extract text. This cascading change means **SmartsCurator itself** also needs updating (see Task 6).

For now, update the mock providers in the test to return `ChatResponse`:

- Line 61-62: `chat: async (_system, messages) => { calledWith = messages[messages.length - 1]?.content ?? ""; return '[]'; }` → return `textResponse("[]")` and use `getTextContent()` for content access.

**Step 4: Run all existing tests**

Run: `bun test`
Expected: All 270 tests PASS

**Step 5: Commit**

```bash
git add tests/helpers/stubs.ts tests/unit/friday.test.ts tests/unit/runtime.test.ts tests/unit/smarts-curator.test.ts
git commit -m "refactor(tests): update stubs and tests for ChatResponse return type"
```

---

### Task 4: Update Anthropic Provider

**Files:**
- Modify: `src/providers/anthropic.ts`

**Step 1: Write the failing test**

Create `tests/unit/anthropic-provider.test.ts`. Since `AnthropicProvider` calls the real API, we test the message formatting functions directly. Extract them as pure functions.

```typescript
import { describe, test, expect } from "bun:test";
import {
  toAnthropicTools,
  toAnthropicMessages,
  parseAnthropicResponse,
} from "../../src/providers/anthropic.ts";
import type { ToolDefinition } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";

describe("Anthropic provider — tool formatting", () => {
  test("toAnthropicTools formats tool definitions", () => {
    const tools: ToolDefinition[] = [{
      name: "fs.read",
      description: "Read a file",
      parameters: [
        { name: "path", type: "string", description: "File path", required: true },
      ],
    }];
    const result = toAnthropicTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("fs.read");
    expect(result[0]!.description).toBe("Read a file");
    expect(result[0]!.input_schema).toEqual({
      type: "object",
      properties: { path: { type: "string", description: "File path" } },
      required: ["path"],
    });
  });

  test("toAnthropicTools returns empty array for no tools", () => {
    expect(toAnthropicTools([])).toEqual([]);
  });
});

describe("Anthropic provider — message formatting", () => {
  test("converts simple string messages", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  test("converts tool_use content blocks", () => {
    const messages: ConversationMessage[] = [{
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that." },
        { type: "tool_use", id: "call_1", name: "fs.read", input: { path: "/tmp/x" } },
      ],
    }];
    const result = toAnthropicMessages(messages);
    expect(result[0]!.role).toBe("assistant");
    expect(result[0]!.content).toEqual([
      { type: "text", text: "Let me read that." },
      { type: "tool_use", id: "call_1", name: "fs.read", input: { path: "/tmp/x" } },
    ]);
  });

  test("converts tool_result content blocks", () => {
    const messages: ConversationMessage[] = [{
      role: "user",
      content: [
        { type: "tool_result", toolCallId: "call_1", content: "file contents", isError: false },
      ],
    }];
    const result = toAnthropicMessages(messages);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toEqual([
      { type: "tool_result", tool_use_id: "call_1", content: "file contents", is_error: false },
    ]);
  });
});

describe("Anthropic provider — response parsing", () => {
  test("parses text response", () => {
    const response = {
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "Hello!" }],
    };
    const result = parseAnthropicResponse(response);
    expect(result).toEqual({ type: "text", text: "Hello!" });
  });

  test("parses tool_use response", () => {
    const response = {
      stop_reason: "tool_use" as const,
      content: [
        { type: "text" as const, text: "Reading file." },
        {
          type: "tool_use" as const,
          id: "toolu_123",
          name: "fs.read",
          input: { path: "/tmp/test" },
          caller: { type: "direct" as const },
        },
      ],
    };
    const result = parseAnthropicResponse(response);
    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.id).toBe("toolu_123");
      expect(result.toolCalls[0]!.name).toBe("fs.read");
      expect(result.toolCalls[0]!.input).toEqual({ path: "/tmp/test" });
    }
  });

  test("throws on empty response", () => {
    const response = { stop_reason: "end_turn" as const, content: [] };
    expect(() => parseAnthropicResponse(response)).toThrow("empty response");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/anthropic-provider.test.ts`
Expected: FAIL — exported functions don't exist

**Step 3: Rewrite `src/providers/anthropic.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "../core/types.ts";
import type { ChatOptions, ChatResponse, LLMProvider, ToolDefinition } from "./types.ts";
import { toJsonSchema } from "./tool-schema.ts";

/** Convert ToolDefinition[] to Anthropic API tool format */
export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toJsonSchema(t.parameters),
  }));
}

/** Convert ConversationMessage[] to Anthropic API message format */
export function toAnthropicMessages(
  messages: ConversationMessage[],
): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    const blocks: Anthropic.Messages.ContentBlockParam[] = msg.content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text" as const, text: block.text };
        case "tool_use":
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case "tool_result":
          return {
            type: "tool_result" as const,
            tool_use_id: block.toolCallId,
            content: block.content,
            is_error: block.isError,
          };
      }
    });

    return { role: msg.role, content: blocks };
  });
}

/** Parse Anthropic API response into our ChatResponse format */
export function parseAnthropicResponse(response: {
  stop_reason: string | null;
  content: Anthropic.Messages.ContentBlock[];
}): ChatResponse {
  if (response.content.length === 0) {
    throw new Error("Anthropic returned empty response");
  }

  if (response.stop_reason === "tool_use") {
    const toolCalls = response.content
      .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));
    return { type: "tool_use", toolCalls };
  }

  const textBlocks = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  if (textBlocks.length === 0) {
    throw new Error(`Unexpected Anthropic content: no text blocks (stop_reason: ${response.stop_reason})`);
  }
  return { type: "text", text: textBlocks.map((b) => b.text).join("") };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel = "claude-sonnet-4-20250514";
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const params: Anthropic.Messages.MessageCreateParams = {
      model: options.model,
      max_tokens: options.maxTokens,
      system: systemPrompt,
      messages: toAnthropicMessages(messages),
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = toAnthropicTools(options.tools);
    }

    const response = await this.client.messages.create(params);
    return parseAnthropicResponse(response);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/anthropic-provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/anthropic.ts tests/unit/anthropic-provider.test.ts
git commit -m "feat(anthropic): implement tool formatting, message translation, and response parsing"
```

---

### Task 5: Update Grok Provider

**Files:**
- Modify: `src/providers/grok.ts`

**Step 1: Write the failing test**

Create `tests/unit/grok-provider.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  toGrokTools,
  toGrokMessages,
  parseGrokResponse,
} from "../../src/providers/grok.ts";
import type { ToolDefinition } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";

describe("Grok provider — tool formatting", () => {
  test("toGrokTools formats tool definitions", () => {
    const tools: ToolDefinition[] = [{
      name: "fs.read",
      description: "Read a file",
      parameters: [
        { name: "path", type: "string", description: "File path", required: true },
      ],
    }];
    const result = toGrokTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("function");
    expect(result[0]!.function.name).toBe("fs.read");
    expect(result[0]!.function.description).toBe("Read a file");
    expect(result[0]!.function.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string", description: "File path" } },
      required: ["path"],
    });
  });

  test("toGrokTools returns empty array for no tools", () => {
    expect(toGrokTools([])).toEqual([]);
  });
});

describe("Grok provider — message formatting", () => {
  test("converts simple string messages", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = toGrokMessages("system prompt", messages);
    expect(result[0]).toEqual({ role: "system", content: "system prompt" });
    expect(result[1]).toEqual({ role: "user", content: "hello" });
    expect(result[2]).toEqual({ role: "assistant", content: "hi" });
  });

  test("converts tool_use assistant messages", () => {
    const messages: ConversationMessage[] = [{
      role: "assistant",
      content: [
        { type: "text", text: "Reading." },
        { type: "tool_use", id: "call_1", name: "fs.read", input: { path: "/tmp" } },
      ],
    }];
    const result = toGrokMessages("sys", messages);
    // system + assistant with tool_calls
    expect(result[1]!.role).toBe("assistant");
    expect((result[1] as any).tool_calls).toHaveLength(1);
    expect((result[1] as any).tool_calls[0].id).toBe("call_1");
    expect((result[1] as any).tool_calls[0].function.name).toBe("fs.read");
  });

  test("converts tool_result messages to role:tool", () => {
    const messages: ConversationMessage[] = [{
      role: "user",
      content: [
        { type: "tool_result", toolCallId: "call_1", content: "file data", isError: false },
      ],
    }];
    const result = toGrokMessages("sys", messages);
    // Each tool_result becomes its own role:"tool" message
    expect(result[1]!.role).toBe("tool");
    expect((result[1] as any).tool_call_id).toBe("call_1");
    expect((result[1] as any).content).toBe("file data");
  });
});

describe("Grok provider — response parsing", () => {
  test("parses text response", () => {
    const choice = {
      finish_reason: "stop" as const,
      message: { content: "Hello!", tool_calls: undefined },
    };
    const result = parseGrokResponse(choice);
    expect(result).toEqual({ type: "text", text: "Hello!" });
  });

  test("parses tool_calls response", () => {
    const choice = {
      finish_reason: "tool_calls" as const,
      message: {
        content: null,
        tool_calls: [{
          id: "call_abc",
          type: "function" as const,
          function: { name: "fs.read", arguments: '{"path":"/tmp/x"}' },
        }],
      },
    };
    const result = parseGrokResponse(choice);
    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.id).toBe("call_abc");
      expect(result.toolCalls[0]!.name).toBe("fs.read");
      expect(result.toolCalls[0]!.input).toEqual({ path: "/tmp/x" });
    }
  });

  test("throws on empty response", () => {
    const choice = { finish_reason: "stop" as const, message: { content: null, tool_calls: undefined } };
    expect(() => parseGrokResponse(choice)).toThrow("empty response");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/grok-provider.test.ts`
Expected: FAIL — exported functions don't exist

**Step 3: Rewrite `src/providers/grok.ts`**

```typescript
import OpenAI from "openai";
import type { ConversationMessage } from "../core/types.ts";
import type { ChatOptions, ChatResponse, LLMProvider, ToolDefinition } from "./types.ts";
import { toJsonSchema } from "./tool-schema.ts";

/** Convert ToolDefinition[] to OpenAI API tool format */
export function toGrokTools(
  tools: ToolDefinition[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters),
    },
  }));
}

/** Convert ConversationMessage[] to OpenAI-compatible message format */
export function toGrokMessages(
  systemPrompt: string,
  messages: ConversationMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system" as const, content: systemPrompt },
  ];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Rich content blocks
    if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      const toolCalls = msg.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const tu = b as { id: string; name: string; input: Record<string, unknown> };
          return {
            id: tu.id,
            type: "function" as const,
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          };
        });
      result.push({
        role: "assistant" as const,
        content: textParts || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else {
      // user role with tool_result blocks → one role:"tool" message per result
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          result.push({
            role: "tool" as const,
            tool_call_id: block.toolCallId,
            content: block.content,
          });
        }
      }
    }
  }

  return result;
}

/** Parse OpenAI-compatible response choice into our ChatResponse format */
export function parseGrokResponse(choice: {
  finish_reason: string | null;
  message: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
}): ChatResponse {
  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
    const toolCalls = choice.message.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));
    return { type: "tool_use", toolCalls };
  }

  const content = choice.message.content;
  if (!content) {
    throw new Error("Grok returned empty response");
  }
  return { type: "text", text: content };
}

export class GrokProvider implements LLMProvider {
  readonly name = "grok";
  readonly defaultModel = "grok-4-1-fast-reasoning-latest";
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "XAI_API_KEY is not set. Add it to your .env file to use Grok.\n" +
          "Get your API key at https://console.x.ai",
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });
  }

  async chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: toGrokMessages(systemPrompt, messages),
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = toGrokTools(options.tools);
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];
    if (!choice) {
      throw new Error("Grok returned no choices");
    }
    return parseGrokResponse(choice);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/grok-provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/grok.ts tests/unit/grok-provider.test.ts
git commit -m "feat(grok): implement tool formatting, message translation, and response parsing"
```

---

### Task 6: Update SmartsCurator for ChatResponse

**Files:**
- Modify: `src/smarts/curator.ts`
- Modify: `tests/unit/smarts-curator.test.ts`

**Step 1: Update `src/smarts/curator.ts`**

The curator calls `provider.chat()` which now returns `ChatResponse`. It needs to extract the text.

Key change in `extractFromConversation()`:

```typescript
import { getTextContent } from "../core/types.ts";

// In extractFromConversation():
// 1. Use getTextContent() when building conversationText from history messages
const conversationText = messages
  .map((m) => `${m.role}: ${getTextContent(m.content)}`)
  .join("\n\n");

// 2. Extract text from ChatResponse
const chatResponse = await this.provider.chat(
  EXTRACTION_PROMPT,
  [{ role: "user", content: conversationText }],
  { model: this.provider.defaultModel, maxTokens: 4096 },
);
const response = chatResponse.type === "text" ? chatResponse.text : "";

// 3. parseResponse() signature stays the same (already takes string)
const extracted = this.parseResponse(response);
```

**Step 2: Run tests**

Run: `bun test tests/unit/smarts-curator.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/smarts/curator.ts tests/unit/smarts-curator.test.ts
git commit -m "fix(curator): handle ChatResponse type from provider.chat()"
```

---

### Task 7: Update History Protocol for Rich Content

**Files:**
- Modify: `src/history/protocol.ts`

**Step 1: Update `handleShow()` in `src/history/protocol.ts`**

Line 57 accesses `m.content.slice(0, 200)` which breaks when content is `ContentBlock[]`.

```typescript
import { getTextContent } from "../core/types.ts";

// In handleShow(), replace:
//   .map((m) => `  [${m.role}] ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`)
// With:
//   .map((m) => {
//     const text = getTextContent(m.content);
//     return `  [${m.role}] ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`;
//   })
```

**Step 2: Run existing tests**

Run: `bun test`
Expected: PASS (history protocol tests should still work since all existing test data uses string content)

**Step 3: Commit**

```bash
git add src/history/protocol.ts
git commit -m "fix(history): use getTextContent for rich conversation messages"
```

---

### Task 8: Build the Agentic Loop in Cortex

This is the core feature.

**Files:**
- Modify: `src/core/cortex.ts`

**Step 1: Write the failing tests**

Create `tests/unit/cortex-tools.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import type { FridayTool } from "../../src/modules/types.ts";
import { textResponse } from "../helpers/stubs.ts";

/** Helper: create a mock tool */
function mockTool(overrides: Partial<FridayTool> = {}): FridayTool {
  return {
    name: "test-tool",
    description: "A test tool",
    parameters: [{ name: "input", type: "string", description: "test input", required: true }],
    clearance: [],
    execute: async (args) => ({ success: true, output: `result: ${args.input}` }),
    ...overrides,
  };
}

/** Helper: create a sequencing provider that returns responses in order */
function sequencingProvider(responses: ChatResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "sequencing",
    defaultModel: "seq-model",
    chat: async () => {
      const response = responses[callIndex]!;
      callIndex++;
      return response;
    },
  };
}

describe("Cortex — agentic tool loop", () => {
  test("simple text response (no tools registered)", async () => {
    const cortex = new Cortex({
      injectedProvider: sequencingProvider([textResponse("Hello!")]),
    });
    const result = await cortex.chat("Hi");
    expect(result).toBe("Hello!");
  });

  test("single tool call → result → text response", async () => {
    const tool = mockTool();
    const provider = sequencingProvider([
      {
        type: "tool_use",
        toolCalls: [{ id: "call_1", name: "test-tool", input: { input: "hello" } }],
      },
      textResponse("Tool said: result: hello"),
    ]);

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(tool);

    const result = await cortex.chat("Use the tool");
    expect(result).toBe("Tool said: result: hello");
  });

  test("parallel tool calls executed concurrently", async () => {
    const executionOrder: string[] = [];
    const tool1 = mockTool({
      name: "tool-a",
      execute: async () => {
        executionOrder.push("a");
        return { success: true, output: "result-a" };
      },
    });
    const tool2 = mockTool({
      name: "tool-b",
      execute: async () => {
        executionOrder.push("b");
        return { success: true, output: "result-b" };
      },
    });

    const provider = sequencingProvider([
      {
        type: "tool_use",
        toolCalls: [
          { id: "call_1", name: "tool-a", input: {} },
          { id: "call_2", name: "tool-b", input: {} },
        ],
      },
      textResponse("Both done"),
    ]);

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(tool1);
    cortex.registerTool(tool2);

    const result = await cortex.chat("Use both tools");
    expect(result).toBe("Both done");
    expect(executionOrder).toContain("a");
    expect(executionOrder).toContain("b");
  });

  test("unknown tool returns error result to LLM", async () => {
    let toolResultSeen = false;
    const provider: LLMProvider = {
      name: "inspecting",
      defaultModel: "inspect",
      chat: async (_sys, messages) => {
        // Second call should have tool_result with error
        if (messages.length > 1) {
          const lastMsg = messages[messages.length - 1]!;
          if (typeof lastMsg.content !== "string") {
            const block = lastMsg.content[0]!;
            if (block.type === "tool_result" && block.isError) {
              toolResultSeen = true;
            }
          }
        }
        if (!toolResultSeen) {
          return {
            type: "tool_use" as const,
            toolCalls: [{ id: "call_1", name: "nonexistent", input: {} }],
          };
        }
        return textResponse("Tool not found, sorry.");
      },
    };

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    const result = await cortex.chat("Use nonexistent tool");
    expect(result).toBe("Tool not found, sorry.");
    expect(toolResultSeen).toBe(true);
  });

  test("clearance denial returns error result to LLM", async () => {
    const tool = mockTool({ clearance: ["exec-shell"] });
    let denialSeen = false;

    const provider: LLMProvider = {
      name: "inspecting",
      defaultModel: "inspect",
      chat: async (_sys, messages) => {
        if (messages.length > 1) {
          const lastMsg = messages[messages.length - 1]!;
          if (typeof lastMsg.content !== "string") {
            const block = lastMsg.content[0]!;
            if (block.type === "tool_result" && block.isError) {
              denialSeen = true;
            }
          }
        }
        if (!denialSeen) {
          return {
            type: "tool_use" as const,
            toolCalls: [{ id: "call_1", name: "test-tool", input: { input: "x" } }],
          };
        }
        return textResponse("Permission denied.");
      },
    };

    // ClearanceManager with NO permissions granted
    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(tool);

    const result = await cortex.chat("Run the tool");
    expect(result).toBe("Permission denied.");
    expect(denialSeen).toBe(true);
  });

  test("max iterations throws error", async () => {
    // Provider always returns tool_use — should hit max iterations
    const provider: LLMProvider = {
      name: "looping",
      defaultModel: "loop",
      chat: async () => ({
        type: "tool_use" as const,
        toolCalls: [{ id: `call_${Date.now()}`, name: "test-tool", input: { input: "x" } }],
      }),
    };

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
      maxToolIterations: 3,
    });
    cortex.registerTool(mockTool());

    expect(cortex.chat("Loop forever")).rejects.toThrow("Max tool iterations");
  });

  test("tool execution error is reported as error result", async () => {
    const tool = mockTool({
      execute: async () => ({ success: false, output: "disk full" }),
    });

    let errorReported = false;
    const provider: LLMProvider = {
      name: "inspecting",
      defaultModel: "inspect",
      chat: async (_sys, messages) => {
        if (messages.length > 1) {
          const lastMsg = messages[messages.length - 1]!;
          if (typeof lastMsg.content !== "string") {
            const block = lastMsg.content[0]!;
            if (block.type === "tool_result" && block.isError && block.content.includes("disk full")) {
              errorReported = true;
            }
          }
        }
        if (!errorReported) {
          return {
            type: "tool_use" as const,
            toolCalls: [{ id: "call_1", name: "test-tool", input: { input: "x" } }],
          };
        }
        return textResponse("Write failed.");
      },
    };

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(tool);

    const result = await cortex.chat("Write file");
    expect(result).toBe("Write failed.");
    expect(errorReported).toBe(true);
  });

  test("conversation history includes tool interactions", async () => {
    const tool = mockTool();
    const provider = sequencingProvider([
      {
        type: "tool_use",
        toolCalls: [{ id: "call_1", name: "test-tool", input: { input: "hi" } }],
      },
      textResponse("Done"),
    ]);

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(tool);

    await cortex.chat("Use tool");
    const history = cortex.getHistory();

    // History: user msg, assistant tool_use, user tool_result, assistant text
    expect(history).toHaveLength(4);
    expect(history[0]!.role).toBe("user");
    expect(history[0]!.content).toBe("Use tool");
    expect(history[1]!.role).toBe("assistant");
    expect(Array.isArray(history[1]!.content)).toBe(true);
    expect(history[2]!.role).toBe("user");
    expect(Array.isArray(history[2]!.content)).toBe(true);
    expect(history[3]!.role).toBe("assistant");
    expect(history[3]!.content).toBe("Done");
  });

  test("no tools registered — skips tool_use in options", async () => {
    let passedOptions: any;
    const provider: LLMProvider = {
      name: "inspecting",
      defaultModel: "inspect",
      chat: async (_sys, _msgs, opts) => {
        passedOptions = opts;
        return textResponse("hi");
      },
    };

    const cortex = new Cortex({ injectedProvider: provider });
    await cortex.chat("Hello");
    expect(passedOptions.tools).toBeUndefined();
  });

  test("tools passed in options when registered", async () => {
    let passedOptions: any;
    const provider: LLMProvider = {
      name: "inspecting",
      defaultModel: "inspect",
      chat: async (_sys, _msgs, opts) => {
        passedOptions = opts;
        return textResponse("hi");
      },
    };

    const cortex = new Cortex({
      injectedProvider: provider,
      clearance: new ClearanceManager([]),
    });
    cortex.registerTool(mockTool());
    await cortex.chat("Hello");
    expect(passedOptions.tools).toBeDefined();
    expect(passedOptions.tools).toHaveLength(1);
    expect(passedOptions.tools[0].name).toBe("test-tool");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cortex-tools.test.ts`
Expected: FAIL — Cortex.chat() doesn't accept `clearance` or `maxToolIterations` in config, doesn't do the loop

**Step 3: Implement the agentic loop in `src/core/cortex.ts`**

Key changes to `Cortex`:

1. `CortexConfig` gains `clearance?: ClearanceManager` and `maxToolIterations?: number`
2. `Cortex` stores `clearance`, `maxToolIterations` (default 10)
3. `chat()` builds `ToolDefinition[]` from registered tools and passes in `ChatOptions`
4. `chat()` loops: if `ChatResponse.type === "tool_use"`, execute tools, push results, continue
5. `chat()` returns final text when `ChatResponse.type === "text"`
6. New private `executeToolCall()` method handles lookup, clearance, execution
7. New private `toToolDefinitions()` method converts `FridayTool[]` to `ToolDefinition[]`

```typescript
import type { FridayConfig, ConversationMessage, ContentBlock, ToolUseBlock as TypesToolUseBlock, ToolResultBlock } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
  type ChatResponse,
  type ToolDefinition,
} from "../providers/index.ts";
import type { FridayTool } from "../modules/types.ts";
import type { SmartsStore } from "../smarts/store.ts";
import type { Sensorium } from "../sensorium/sensorium.ts";
import type { ClearanceManager } from "./clearance.ts";

const DEFAULT_MAX_TOOL_ITERATIONS = 10;

export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  smartsStore?: SmartsStore;
  sensorium?: Sensorium;
  clearance?: ClearanceManager;
  maxToolIterations?: number;
}

export class Cortex {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];
  private tools: Map<string, FridayTool>;
  private smartsStore?: SmartsStore;
  private sensorium?: Sensorium;
  private clearance?: ClearanceManager;
  private maxToolIterations: number;
  private pinnedSmarts = new Set<string>();

  constructor(config: CortexConfig = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = config.injectedProvider ?? createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
    this.tools = new Map();
    this.smartsStore = config.smartsStore;
    this.sensorium = config.sensorium;
    this.clearance = config.clearance;
    this.maxToolIterations = config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  }

  // ... existing getters unchanged ...

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    try {
      const systemPrompt = await this.buildSystemPrompt(userMessage);
      const toolDefs = this.toToolDefinitions();
      const options = {
        model: this.model,
        maxTokens: this.maxTokens,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      };

      for (let i = 0; i < this.maxToolIterations; i++) {
        const response: ChatResponse = await this.provider.chat(
          systemPrompt,
          this.conversationHistory,
          options,
        );

        if (response.type === "text") {
          this.conversationHistory.push({ role: "assistant", content: response.text });
          return response.text;
        }

        // tool_use response — record assistant's tool calls
        const assistantBlocks: ContentBlock[] = response.toolCalls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
        }));
        this.conversationHistory.push({ role: "assistant", content: assistantBlocks });

        // Execute all tool calls in parallel
        const results = await Promise.all(
          response.toolCalls.map((tc) => this.executeToolCall(tc)),
        );

        // Record results
        const resultBlocks: ContentBlock[] = results.map((r) => ({
          type: "tool_result" as const,
          toolCallId: r.toolCallId,
          content: r.output,
          isError: r.isError,
        }));
        this.conversationHistory.push({ role: "user", content: resultBlocks });
      }

      throw new Error(`Max tool iterations (${this.maxToolIterations}) exceeded`);
    } catch (err) {
      // Roll back user message only if we haven't added any tool interactions
      if (this.conversationHistory.length > 0) {
        const lastUserMsg = this.conversationHistory[this.conversationHistory.length - 1];
        // Only pop if the last message IS the user message we added (no tool loop started)
        if (lastUserMsg?.role === "user" && lastUserMsg.content === userMessage) {
          // Check if it's the one we just pushed (first entry in this call)
          // Only roll back if no tool interactions were added
        }
      }
      // For simplicity: on error, roll back everything from this chat() call
      // Find the user message we pushed and remove everything from there
      const startIndex = this.conversationHistory.findIndex(
        (m, idx) => idx === this.conversationHistory.length - 1 && m.role === "user" && m.content === userMessage
      );
      // Actually, cleaner approach: track the starting length
      throw err;
    }
  }

  // ... rest of implementation ...
}
```

**IMPORTANT: Error rollback logic** — The current `chat()` pops the user message on error. With the loop, we may have added tool interactions. Track `startLength` before pushing the user message, then on error, truncate back:

```typescript
async chat(userMessage: string): Promise<string> {
  const startLength = this.conversationHistory.length;
  this.conversationHistory.push({ role: "user", content: userMessage });

  try {
    // ... loop ...
  } catch (err) {
    // Roll back all messages added during this call
    this.conversationHistory.length = startLength;
    throw err;
  }
}
```

**Step 4: Private helper `executeToolCall()`**

```typescript
private async executeToolCall(
  call: { id: string; name: string; input: Record<string, unknown> },
): Promise<{ toolCallId: string; output: string; isError: boolean }> {
  const tool = this.tools.get(call.name);
  if (!tool) {
    return { toolCallId: call.id, output: `Unknown tool: ${call.name}`, isError: true };
  }

  if (this.clearance && tool.clearance.length > 0) {
    const check = this.clearance.checkAll(tool.clearance);
    if (!check.granted) {
      return {
        toolCallId: call.id,
        output: check.reason ?? `Clearance denied for tool: ${call.name}`,
        isError: true,
      };
    }
  }

  try {
    const result = await tool.execute(call.input, {
      workingDirectory: process.cwd(),
      audit: { log: async () => {} } as any, // placeholder — will wire from runtime
      signal: { emit: async () => {} } as any,
      memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    });
    return { toolCallId: call.id, output: result.output, isError: !result.success };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolCallId: call.id, output: `Tool execution error: ${msg}`, isError: true };
  }
}
```

**Step 5: Private helper `toToolDefinitions()`**

```typescript
private toToolDefinitions(): ToolDefinition[] {
  return [...this.tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
```

**Step 6: Run tests**

Run: `bun test tests/unit/cortex-tools.test.ts`
Expected: PASS

**Step 7: Run ALL tests**

Run: `bun test`
Expected: All tests PASS (existing + new)

**Step 8: Commit**

```bash
git add src/core/cortex.ts tests/unit/cortex-tools.test.ts
git commit -m "feat(cortex): implement agentic tool loop with clearance checks and parallel execution"
```

---

### Task 9: Wire ClearanceManager and ToolContext from Runtime

**Files:**
- Modify: `src/core/cortex.ts` (add `CortexConfig.audit`, `CortexConfig.signals`, `CortexConfig.toolContext`)
- Modify: `src/core/runtime.ts`

**Step 1: Update `CortexConfig` and Cortex to accept audit/signals for ToolContext**

Add to `CortexConfig`:

```typescript
export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  smartsStore?: SmartsStore;
  sensorium?: Sensorium;
  clearance?: ClearanceManager;
  maxToolIterations?: number;
  audit?: AuditLogger;
  signals?: SignalBus;
  memory?: ScopedMemory;
}
```

Update `executeToolCall()` to use stored references instead of stubs.

**Step 2: Update `FridayRuntime.boot()` to pass clearance + audit + signals**

```typescript
this._cortex = new Cortex({
  ...config,
  injectedProvider: config.injectedProvider,
  smartsStore: this._smarts,
  sensorium: this._sensorium,
  clearance: this._clearance,
  audit: this._audit,
  signals: this._signals,
});
```

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/cortex.ts src/core/runtime.ts
git commit -m "feat(runtime): wire ClearanceManager, AuditLogger, and SignalBus into Cortex for tool execution"
```

---

### Task 10: Typecheck and Final Verification

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for agentic tool loop"
```

**Step 5: Run full verification**

Run: `bun test && bun run typecheck && bun run lint`
Expected: All three pass
