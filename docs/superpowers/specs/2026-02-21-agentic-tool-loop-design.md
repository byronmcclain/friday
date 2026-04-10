# Agentic Tool Loop Design

**Date:** 2026-02-21
**Status:** Approved

## Problem

Tools are registered into `Cortex.tools` Map via `registerTool()` but never passed to LLM providers. The `LLMProvider.chat()` interface returns `Promise<string>` with no mechanism for tool-use responses. There is no agentic loop to handle tool calls, execute tools, and feed results back to the LLM.

## Design Decisions

- **Max iterations:** 10 per `chat()` call (configurable via `CortexConfig`)
- **Clearance denial:** Return denial as `tool_result` so the LLM can adapt
- **Parallel tools:** Execute concurrent tool calls via `Promise.all`
- **Approach:** Provider-level abstraction — each provider handles its own API's tool format; Cortex owns the loop

## Architecture

### New Types (`src/providers/types.ts`)

```typescript
/** Tool call requested by the LLM */
interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Single chat turn result */
type ChatResponse =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCalls: ToolCallRequest[] };

/** Provider-agnostic tool definition */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/** Tool result to feed back */
interface ToolResultMessage {
  toolCallId: string;
  output: string;
  isError: boolean;
}
```

### Evolved `ConversationMessage` (`src/core/types.ts`)

```typescript
type MessageContent = string | ContentBlock[];

interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
interface ToolResultBlock { type: "tool_result"; toolCallId: string; content: string; isError: boolean }

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ConversationMessage {
  role: "user" | "assistant";
  content: MessageContent;
}
```

### Evolved `LLMProvider` Interface

```typescript
interface ChatOptions {
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
}

interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse>;
}
```

### Shared Tool Schema Converter (`src/providers/tool-schema.ts`)

Pure function to convert `ToolParameter[]` to JSON Schema `properties` + `required`:

```typescript
function toJsonSchema(params: ToolParameter[]): {
  type: "object";
  properties: Record<string, object>;
  required: string[];
}
```

Maps `ToolParameter.type` to JSON Schema types. Both providers use this.

### Provider Implementations

**AnthropicProvider:**
- `ToolDefinition` -> `{ name, description, input_schema: toJsonSchema(params) }`
- `ConversationMessage` -> Anthropic message format (content blocks for tool_use/tool_result)
- Parse `stop_reason === "tool_use"` -> extract `ToolUseBlock` entries -> `ChatResponse.tool_use`
- Parse `stop_reason === "end_turn"` -> extract text -> `ChatResponse.text`

**GrokProvider:**
- `ToolDefinition` -> `{ type: "function", function: { name, description, parameters: toJsonSchema(params) } }`
- `ConversationMessage` -> OpenAI message format (tool_calls on assistant, role: "tool" for results)
- Parse `finish_reason === "tool_calls"` -> extract tool_calls -> `ChatResponse.tool_use`
- Parse `finish_reason === "stop"` -> extract text -> `ChatResponse.text`

### Agentic Loop (`Cortex.chat()`)

```
chat(userMessage):
  push { role: "user", content: userMessage }
  systemPrompt = buildSystemPrompt(userMessage)
  toolDefs = toToolDefinitions(this.tools)

  for i in 0..maxIterations:
    response = provider.chat(systemPrompt, history, { tools: toolDefs })

    if response.type === "text":
      push { role: "assistant", content: response.text }
      return response.text

    if response.type === "tool_use":
      push { role: "assistant", content: toolUseBlocks }
      results = await Promise.all(toolCalls.map(executeToolCall))
      push { role: "user", content: toolResultBlocks }
      continue

  throw Error("Max tool iterations (10) exceeded")
```

**`executeToolCall(call)`:**
1. Lookup `this.tools.get(call.name)`
2. Not found -> `{ isError: true, output: "Unknown tool" }`
3. `clearance.checkAll(tool.clearance)` -> denied -> `{ isError: true, output: reason }`
4. `tool.execute(call.input, toolContext)` -> `{ isError: !result.success, output: result.output }`

### ClearanceManager Injection

`CortexConfig` gains `clearance?: ClearanceManager`. `FridayRuntime.boot()` passes `this._clearance` to Cortex.

### Runtime Changes

- `FridayRuntime.process()` unchanged — `cortex.chat()` still returns `Promise<string>` (final text extracted from loop)
- Tool registration unchanged
- Module loading unchanged

### Display and Storage

- `renderMarkdown()` in `src/cli/render.ts` — no change needed; Cortex returns the final text string
- `SQLiteMemory` conversation save/load — serialize `ContentBlock[]` as JSON when content is not a string
- History display — extract text blocks for human-readable output

## Files Changed

| File | Change |
|------|--------|
| `src/core/types.ts` | Evolve `ConversationMessage.content` to `MessageContent` union |
| `src/providers/types.ts` | Add `ChatResponse`, `ToolCallRequest`, `ToolDefinition`, `ToolResultMessage`; evolve `ChatOptions`, `LLMProvider` |
| `src/providers/tool-schema.ts` | **New** — `toJsonSchema()` converter |
| `src/providers/anthropic.ts` | Implement tool formatting, response parsing, message translation |
| `src/providers/grok.ts` | Implement tool formatting, response parsing, message translation |
| `src/core/cortex.ts` | Agentic loop, tool execution, clearance injection |
| `src/core/runtime.ts` | Pass `clearance` to CortexConfig |
| `src/core/memory.ts` | Handle `ContentBlock[]` in conversation serialization |
| `tests/helpers/stubs.ts` | Update `stubProvider` for `ChatResponse` return type |
| `tests/unit/*.test.ts` | Update existing tests, add agentic loop tests |

## Testing Strategy

- Stub provider returns `ChatResponse` (text or tool_use)
- Test scenarios: single tool call, parallel tool calls, clearance denial, unknown tool, max iterations, tool execution error, mixed text+tool responses
- Existing tests: wrap string returns as `{ type: "text", text: "..." }`
