# Cortex AI SDK Migration Design

## Overview

Replace Friday's hand-rolled provider layer and Cortex tool loop with the Vercel AI SDK, gaining unified multi-provider support, native streaming, and structured observability. Add token-budget conversation history management with auto-summarization.

## Motivation

The current Cortex (`src/core/cortex.ts`) manually implements an agentic tool loop (lines 137-190) that both the Anthropic and OpenAI SDKs provide natively. This results in:

- **Duplicated logic**: Two separate provider implementations (`anthropic.ts`, `grok.ts`) with parallel message conversion, tool schema translation, and response parsing
- **No streaming**: The `chat()` method blocks until the full response is ready — users wait 5-10 seconds staring at nothing
- **Unbounded history**: `conversationHistory` grows forever with no token management, eventually overflowing the context window
- **Tool block bloat**: Every tool_use/tool_result block is preserved in history, accelerating context exhaustion
- **Per-call overhead**: Tool definitions rebuilt, fallback objects recreated, `process.cwd()` called on every tool execution

The Vercel AI SDK (`ai` package) provides a unified interface across providers via `generateText`/`streamText` with `maxSteps`, eliminating the manual loop and unlocking streaming with a single implementation.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Vercel AI SDK (unified) | One tool loop, one message format, streaming for free. Eliminates dual-provider maintenance. |
| Provider migration | Full replacement | Clean break. Remove `@anthropic-ai/sdk` and `openai`, add `ai` + `@ai-sdk/xai` + `@ai-sdk/anthropic` + `zod`. |
| Tool loop | `streamText()` with `maxSteps` | SDK manages loop, tool execution, and message state internally. |
| Streaming | `streamText` from day one | TUI and web consume chunks. `chat()` wraps `chatStream().fullText` for backward compat. |
| History after tool loop | Final result only | Only user message + assistant text stored. Tool blocks logged to audit via `onStepFinish`. |
| Clearance integration | Middleware wrapper | `buildAiSdkTools()` wraps each `FridayTool.execute` with clearance check. Tools stay clean. |
| History management | Token-budget with auto-summarize | `HistoryManager` tracks tokens via `onStepFinish` usage. Summarizes older messages via fast model when exceeding 80% of context window. |
| Testing | `createMockModel()` | Replaces `stubProvider`/`grokStub`. Implements `LanguageModelV1` with configurable text/toolCalls/usage. |

## Section 1: Provider Layer Replacement

The entire `src/providers/` directory is simplified. `AnthropicProvider`, `GrokProvider`, and the `LLMProvider` interface are removed.

### New structure

```
src/providers/
├── index.ts           # createModel(providerName, modelId) → AI SDK LanguageModel
├── schemas.ts         # toZodSchema() — converts ToolParameter[] → Zod objects
├── debug-log.ts       # Kept — wired via onStepFinish instead of provider chat()
├── anthropic.ts       # Deleted
├── grok.ts            # Deleted
└── types.ts           # Deleted
```

### Dependencies

```diff
- "@anthropic-ai/sdk": "^0.39.0",
- "openai": "^4.80.0",
+ "ai": "^4.x",
+ "@ai-sdk/xai": "^1.x",
+ "@ai-sdk/anthropic": "^1.x",
+ "zod": "^3.x",
```

### The `createModel` function

```typescript
import { xai } from '@ai-sdk/xai';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1 } from 'ai';

function createModel(provider: ProviderName, modelId: string): LanguageModelV1 {
  switch (provider) {
    case "grok": return xai(modelId);
    case "anthropic": return anthropic(modelId);
  }
}
```

The AI SDK uses a model-as-value pattern. Instead of instantiating a class wrapping an API client, a function returns a lightweight model descriptor. The actual API client is created internally by the SDK when `generateText`/`streamText` is called.

### Environment variables

No changes. `@ai-sdk/xai` reads `XAI_API_KEY` and `@ai-sdk/anthropic` reads `ANTHROPIC_API_KEY` — same as today.

## Section 2: Cortex Tool Loop Replacement

The hand-rolled `for` loop at `cortex.ts:137-190` is replaced by a single `streamText()` call with `maxSteps`. The `executeToolCall()` method is eliminated. Tool execution is delegated to the AI SDK via `execute` callbacks on each tool definition.

### Current flow (removed)

```
chat() → buildSystemPrompt() → for loop {
  provider.chat() → check response type →
    text? → push to history, return
    tool_use? → push blocks → Promise.all(executeToolCall) → push results → loop
}
```

### New flow

```
chat() → buildSystemPrompt() → streamText({
  model, system, messages, tools, maxSteps,
  onStepFinish → audit log tool calls
}) → collect stream → return text
```

### The `chatStream()` method

```typescript
async chatStream(userMessage: string): Promise<ChatStream> {
  this.historyManager.push({ role: "user", content: userMessage });
  await this.historyManager.compact();

  const systemPrompt = await this.buildSystemPrompt(userMessage);
  const tools = this.buildAiSdkTools();

  const result = streamText({
    model: this.model,
    system: systemPrompt,
    messages: this.historyManager.toMessages(),
    tools,
    maxSteps: this.maxToolIterations,
    onStepFinish: ({ toolCalls, toolResults, usage }) => {
      for (const tc of toolCalls ?? []) {
        this.audit?.log({
          action: "tool:called",
          source: tc.toolName,
          detail: JSON.stringify(tc.args),
          success: true,
        });
      }
    },
  });

  const fullText = result.text.then((text) => {
    this.historyManager.push({ role: "assistant", content: text });
    if (this.vox?.mode !== "off") {
      this.vox.speak(text).catch(() => {});
    }
    return text;
  });

  return {
    textStream: result.textStream,
    fullText,
    usage: result.usage,
  };
}

// Blocking — backward compat for protocols, Arc Rhythm, tests
async chat(userMessage: string): Promise<string> {
  const stream = await this.chatStream(userMessage);
  return stream.fullText;
}
```

### The `buildAiSdkTools()` method

Converts `FridayTool[]` to AI SDK `tool()` definitions with clearance middleware wrapping:

```typescript
private buildAiSdkTools(): Record<string, CoreTool> {
  const result: Record<string, CoreTool> = {};
  for (const [name, fridayTool] of this.tools) {
    result[name] = tool({
      description: fridayTool.description,
      parameters: toZodSchema(fridayTool.parameters),
      execute: async (args) => {
        // Clearance check (middleware wrapper)
        if (fridayTool.clearance.length > 0 && this.clearance) {
          const check = this.clearance.checkAll(fridayTool.clearance);
          if (!check.granted) {
            return { success: false, output: check.reason ?? "Clearance denied" };
          }
        }
        return fridayTool.execute(args, this.toolContext);
      },
    });
  }
  return result;
}
```

The `toolContext` is computed once (in the constructor or lazily) instead of per-call, eliminating fallback object creation and `process.cwd()` calls.

### Key differences from today

1. No tool_use/tool_result blocks in history — only user message + final assistant text. Tool details go to audit via `onStepFinish`.
2. No `executeToolCall()` method — the AI SDK calls each tool's `execute` callback directly.
3. No manual ContentBlock assembly — the AI SDK owns the message format internally.
4. Streaming-native — the result is a stream from the start.
5. Error rollback simplifies — only 1 message to roll back (user), not N tool blocks.

## Section 3: Conversation History Management

A new `HistoryManager` handles token tracking and auto-summarization. Instead of `this.conversationHistory` being a raw unbounded array, it becomes a managed buffer with a token budget.

### Token tracking

The AI SDK provides `usage.promptTokens` and `usage.completionTokens` on every step via `onStepFinish`. These are accumulated for real token counts without estimation.

### The `HistoryManager` class

New file: `src/core/history-manager.ts`

```typescript
interface HistoryManagerConfig {
  maxTokens: number;          // e.g. 80% of model context window
  summarizer: ConversationSummarizer;
}

class HistoryManager {
  private messages: CoreMessage[] = [];
  private tokenCount = 0;
  private summaryPrefix?: string;

  push(message: CoreMessage, tokens?: number): void {
    this.messages.push(message);
    this.tokenCount += tokens ?? this.estimateTokens(message);
  }

  pop(): void {
    const removed = this.messages.pop();
    if (removed) {
      this.tokenCount -= this.estimateTokens(removed);
    }
  }

  async compact(): Promise<void> {
    if (this.tokenCount < this.config.maxTokens) return;

    const keepCount = Math.max(4, Math.floor(this.messages.length * 0.3));
    const old = this.messages.slice(0, -keepCount);
    const recent = this.messages.slice(-keepCount);

    const summary = await this.config.summarizer.summarize(old);
    this.summaryPrefix = summary;
    this.messages = recent;
    this.tokenCount = this.estimateTokens(recent) + this.estimateTokens(summary);
  }

  toMessages(): CoreMessage[] {
    if (this.summaryPrefix) {
      return [
        { role: "user", content: `[Previous context summary: ${this.summaryPrefix}]` },
        { role: "assistant", content: "Understood, I have the context." },
        ...this.messages,
      ];
    }
    return this.messages;
  }

  recordUsage(tokens: number): void {
    this.tokenCount = tokens; // calibrate with real API token count
  }
}
```

### Design decisions

- **Keep 30% of recent messages** — most recent context is highest value. Ratio is tunable.
- **Summary as synthetic user/assistant pair** — inserted at the start so the model has prior context without the full transcript.
- **`compact()` is async** — calls the fast model (Grok fast / Haiku). Adds slight latency only when budget is exceeded.
- **Reuses `ConversationSummarizer`** — existing summarizer from `src/core/summarizer.ts` gets reused for mid-session compaction.
- **Real token counts from `onStepFinish`** augmented with character-based estimates (`chars / 4`) for user messages where API counts aren't yet available.

## Section 4: Streaming Integration

### The `ChatStream` type

New file: `src/core/stream-types.ts`

```typescript
interface ChatStream {
  textStream: AsyncIterable<string>;
  fullText: Promise<string>;
  usage: Promise<{ promptTokens: number; completionTokens: number }>;
}
```

### Dual method pattern

- `chatStream()` — streaming, used by TUI and web
- `chat()` — blocking wrapper over `chatStream().fullText`, used by Arc Rhythm, Summarizer, tests

### TUI consumption

```typescript
const stream = await runtime.cortex.chatStream(userMessage);

for await (const chunk of stream.textStream) {
  dispatch({ type: "APPEND_CHUNK", chunk });
}

const fullText = await stream.fullText;
dispatch({ type: "MESSAGE_COMPLETE", text: fullText });
```

New state reducer actions: `APPEND_CHUNK` (appends to current assistant message) and `MESSAGE_COMPLETE` (finalizes it).

### Web server consumption

```typescript
const stream = await runtime.cortex.chatStream(userMessage);

for await (const chunk of stream.textStream) {
  ws.send(JSON.stringify({ type: "chunk", text: chunk }));
}

const fullText = await stream.fullText;
ws.send(JSON.stringify({ type: "message", text: fullText }));
```

New `chunk` message type added to `src/server/protocol.ts`.

### Tool execution during streaming

When the model requests a tool call mid-stream, the AI SDK pauses the text stream, executes the tool via the `execute` callback, feeds the result back, and resumes streaming. From the consumer's perspective, chunks keep arriving with a pause during tool execution. No special handling needed.

### Vox (voice)

Stays fire-and-forget on `fullText` completion. Streaming individual chunks to TTS would create choppy audio.

## Section 5: Testing Strategy

### Mock provider

The `injectedProvider` pattern is replaced by `injectedModel`:

```typescript
interface CortexConfig {
  injectedModel?: LanguageModelV1;  // replaces injectedProvider
  // ...
}
```

### `createMockModel()` test helper

New in `tests/helpers/stubs.ts`:

```typescript
function createMockModel(options?: {
  text?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  usage?: { promptTokens: number; completionTokens: number };
}): LanguageModelV1
```

Implements `doGenerate()` and `doStream()` with configurable responses.

### Test migration

Mechanical replacement:

```diff
- const cortex = new Cortex({ injectedProvider: stubProvider });
+ const cortex = new Cortex({ injectedModel: createMockModel() });
```

### Deleted tests

Provider-specific tests (`toAnthropicMessages`, `toGrokMessages`, `parseGrokResponse`, etc.) are deleted along with the provider files. Provider-specific behavior is tested by the AI SDK maintainers.

### ConversationSummarizer and SmartsCurator

Both accept `LanguageModelV1` instead of `LLMProvider` and use `generateText()` internally.

## Section 6: File Changes

### New files

| File | Purpose |
|---|---|
| `src/core/history-manager.ts` | Token-budget sliding window with auto-summarization |
| `src/core/stream-types.ts` | `ChatStream` interface definition |
| `src/providers/schemas.ts` | `toZodSchema()` — converts `ToolParameter[]` to Zod objects |

### Deleted files

| File | Reason |
|---|---|
| `src/providers/anthropic.ts` | Replaced by `@ai-sdk/anthropic` |
| `src/providers/grok.ts` | Replaced by `@ai-sdk/xai` |
| `src/providers/types.ts` | AI SDK owns these types |
| `src/providers/tool-schema.ts` | Replaced by `schemas.ts` (Zod-based) |

### Modified files

| File | Changes |
|---|---|
| `src/providers/index.ts` | `createProvider()` → `createModel()`, remove `LLMProvider` export |
| `src/core/cortex.ts` | Major rewrite — `streamText` replaces tool loop, `HistoryManager` replaces raw array, `buildAiSdkTools()`, `chatStream()` added |
| `src/core/types.ts` | `ConversationMessage` aligns with AI SDK `CoreMessage` |
| `src/core/runtime.ts` | Boot: `createModel()` instead of `createProvider()`, pass `LanguageModelV1` |
| `src/core/summarizer.ts` | Accept `LanguageModelV1`, use `generateText()` |
| `src/smarts/curator.ts` | Accept `LanguageModelV1`, use `generateText()` |
| `src/cli/tui/app.tsx` | Consume `chatStream()` with chunk dispatch |
| `src/cli/tui/state.ts` | Add `APPEND_CHUNK` and `MESSAGE_COMPLETE` actions |
| `src/server/handler.ts` | Stream chunks over WebSocket |
| `src/server/protocol.ts` | Add `chunk` message type |
| `tests/helpers/stubs.ts` | Replace `stubProvider`/`grokStub` with `createMockModel()` |
| `tests/unit/*.test.ts` | `injectedProvider` → `injectedModel` migration |
| `package.json` | Dependency swap |

### Unchanged

Modules, protocols, directives, clearance, events, memory, SMARTS store, Sensorium, Genesis, Vox internals, Arc Rhythm. The `FridayTool` interface stays identical.

## Section 7: Error Handling

### AI SDK error mapping

| AI SDK Error | Handling |
|---|---|
| `APICallError` (network/auth) | Catch in `chatStream()`, roll back user message from history |
| Tool `execute` throws | AI SDK feeds error back to model as tool result — model retries or explains |
| `maxSteps` exceeded | AI SDK stops gracefully. Detect via final `finishReason === "tool-calls"` in `onStepFinish`, append truncation warning. |

### Clearance denial

When the middleware wrapper denies a tool call, it returns an error string. The AI SDK treats this as a tool result and feeds it back to the model, which explains the denial conversationally. This is a UX improvement over today's silent error return.

### Error rollback

Simplified to one path — if the API call fails before streaming starts, pop the user message from `HistoryManager`. Tool errors during streaming are handled conversationally by the AI SDK (fed back to the model), never thrown.

## Section 8: Debug & Observability

### System prompt logging (preserved)

The `--debug` flag continues to write the assembled system prompt to `debug-prompt.log` before streaming starts. Same behavior as today.

### New structured observability via `onStepFinish`

```typescript
onStepFinish: ({ stepType, finishReason, toolCalls, toolResults, usage }) => {
  // Tool call audit
  for (const tc of toolCalls ?? []) {
    this.audit?.log({ action: "tool:called", source: tc.toolName, ... });
  }
  // Tool result audit
  for (const tr of toolResults ?? []) {
    this.audit?.log({ action: "tool:result", source: tr.toolName, ... });
  }
  // Per-step token usage (always, not just debug)
  this.audit?.log({
    action: "cortex:step",
    source: "cortex",
    detail: `${stepType} | ${finishReason} | ${usage.promptTokens}+${usage.completionTokens} tokens`,
    success: true,
  });
}
```

This provides a structured timeline in the audit log: system prompt → step 1 (tool call) → step 1 result → step 2 (text, N tokens) → done.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@ai-sdk/xai` doesn't support a Grok feature we depend on | We use standard chat + tools. No Grok-specific features used. |
| AI SDK churn | Pinned versions. Provider packages are production-grade. |
| `LanguageModelV1` interface changes | V1 spec is stable and versioned. |
| `zod` added as dependency | Peer dep of AI SDK. Well-established, zero-dep library. |
| Streaming breaks TUI rendering | `chat()` wrapper provides non-streaming fallback. |

## What Improves

- Tool loop eliminated from Cortex (~60 lines removed)
- Streaming to TUI and web
- Token-aware history prevents context window overflow
- Structured audit trail per step
- Tool errors handled conversationally by the model
- Clearance denials explained by the model to the user
- Provider layer shrinks from ~280 lines to ~20 lines
- Env vars unchanged — zero `.env` migration
- Net code reduction estimated at 200-300 lines
