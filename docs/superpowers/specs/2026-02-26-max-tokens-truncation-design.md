# Max Tokens Bump + Truncation Warning

**Date:** 2026-02-26
**Status:** Approved

## Problem

Cortex defaults to `maxTokens: 4096`, which silently truncates longer LLM responses. Neither the Grok nor Anthropic provider checks `finish_reason` / `stop_reason`, so truncated output is returned to the user with no warning.

## Solution

Approach A (Minimal): Bump the default to 12288 (3x) and surface truncation as a visible warning.

## Changes

### 1. Bump default maxTokens

**File:** `src/core/cortex.ts`
Change `config.maxTokens ?? 4096` → `config.maxTokens ?? 12288`

### 2. Surface truncation from providers

**File:** `src/providers/types.ts`
Add `truncated: boolean` to the text variant of `ChatResponse`:

```typescript
export type ChatResponse =
  | { type: "text"; text: string; truncated: boolean }
  | { type: "tool_use"; toolCalls: ToolCallRequest[] };
```

**File:** `src/providers/grok.ts` — `parseGrokResponse()`
Check `choice.finish_reason === "length"` → set `truncated: true` on text response.

**File:** `src/providers/anthropic.ts` — `parseAnthropicResponse()`
Check `response.stop_reason === "max_tokens"` → set `truncated: true` on text response.

### 3. Cortex appends warning

**File:** `src/core/cortex.ts` — `chat()` method
After receiving a text response, check `response.truncated` and append:

```
\n\n⚠ [Response truncated — hit token limit]
```

Warning goes into conversation history and is visible in TUI/web output. Vox would also speak it.

### 4. Tests

- `parseGrokResponse`: assert `truncated: false` on normal, `truncated: true` on `finish_reason: "length"`
- `parseAnthropicResponse`: assert `truncated: false` on normal, `truncated: true` on `stop_reason: "max_tokens"`
- Cortex `chat()`: verify truncation warning appended when provider returns `truncated: true`

## Files touched

1. `src/core/cortex.ts` — default bump + warning append
2. `src/providers/types.ts` — `truncated` field
3. `src/providers/grok.ts` — `parseGrokResponse` checks `finish_reason`
4. `src/providers/anthropic.ts` — `parseAnthropicResponse` checks `stop_reason`
5. Provider and Cortex test files

## What doesn't change

- No new CLI flags or env vars
- No changes to `FridayConfig`, `RuntimeConfig`, or `ChatOptions`
- No changes to TUI rendering (warning is just text)
- `tool_use` responses don't get `truncated` — invalid JSON already errors
