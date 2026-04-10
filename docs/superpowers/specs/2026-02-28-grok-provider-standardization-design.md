# Grok Provider Standardization Design

**Date:** 2026-02-28
**Status:** Approved
**Effort:** Small — primarily deletions across ~16 files

## Goal

Standardize Friday on Grok (xAI) as the sole LLM provider. Remove all multi-provider abstraction code, the `@ai-sdk/anthropic` dependency, and the `--provider` CLI flag. Keep `--model` and `--fast-model` flags for switching between Grok model variants.

## Context

Friday currently supports two providers via a factory pattern in `src/providers/index.ts`:
- **Grok** (xAI) — default provider, `@ai-sdk/xai`
- **Anthropic** — optional, `@ai-sdk/anthropic`

The multi-provider abstraction is clean and well-isolated — there is only a single `import { anthropic }` in the entire codebase. The `ProviderName` type union and `PROVIDER_DEFAULTS` record are the two coordination points. This makes removal surgical.

The Grok API does not require alternating user→assistant message pairs (unlike Anthropic), which simplifies the HistoryManager's concerns.

## Design

### 1. Provider Factory (`src/providers/index.ts`)

Replace the multi-provider factory with a single-provider wrapper:

```typescript
// BEFORE
import { xai } from "@ai-sdk/xai";
import { anthropic } from "@ai-sdk/anthropic";

export const DEFAULT_PROVIDER: ProviderName = "grok";
export const PROVIDER_DEFAULTS: Record<ProviderName, { model: string; fastModel: string }> = {
    anthropic: { model: "claude-sonnet-4-20250514", fastModel: "claude-haiku-4-5-20251001" },
    grok: { model: "grok-4-1-fast-reasoning-latest", fastModel: "grok-4-1-fast-non-reasoning" },
};

export function createModel(provider: ProviderName, modelId: string): LanguageModelV3 {
    switch (provider) {
        case "grok": return xai(modelId);
        case "anthropic": return anthropic(modelId);
        default: throw new Error(`Unknown provider: ${provider}`);
    }
}

// AFTER
import { xai } from "@ai-sdk/xai";

export const GROK_DEFAULTS = {
    model: "grok-4-1-fast-reasoning-latest",
    fastModel: "grok-4-1-fast-non-reasoning",
} as const;

export function createModel(modelId: string): LanguageModelV3 {
    return xai(modelId);
}
```

- `createModel()` signature changes from `(provider, modelId)` to `(modelId)`
- `PROVIDER_DEFAULTS` record replaced by `GROK_DEFAULTS` constant
- `DEFAULT_PROVIDER` constant removed (no longer needed)

### 2. Type System (`src/core/types.ts`)

- Delete `ProviderName` type entirely
- Remove `provider` field from `FridayConfig`

```typescript
// AFTER
export interface FridayConfig {
    model: string;
    fastModel?: string;
    maxTokens: number;
}
```

`RuntimeConfig` and `CortexConfig` (which extend `Partial<FridayConfig>`) automatically lose the `provider` field — no changes needed in their interface definitions.

### 3. Runtime Model Resolution (`src/core/runtime.ts`)

Simplify boot-time model resolution:

```typescript
// BEFORE
const providerName: ProviderName = config.provider ?? "grok";
const defaults = PROVIDER_DEFAULTS[providerName];
const reasoningModel = config.model ?? process.env.FRIDAY_REASONING_MODEL ?? defaults.model;
this._fastModel = config.fastModel ?? process.env.FRIDAY_FAST_MODEL ?? defaults.fastModel;

// AFTER
const reasoningModel = config.model ?? process.env.FRIDAY_REASONING_MODEL ?? GROK_DEFAULTS.model;
this._fastModel = config.fastModel ?? process.env.FRIDAY_FAST_MODEL ?? GROK_DEFAULTS.fastModel;
```

Resolution chain preserved: CLI flag > env var > default constant.

Remove `providerName` field from Runtime, `cortex.providerName`, and any related getters.

### 4. Cortex (`src/core/cortex.ts`)

- Remove `providerName` property/getter if present
- Update `createModel()` calls to single-param signature
- No changes to streaming, tool registration, or system prompt logic

### 5. CLI Commands (`src/cli/commands/chat.ts`, `serve.ts`)

- Remove `--provider` / `-p` option from both commands
- Keep `--model` and `--fast-model` options unchanged
- Remove `provider` from options objects passed to TUI/server runtime

### 6. Server Protocol (`src/server/protocol.ts`, `handler.ts`)

- Remove `provider` from `ClientMessage["session:boot"]` type
- Remove `provider` from `ServerMessage["session:booted"]` type
- Remove provider handling in WebSocket handler

### 7. TUI (`src/cli/tui/app.tsx`)

- Remove `provider` from `FridayAppProps.options` interface
- Remove `provider` from runtime config construction

### 8. Tests

| File | Change |
|------|--------|
| `provider-create-model.test.ts` | Remove anthropic test case, update to single-param `createModel()` |
| `runtime.test.ts` | Remove provider resolution tests, simplify model override tests |
| `serve-command.test.ts` | Remove `--provider` option test |
| `cortex-ai-sdk.test.ts` | Remove any `provider` config fields |
| `friday.test.ts` | Remove `provider` from configs |
| Other test files | Remove `provider: "grok"` config fields where present |

### 9. Documentation

- **README.md**: Remove `ANTHROPIC_API_KEY` env var, `--provider` flag docs, Anthropic examples
- **CLAUDE.md**: Remove Anthropic references from environment section, provider architecture notes
- **.env.example**: Remove `ANTHROPIC_API_KEY` entry
- **GENESIS_TEMPLATE** (`src/core/prompts.ts`): Evaluate if Friday's identity prompt references multi-provider — update if so

### 10. Dependency Removal

Remove from `package.json`:
```json
"@ai-sdk/anthropic": "^3.0.48"
```

Run `bun install` to clean lockfile.

## Files Changed

### Source (13 files):
1. `src/providers/index.ts` — factory simplification
2. `src/core/types.ts` — remove ProviderName, FridayConfig.provider
3. `src/core/runtime.ts` — simplify model resolution
4. `src/core/cortex.ts` — remove providerName, update createModel calls
5. `src/cli/commands/chat.ts` — remove --provider flag
6. `src/cli/commands/serve.ts` — remove --provider flag
7. `src/cli/tui/app.tsx` — remove provider from props
8. `src/server/protocol.ts` — remove provider from messages
9. `src/server/handler.ts` — remove provider handling
10. `src/server/index.ts` — remove provider pass-through
11. `src/core/prompts.ts` — update GENESIS_TEMPLATE if needed
12. `package.json` — remove @ai-sdk/anthropic
13. `bun.lock` — regenerated

### Tests (~7 files):
14. `tests/unit/provider-create-model.test.ts`
15. `tests/unit/runtime.test.ts`
16. `tests/unit/serve-command.test.ts`
17. `tests/unit/cortex-ai-sdk.test.ts`
18. `tests/unit/friday.test.ts`
19. Other test files with `provider` in config objects

### Documentation (3 files):
20. `README.md`
21. `CLAUDE.md`
22. `.env.example`

## Risk Assessment

**Low risk.** This is primarily a deletion task. The multi-provider abstraction is well-isolated with a single import of `@ai-sdk/anthropic`. No behavioral logic changes — just removing an indirection layer. All existing Grok functionality is preserved unchanged.

The `--model` and `--fast-model` override chain is preserved, so switching between Grok model variants (e.g., reasoning vs non-reasoning, different generations) remains fully supported.
