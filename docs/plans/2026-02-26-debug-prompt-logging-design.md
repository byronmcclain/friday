# Debug Prompt Logging Design

**Date:** 2026-02-26
**Status:** Approved

## Problem

Need visibility into the system prompt that Friday sends to the LLM provider for debugging prompt assembly issues (Genesis identity, SMARTS enrichment, Sensorium context). Currently the prompt is assembled and sent with no way to inspect it.

## Solution

Add a `--debug` global CLI flag that enables system prompt logging to both the audit subsystem and a file in the project root.

## Design

### CLI Flag

`--debug` added as a global option on the top-level Commander program in `src/cli/index.ts`. Available to all commands (chat, serve, genesis).

```
friday --debug chat
friday --debug serve
```

### Config Chain

The debug flag flows through the existing config pipeline:

1. `src/cli/index.ts` — `program.option("--debug", "Enable debug prompt logging")`
2. `RuntimeConfig` — add `debug?: boolean`
3. `CortexConfig` — add `debug?: boolean` and `projectRoot?: string`
4. `Cortex` constructor — store as `private debug: boolean` and `private debugLogPath?: string`

### Logging Location

In `Cortex.chat()`, immediately after `buildSystemPrompt()` returns, when `debug` is true:

1. **Audit entry** — `action: "debug:system-prompt"`, `source: "cortex"`, `detail: <system prompt>`
2. **File write** — overwrite `debug-prompt.log` in the project root via `Bun.write()`

### File Output

- **File name:** `debug-prompt.log`
- **Location:** Project root (resolved from `CortexConfig.projectRoot`)
- **Behavior:** Overwritten on every `chat()` call — always shows the most recent system prompt
- **Gitignore:** Added to `.gitignore`

### What Gets Logged

The fully assembled system prompt string after `buildSystemPrompt()` returns:
- Genesis identity prompt (or fallback `GENESIS_TEMPLATE`)
- SMARTS knowledge enrichment (pinned + FTS5-matched sections)
- Sensorium environment context block (or date/time fallback)

This is exactly the string passed as the first argument to `provider.chat()`.

### Log Frequency

Every `chat()` call. The system prompt is rebuilt per message (SMARTS enrichment and Sensorium context vary), so logging every call captures prompt drift.

### Not Logged

- Conversation history (messages array)
- Tool definitions
- Provider-specific formatting (Grok message conversion, Anthropic message blocks)

## Files Changed

| File | Change |
|------|--------|
| `src/cli/index.ts` | Add `--debug` global option |
| `src/cli/commands/chat.ts` | Pass `debug` option through to `launchTui()` |
| `src/cli/tui/app.tsx` | Accept `debug` in options, pass to `RuntimeConfig` |
| `src/core/runtime.ts` | Add `debug?: boolean` to `RuntimeConfig`, pass to `CortexConfig` |
| `src/core/cortex.ts` | Add `debug?: boolean` and `projectRoot?: string` to `CortexConfig`, log in `chat()` |
| `.gitignore` | Add `debug-prompt.log` |

## Approach Decision

**Chosen: Cortex-level interceptor** — minimal surface area, single interception point where the prompt is assembled.

Rejected alternatives:
- **Provider decorator** — clean separation but more boilerplate, would need audit/path plumbing
- **SignalBus event** — over-engineered for logging a single string, adds async overhead
