# Prompt Cache Routing Design

## Problem

xAI Grok supports automatic prompt caching — when consecutive requests share a common prefix, cached input tokens are billed at 75% discount ($0.05/1M vs $0.20/1M for `grok-4-1-fast-reasoning`). However, without the `x-grok-conv-id` HTTP header, requests scatter across servers and rarely hit the same cache. Friday currently creates the xAI provider once at module load with no session routing, leaving cache hits to chance.

## Goal

Maximize prompt cache hit rates by routing all Cortex inference requests within a server session to the same xAI server via the `x-grok-conv-id` header.

## Non-Goals

- Observability/monitoring of cached token counts
- Caching for the fast/subsystem model (short one-shot calls)
- Persisting the session UUID across server restarts
- New config options or env vars

## Background

xAI prompt caching is fully automatic (unlike Anthropic's explicit `cache_control` blocks). The key optimization lever is the `x-grok-conv-id` header, which routes requests to the same physical server for better cache locality. Friday's prompt structure is already cache-friendly: the Genesis system prompt, SMARTS knowledge sections, and Sensorium context are front-loaded and stable within a session, with only new user messages appended at the end.

## Approach: Session-Scoped Provider Factory

Generate a UUID when `FridayRuntime` boots. Pass it through `CortexConfig` to `createModel()`, which creates a session-scoped xAI provider instance with the `x-grok-conv-id` header. Callers without a session ID (fast model, tests, curator) get the existing headerless provider.

## Changes

### `src/providers/index.ts`

Add optional `sessionId` parameter to `createModel()`:

```typescript
export function createModel(modelId: string, sessionId?: string): LanguageModelV3 {
  if (!sessionId) return xai(modelId);

  const sessionXai = createXai({
    apiKey: process.env.XAI_API_KEY,
    headers: { "x-grok-conv-id": sessionId },
  });
  return sessionXai(modelId);
}
```

The base `xai` provider (module-level, no headers) is preserved for callers that don't need session routing.

### `src/core/cortex.ts`

Add `sessionId?: string` to `CortexConfig`. Use it in the constructor:

```typescript
export interface CortexConfig extends Partial<FridayConfig> {
  sessionId?: string;
  injectedModel?: LanguageModelV3;
  // ... rest unchanged
}

// In constructor:
this.aiModel = config.injectedModel ?? createModel(this._modelName, config.sessionId);
```

`injectedModel` (used in all tests) takes priority over `createModel()`, so session ID is irrelevant when mocking.

### `src/core/runtime.ts`

Reuse the existing `this._sessionId` (set via `crypto.randomUUID()` when `dataDir` is configured) for cache routing. For the case where `dataDir` is not configured (no SQLite), generate a dedicated UUID so cache routing always works:

```typescript
// In boot(), after memory initialization:
const cacheSessionId = this._sessionId ?? crypto.randomUUID();

this._cortex = new Cortex({
  model: reasoningModel,
  sessionId: cacheSessionId,
  injectedModel: config.injectedModel,
  // ... rest unchanged
});
```

Uses `crypto.randomUUID()` (Web Crypto API) for consistency with existing codebase (not `node:crypto` import).

The fast/subsystem model on line 426 (`createModel(this._fastModel)`) is not changed — its one-shot calls don't benefit from session routing.

## Testing

- One new unit test for `createModel()` verifying that when `sessionId` is provided, the returned model is created from a provider with the `x-grok-conv-id` header.
- All existing tests are unaffected — they use `injectedModel` which bypasses `createModel()`.

## Expected Impact

The Genesis prompt (~1-2k tokens) + SMARTS sections + Sensorium context are stable across a session. With `x-grok-conv-id` routing all Cortex requests to the same server, these prefix tokens should cache consistently, yielding ~75% savings on the cached portion of every inference call.
