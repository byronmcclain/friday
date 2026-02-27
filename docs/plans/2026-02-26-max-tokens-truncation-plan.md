# Max Tokens Bump + Truncation Warning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bump the default maxTokens from 4096 to 12288 and surface a visible warning when LLM responses are truncated due to hitting the token limit.

**Architecture:** Add a `truncated` boolean to the text variant of `ChatResponse`. Both providers (Grok, Anthropic) set it based on their respective stop-reason fields. Cortex checks it and appends a warning tag to the response text.

**Tech Stack:** TypeScript, bun:test

---

### Task 1: Add `truncated` field to ChatResponse type

**Files:**
- Modify: `src/providers/types.ts:18-20`

**Step 1: Write the change**

Update the `ChatResponse` type union to include `truncated` on the text variant:

```typescript
export type ChatResponse =
  | { type: "text"; text: string; truncated: boolean }
  | { type: "tool_use"; toolCalls: ToolCallRequest[] };
```

**Step 2: Update the test helper**

Modify `tests/helpers/stubs.ts` — the `textResponse()` helper must include `truncated: false`:

```typescript
export function textResponse(text: string): ChatResponse {
	return { type: "text", text, truncated: false };
}
```

**Step 3: Run typecheck to find any other places that construct `{ type: "text" }` responses**

Run: `bun run typecheck`
Expected: Errors in `src/providers/grok.ts` and `src/providers/anthropic.ts` (the parse functions) — these are fixed in Tasks 2 and 3.

**Step 4: Commit**

```bash
git add src/providers/types.ts tests/helpers/stubs.ts
git commit -m "feat: add truncated field to ChatResponse text variant"
```

---

### Task 2: Surface truncation in Grok provider

**Files:**
- Modify: `src/providers/grok.ts:109-132` (parseGrokResponse)
- Test: `tests/unit/grok-provider.test.ts`

**Step 1: Write the failing test — normal response includes truncated: false**

Add to the `parseGrokResponse` describe block in `tests/unit/grok-provider.test.ts`:

```typescript
test("sets truncated to false on normal stop", () => {
  const choice = {
    finish_reason: "stop",
    message: {
      content: "Hello!",
      tool_calls: undefined,
    },
  };

  const result = parseGrokResponse(choice);

  expect(result).toEqual({
    type: "text",
    text: "Hello!",
    truncated: false,
  });
});
```

**Step 2: Write the failing test — length-truncated response**

Add to the same describe block:

```typescript
test("sets truncated to true when finish_reason is length", () => {
  const choice = {
    finish_reason: "length",
    message: {
      content: "This response was cut sh",
      tool_calls: undefined,
    },
  };

  const result = parseGrokResponse(choice);

  expect(result).toEqual({
    type: "text",
    text: "This response was cut sh",
    truncated: true,
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test tests/unit/grok-provider.test.ts`
Expected: FAIL — `truncated` field missing from response object.

**Step 4: Implement — update parseGrokResponse**

In `src/providers/grok.ts`, modify the `parseGrokResponse` function. Change the text return (around line 131) from:

```typescript
return { type: "text", text };
```

to:

```typescript
return { type: "text", text, truncated: choice.finish_reason === "length" };
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/grok-provider.test.ts`
Expected: ALL PASS

**Step 6: Also update the existing "parses a text response" test**

The existing test at line 282-297 asserts `toEqual` without `truncated`. Update its expected value to include `truncated: false`. The test already has `finish_reason: "stop"` so the value should be false.

**Step 7: Run full test suite to check for regressions**

Run: `bun test`
Expected: ALL PASS (no other tests should break since stubs.ts was updated in Task 1)

**Step 8: Commit**

```bash
git add src/providers/grok.ts tests/unit/grok-provider.test.ts
git commit -m "feat(grok): surface finish_reason length as truncated flag"
```

---

### Task 3: Surface truncation in Anthropic provider

**Files:**
- Modify: `src/providers/anthropic.ts:70-95` (parseAnthropicResponse)
- Test: `tests/unit/anthropic-provider.test.ts`

**Step 1: Write the failing test — normal response includes truncated: false**

Add to the `parseAnthropicResponse` describe block in `tests/unit/anthropic-provider.test.ts`:

```typescript
test("sets truncated to false on normal end_turn", () => {
  const response = {
    content: [
      { type: "text" as const, text: "Hello!" },
    ],
    stop_reason: "end_turn" as const,
  };

  const result = parseAnthropicResponse(response);

  expect(result).toEqual({
    type: "text",
    text: "Hello!",
    truncated: false,
  });
});
```

**Step 2: Write the failing test — max_tokens truncated response**

```typescript
test("sets truncated to true when stop_reason is max_tokens", () => {
  const response = {
    content: [
      { type: "text" as const, text: "This response was cut sh" },
    ],
    stop_reason: "max_tokens" as const,
  };

  const result = parseAnthropicResponse(response);

  expect(result).toEqual({
    type: "text",
    text: "This response was cut sh",
    truncated: true,
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test tests/unit/anthropic-provider.test.ts`
Expected: FAIL — `truncated` field missing.

**Step 4: Implement — update parseAnthropicResponse**

In `src/providers/anthropic.ts`, the `parseAnthropicResponse` function needs the `stop_reason` to determine truncation. Change the text return (around line 94) from:

```typescript
return { type: "text", text };
```

to:

```typescript
return { type: "text", text, truncated: response.stop_reason === "max_tokens" };
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/anthropic-provider.test.ts`
Expected: ALL PASS

**Step 6: Update existing "parses a text response" and "joins multiple text blocks" tests**

Both existing text-response tests use `toEqual` without `truncated`. Add `truncated: false` to their expected values.

**Step 7: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/providers/anthropic.ts tests/unit/anthropic-provider.test.ts
git commit -m "feat(anthropic): surface stop_reason max_tokens as truncated flag"
```

---

### Task 4: Bump default maxTokens and append truncation warning in Cortex

**Files:**
- Modify: `src/core/cortex.ts:57` (default), `src/core/cortex.ts:118-126` (chat method)
- Test: `tests/unit/friday.test.ts`

**Step 1: Write the failing test — truncation warning appended**

Add to the `Cortex` describe block in `tests/unit/friday.test.ts`:

```typescript
test("appends truncation warning when response is truncated", async () => {
  const truncatingProvider: LLMProvider = {
    name: "stub",
    defaultModel: "stub-model",
    defaultFastModel: "stub-fast",
    chat: async () => ({ type: "text" as const, text: "partial output", truncated: true }),
  };
  const cortex = new Cortex({ injectedProvider: truncatingProvider });
  const result = await cortex.chat("tell me everything");

  expect(result).toContain("partial output");
  expect(result).toContain("[Response truncated");
});
```

**Step 2: Write the failing test — no warning on normal response**

```typescript
test("does not append truncation warning on normal response", async () => {
  const normalProvider: LLMProvider = {
    name: "stub",
    defaultModel: "stub-model",
    defaultFastModel: "stub-fast",
    chat: async () => ({ type: "text" as const, text: "full output", truncated: false }),
  };
  const cortex = new Cortex({ injectedProvider: normalProvider });
  const result = await cortex.chat("hello");

  expect(result).toBe("full output");
  expect(result).not.toContain("[Response truncated");
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — the first test fails because no truncation warning is appended yet.

**Step 4: Implement — bump default and add warning**

In `src/core/cortex.ts`:

**4a.** Change line 57 from:
```typescript
this.maxTokens = config.maxTokens ?? 4096;
```
to:
```typescript
this.maxTokens = config.maxTokens ?? 12288;
```

**4b.** In the `chat()` method, after the text response check (around lines 118-126), modify the text response handling. Change:

```typescript
if (response.type === "text") {
  this.conversationHistory.push({
    role: "assistant",
    content: response.text,
  });
  if (this.vox && this.vox.mode !== "off") {
    this.vox.speak(response.text).catch(() => {});
  }
  return response.text;
}
```

to:

```typescript
if (response.type === "text") {
  let text = response.text;
  if (response.truncated) {
    text += "\n\n⚠ [Response truncated — hit token limit]";
  }
  this.conversationHistory.push({
    role: "assistant",
    content: text,
  });
  if (this.vox && this.vox.mode !== "off") {
    this.vox.speak(text).catch(() => {});
  }
  return text;
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/friday.test.ts`
Expected: ALL PASS

**Step 6: Run full test suite to check for regressions**

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(cortex): bump maxTokens to 12288 and warn on truncated responses"
```

---

### Task 5: Lint and final verification

**Files:** None new — just verification.

**Step 1: Run linter**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

**Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes"
```

(Skip if nothing changed.)
