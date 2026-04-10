# Prompt Cache Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximize xAI prompt cache hits by routing all Cortex inference requests to the same server via the `x-grok-conv-id` header, scoped to the server session lifetime.

**Architecture:** Add an optional `sessionId` parameter to `createModel()` that creates a session-scoped xAI provider with the cache routing header. `FridayRuntime` generates a UUID at boot (reusing the existing `_sessionId` when available) and passes it through `CortexConfig` to Cortex.

**Tech Stack:** TypeScript, @ai-sdk/xai, Bun, bun:test

**Spec:** `docs/superpowers/specs/2026-03-22-prompt-cache-routing-design.md`

---

### Task 1: Extend `createModel()` with session-scoped provider

**Files:**
- Modify: `src/providers/index.ts:14-16`
- Test: `tests/unit/provider-create-model.test.ts`

- [ ] **Step 1: Run typecheck to establish baseline**

Run: `bun run typecheck`
Expected: PASS — confirms current code is clean before changes.

- [ ] **Step 2: Write the test (will fail typecheck)**

Add a test to `tests/unit/provider-create-model.test.ts`:

```typescript
test("creates model with session-scoped provider when sessionId is given", () => {
	const sessionId = "test-session-abc-123";
	const model = createModel(GROK_DEFAULTS.model, sessionId);
	expect(model.modelId).toContain("grok");
	expect(model.provider).toContain("xai");
});
```

- [ ] **Step 3: Verify typecheck fails**

Run: `bun run typecheck`
Expected: FAIL — `Expected 1 arguments, but got 2` on the `createModel(GROK_DEFAULTS.model, sessionId)` call.

Note: `bun test` would pass because JavaScript ignores extra arguments at runtime. The typecheck is the true red signal here.

Note: The `@ai-sdk/xai` SDK does not expose headers on the returned model object, so we cannot directly assert the `x-grok-conv-id` header is set. This test is a smoke test verifying the session-scoped code path produces a valid model without throwing.

- [ ] **Step 4: Implement `createModel()` sessionId parameter**

In `src/providers/index.ts`, change the `createModel` function to:

```typescript
/** Create an AI SDK LanguageModelV3 for the given Grok model ID.
 *  When sessionId is provided, creates a session-scoped provider with
 *  the x-grok-conv-id header for xAI prompt cache routing. */
export function createModel(modelId: string, sessionId?: string): LanguageModelV3 {
	if (!sessionId) return xai(modelId);

	const sessionXai = createXai({
		apiKey: process.env.XAI_API_KEY,
		headers: { "x-grok-conv-id": sessionId },
	});
	return sessionXai(modelId);
}
```

- [ ] **Step 5: Run typecheck and tests to verify they pass**

Run: `bun run typecheck && bun test tests/unit/provider-create-model.test.ts`
Expected: Typecheck PASS. All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/index.ts tests/unit/provider-create-model.test.ts
git commit -m "feat: add session-scoped cache routing to createModel()"
```

---

### Task 2: Thread sessionId through CortexConfig

**Files:**
- Modify: `src/core/cortex.ts:29-45` (CortexConfig interface)
- Modify: `src/core/cortex.ts:79` (constructor model creation)

- [ ] **Step 1: Add `sessionId` to `CortexConfig`**

In `src/core/cortex.ts`, add to the `CortexConfig` interface (after `injectedModel`):

```typescript
export interface CortexConfig extends Partial<FridayConfig> {
	injectedModel?: LanguageModelV3;
	sessionId?: string;
	// ... rest unchanged
}
```

- [ ] **Step 2: Pass `sessionId` to `createModel()` in constructor**

In the Cortex constructor (line 79), change:

```typescript
this.aiModel = config.injectedModel ?? createModel(this._modelName);
```

to:

```typescript
this.aiModel = config.injectedModel ?? createModel(this._modelName, config.sessionId);
```

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `bun test`
Expected: All tests pass. No existing test provides `sessionId`, so all use the headerless path. Tests using `injectedModel` bypass `createModel()` entirely.

- [ ] **Step 4: Commit**

```bash
git add src/core/cortex.ts
git commit -m "feat: thread sessionId through CortexConfig to createModel()"
```

---

### Task 3: Generate session UUID in FridayRuntime and pass to Cortex

**Files:**
- Modify: `src/core/runtime.ts:371-387` (Cortex construction in `boot()`)

- [ ] **Step 1: Pass session ID to Cortex constructor**

In `src/core/runtime.ts`, in the `boot()` method, just before the Cortex constructor call (line 371), add:

```typescript
const cacheSessionId = this._sessionId ?? crypto.randomUUID();
```

Then add `sessionId: cacheSessionId` to the Cortex constructor options:

```typescript
this._cortex = new Cortex({
	model: reasoningModel,
	maxTokens: config.maxTokens,
	injectedModel: config.injectedModel,
	sessionId: cacheSessionId,

	smartsStore: this._smarts,
	sensorium: this._sensorium,
	// ... rest unchanged
});
```

Note: `this._sessionId` is set on line 290 when `dataDir` is configured. The `?? crypto.randomUUID()` fallback ensures cache routing works even without SQLite persistence. Uses `crypto.randomUUID()` (Web Crypto API) for consistency with line 290.

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass. Runtime tests use `injectedModel` which bypasses `createModel()`.

- [ ] **Step 3: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: generate session UUID for xAI prompt cache routing"
```

---

### Task 4: Update CLAUDE.md and lint

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run lint**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Add brief note to CLAUDE.md**

In the `### Patterns & Gotchas` section, add:

```markdown
- **Prompt cache routing**: `createModel(modelId, sessionId?)` — when `sessionId` is provided, creates a session-scoped xAI provider with `x-grok-conv-id` header for cache routing. Runtime generates UUID at boot, reuses `_sessionId` when `dataDir` is configured. Fast/subsystem model intentionally omits session ID (one-shot calls don't benefit).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add prompt cache routing to patterns & gotchas"
```
