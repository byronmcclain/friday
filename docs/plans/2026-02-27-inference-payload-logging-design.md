# Inference Payload & Response Logging Design

**Date**: 2026-02-27
**Status**: Approved
**Motivation**: Debug suspected LLM hallucinations by capturing the exact wire-format payloads sent to and received from providers.

## Overview

When `--debug` is active, every `provider.chat()` call appends to two log files in the project root:

- `last-inference-payload.log` — provider-specific request payload (JSON)
- `last-inference-response.log` — raw API response (JSON)

Files are cleared at the start of each `Cortex.chat()` call, then each tool loop round appends with a timestamp separator. This replaces the existing `debug-prompt.log` (which only captured the system prompt).

## Log Format

Each entry in the log files follows this format:

```
═══ [2026-02-27T14:30:05.123Z] Round 1 ═══════════════════════
{
  "model": "grok-4-1-fast-reasoning-latest",
  "max_tokens": 12288,
  "messages": [ ... ],
  "tools": [ ... ]
}
```

The response file mirrors the same separator style with the raw API response JSON.

## Design

### Approach: Provider-Level Interceptor

Logging happens **inside each provider's `chat()` method** — the only place where the true wire-format payload exists. This captures exactly what the SDK sends to the API and what comes back, with no abstraction layer in between.

### ChatOptions Extension

Add an optional `debug` field to `ChatOptions` in `src/providers/types.ts`:

```ts
export interface ChatOptions {
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
  debug?: {
    payloadPath: string;
    responsePath: string;
    round: number;
  };
}
```

- `payloadPath`: absolute path to `last-inference-payload.log`
- `responsePath`: absolute path to `last-inference-response.log`
- `round`: 1-indexed round number for the separator header

### Provider Changes

Both `AnthropicProvider.chat()` and `GrokProvider.chat()`:

1. After constructing the provider-specific params object, if `options.debug` is set, append the params JSON to `payloadPath`
2. After receiving the raw API response, append the response JSON to `responsePath`
3. All file writes wrapped in try/catch — logging never interrupts the primary chat function

### Cortex Integration

In `Cortex.chat()`:

1. At the start of the method (before the tool loop), if `this.debug`, clear both log files by overwriting with empty string
2. In the tool loop, pass `debug` info through `ChatOptions` with the current round number
3. Remove the existing `debug-prompt.log` write (redundant — the payload log contains the full system prompt)
4. Remove `this.debugLogPath` field (replaced by the new log paths)

### File I/O

- `appendFile` from `node:fs/promises` for round-by-round appending (same pattern as AuditLogChannel)
- `Bun.write()` for clearing files at the start of `chat()`
- All writes wrapped in try/catch with `debug:inference-write-failed` audit entries on failure

## Error Handling

- File write failures never interrupt the chat flow
- If `projectRoot` is not set, debug logging is silently skipped
- Audit entry `debug:inference-write-failed` logged on any write failure

## Testing

- Unit tests for both providers: mock SDK client, verify wire-format payload and response are appended when `options.debug` is set
- Test separator format and round numbering
- Test file clearing at start of `chat()` and appending per round
- Test that `debug` undefined skips logging entirely
- Existing tests unaffected since `debug` is optional on `ChatOptions`

## Files Modified

| File | Change |
|------|--------|
| `src/providers/types.ts` | Add `debug?` field to `ChatOptions` |
| `src/providers/anthropic.ts` | Append payload + response to log files in `chat()` |
| `src/providers/grok.ts` | Append payload + response to log files in `chat()` |
| `src/core/cortex.ts` | Clear log files at chat() start, pass debug in options, remove debug-prompt.log logic |
| Tests | New test cases for both providers + cortex integration |

## Supersedes

- `debug-prompt.log` — removed, fully replaced by `last-inference-payload.log`
- Existing debug system prompt audit entry retained (still useful for audit trail)
