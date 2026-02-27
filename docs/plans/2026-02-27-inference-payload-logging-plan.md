# Inference Payload & Response Logging — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture exact provider wire-format payloads and responses to log files when `--debug` is active, replacing the existing `debug-prompt.log`.

**Architecture:** Provider-level interceptor pattern. `ChatOptions` gains an optional `debug` field. Each provider's `chat()` method appends the wire-format params and raw response to log files. Cortex clears the files at the start of each `chat()` call and passes round numbers through `ChatOptions`.

**Tech Stack:** TypeScript, `node:fs/promises` appendFile, Bun.write, bun:test

---

### Task 1: Extend ChatOptions with debug field

**Files:**
- Modify: `src/providers/types.ts:4-8`

**Step 1: Write the failing test**

Create new test file `tests/unit/inference-logging.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const PAYLOAD_PATH = "/tmp/test-inference-payload.log";
const RESPONSE_PATH = "/tmp/test-inference-response.log";

describe("ChatOptions debug field", () => {
  test("debug field is optional on ChatOptions", async () => {
    const { type } = await import("../../src/providers/types.ts");
    // If this compiles and imports, the type accepts debug as optional
    const opts = { model: "test", maxTokens: 100 } satisfies import("../../src/providers/types.ts").ChatOptions;
    expect(opts).toBeDefined();
  });
});
```

**Step 2: Run test to verify it compiles**

Run: `bun test tests/unit/inference-logging.test.ts`
Expected: PASS (since ChatOptions already exists, and `debug` is optional — it'll pass even before the change)

**Step 3: Add the debug field to ChatOptions**

In `src/providers/types.ts`, change:

```ts
export interface ChatOptions {
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
}
```

to:

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

**Step 4: Run all existing tests to confirm no breakage**

Run: `bun test`
Expected: All 952+ tests pass. The field is optional so no existing code breaks.

**Step 5: Commit**

```bash
git add src/providers/types.ts tests/unit/inference-logging.test.ts
git commit -m "feat(providers): add debug field to ChatOptions for inference logging"
```

---

### Task 2: Add inference logging to AnthropicProvider

**Files:**
- Modify: `src/providers/anthropic.ts:117-137`
- Test: `tests/unit/inference-logging.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/inference-logging.test.ts`:

```ts
import { appendFile } from "node:fs/promises";

describe("AnthropicProvider inference logging", () => {
  afterEach(async () => {
    await unlink(PAYLOAD_PATH).catch(() => {});
    await unlink(RESPONSE_PATH).catch(() => {});
  });

  test("appends wire-format payload when debug is set", async () => {
    // We can't instantiate AnthropicProvider without an API key,
    // so we test the exported helper + manual appendFile pattern.
    // The actual integration is tested via Cortex with injectedProvider.
    // Instead, test that the appendInferenceLog helper works.
    const { appendInferenceLog } = await import("../../src/providers/anthropic.ts");

    await appendInferenceLog(PAYLOAD_PATH, 1, { model: "claude-test", messages: [] });
    const content = await Bun.file(PAYLOAD_PATH).text();

    expect(content).toContain("Round 1");
    expect(content).toContain('"model": "claude-test"');
  });

  test("appends multiple rounds with separators", async () => {
    const { appendInferenceLog } = await import("../../src/providers/anthropic.ts");

    await appendInferenceLog(PAYLOAD_PATH, 1, { first: true });
    await appendInferenceLog(PAYLOAD_PATH, 2, { second: true });
    const content = await Bun.file(PAYLOAD_PATH).text();

    expect(content).toContain("Round 1");
    expect(content).toContain("Round 2");
    expect(content).toContain('"first": true');
    expect(content).toContain('"second": true');
  });

  test("does not throw on write failure", async () => {
    const { appendInferenceLog } = await import("../../src/providers/anthropic.ts");

    // Path that will fail (directory doesn't exist)
    await expect(
      appendInferenceLog("/nonexistent/dir/file.log", 1, { test: true })
    ).resolves.toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/inference-logging.test.ts`
Expected: FAIL — `appendInferenceLog` is not exported from `anthropic.ts`

**Step 3: Implement appendInferenceLog and wire it into AnthropicProvider.chat()**

In `src/providers/anthropic.ts`, add at the top with other imports:

```ts
import { appendFile } from "node:fs/promises";
```

Add the exported helper function before the class:

```ts
/** Append a JSON payload to an inference log file with a round separator */
export async function appendInferenceLog(
  path: string,
  round: number,
  data: unknown,
): Promise<void> {
  try {
    const separator = `\n═══ [${new Date().toISOString()}] Round ${round} ═══════════════════════\n`;
    const json = JSON.stringify(data, null, 2);
    await appendFile(path, separator + json + "\n");
  } catch {
    // Debug logging must never crash the primary function
  }
}
```

In `AnthropicProvider.chat()`, after building `params` (line ~127) and before the API call:

```ts
    if (options.debug) {
      await appendInferenceLog(options.debug.payloadPath, options.debug.round, params);
    }
```

After `const response = await this.client.messages.create(params);` and before `return parseAnthropicResponse(...)`:

```ts
    if (options.debug) {
      await appendInferenceLog(options.debug.responsePath, options.debug.round, response);
    }
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/inference-logging.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/providers/anthropic.ts tests/unit/inference-logging.test.ts
git commit -m "feat(anthropic): add inference payload and response logging"
```

---

### Task 3: Add inference logging to GrokProvider

**Files:**
- Modify: `src/providers/grok.ts:157-179`
- Test: `tests/unit/inference-logging.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/inference-logging.test.ts`:

```ts
describe("GrokProvider inference logging", () => {
  afterEach(async () => {
    await unlink(PAYLOAD_PATH).catch(() => {});
    await unlink(RESPONSE_PATH).catch(() => {});
  });

  test("uses same appendInferenceLog format as Anthropic", async () => {
    const { appendInferenceLog } = await import("../../src/providers/grok.ts");

    await appendInferenceLog(PAYLOAD_PATH, 1, {
      model: "grok-test",
      messages: [{ role: "system", content: "test" }],
    });
    const content = await Bun.file(PAYLOAD_PATH).text();

    expect(content).toContain("Round 1");
    expect(content).toContain('"model": "grok-test"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/inference-logging.test.ts`
Expected: FAIL — `appendInferenceLog` not exported from `grok.ts`

**Step 3: Implement in GrokProvider**

In `src/providers/grok.ts`, add import:

```ts
import { appendFile } from "node:fs/promises";
```

Add the same helper (or better — extract to shared location, but since it's 10 lines and both providers already import from different places, duplicating is fine):

```ts
/** Append a JSON payload to an inference log file with a round separator */
export async function appendInferenceLog(
  path: string,
  round: number,
  data: unknown,
): Promise<void> {
  try {
    const separator = `\n═══ [${new Date().toISOString()}] Round ${round} ═══════════════════════\n`;
    const json = JSON.stringify(data, null, 2);
    await appendFile(path, separator + json + "\n");
  } catch {
    // Debug logging must never crash the primary function
  }
}
```

In `GrokProvider.chat()`, after building `params` (line ~168) and before the API call:

```ts
    if (options.debug) {
      await appendInferenceLog(options.debug.payloadPath, options.debug.round, params);
    }
```

After `const response = await this.client.chat.completions.create(params);` and before parsing:

```ts
    if (options.debug) {
      await appendInferenceLog(options.debug.responsePath, options.debug.round, response);
    }
```

**Step 4: Run tests**

Run: `bun test tests/unit/inference-logging.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/providers/grok.ts tests/unit/inference-logging.test.ts
git commit -m "feat(grok): add inference payload and response logging"
```

---

### Task 4: Extract appendInferenceLog to shared location (DRY)

**Files:**
- Create: `src/providers/debug-log.ts`
- Modify: `src/providers/anthropic.ts` (remove local, import shared)
- Modify: `src/providers/grok.ts` (remove local, import shared)
- Test: `tests/unit/inference-logging.test.ts`

**Step 1: Create shared module**

Create `src/providers/debug-log.ts`:

```ts
import { appendFile } from "node:fs/promises";

/** Append a JSON payload to an inference log file with a round separator.
 *  Swallows errors — debug logging must never crash the primary function. */
export async function appendInferenceLog(
  path: string,
  round: number,
  data: unknown,
): Promise<void> {
  try {
    const separator = `\n═══ [${new Date().toISOString()}] Round ${round} ═══════════════════════\n`;
    const json = JSON.stringify(data, null, 2);
    await appendFile(path, separator + json + "\n");
  } catch {
    // Debug logging must never crash the primary function
  }
}
```

**Step 2: Update both providers to import from shared**

In `src/providers/anthropic.ts`:
- Remove the local `appendInferenceLog` function
- Remove the `import { appendFile } from "node:fs/promises"` line
- Add: `import { appendInferenceLog } from "./debug-log.ts";`

In `src/providers/grok.ts`:
- Same removals and import addition

**Step 3: Update tests to import from shared**

In `tests/unit/inference-logging.test.ts`, update all `import("../../src/providers/anthropic.ts")` and `import("../../src/providers/grok.ts")` references for `appendInferenceLog` to `import("../../src/providers/debug-log.ts")`.

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/providers/debug-log.ts src/providers/anthropic.ts src/providers/grok.ts tests/unit/inference-logging.test.ts
git commit -m "refactor(providers): extract appendInferenceLog to shared debug-log module"
```

---

### Task 5: Wire Cortex to clear and pass debug info

**Files:**
- Modify: `src/core/cortex.ts:50-51,69-72,103-141`
- Test: `tests/unit/friday.test.ts`

**Step 1: Write the failing tests**

Replace the existing debug prompt logging tests in `tests/unit/friday.test.ts`. Find the `describe("Cortex — debug prompt logging"` block (lines 298-393) and replace it entirely:

```ts
const PAYLOAD_LOG = "/tmp/test-last-inference-payload.log";
const RESPONSE_LOG = "/tmp/test-last-inference-response.log";

describe("Cortex — debug inference logging", () => {
  afterEach(async () => {
    await unlink(PAYLOAD_LOG).catch(() => {});
    await unlink(RESPONSE_LOG).catch(() => {});
  });

  test("clears payload and response logs at start of chat()", async () => {
    // Pre-seed both files
    await Bun.write(PAYLOAD_LOG, "STALE PAYLOAD");
    await Bun.write(RESPONSE_LOG, "STALE RESPONSE");

    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    const payload = await Bun.file(PAYLOAD_LOG).text();
    const response = await Bun.file(RESPONSE_LOG).text();
    expect(payload).not.toContain("STALE PAYLOAD");
    expect(response).not.toContain("STALE RESPONSE");
  });

  test("does NOT write logs when debug is false", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: false,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("does NOT write logs when debug is true but no projectRoot", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
    });
    await cortex.chat("Hello");

    expect(existsSync(PAYLOAD_LOG)).toBe(false);
    expect(existsSync(RESPONSE_LOG)).toBe(false);
  });

  test("passes debug options to provider chat() call", async () => {
    let capturedOptions: unknown;
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (_sys, _msgs, opts) => {
        capturedOptions = opts;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      debug: true,
      projectRoot: "/tmp/test",
    });
    await cortex.chat("Hello");

    expect(capturedOptions).toBeDefined();
    const opts = capturedOptions as { debug?: { payloadPath: string; responsePath: string; round: number } };
    expect(opts.debug).toBeDefined();
    expect(opts.debug!.payloadPath).toBe("/tmp/test/last-inference-payload.log");
    expect(opts.debug!.responsePath).toBe("/tmp/test/last-inference-response.log");
    expect(opts.debug!.round).toBe(1);
  });

  test("retains debug:system-prompt audit entry", async () => {
    const { AuditLogger } = await import("../../src/audit/logger.ts");
    const audit = new AuditLogger();

    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
      projectRoot: "/tmp/test",
      audit,
    });
    await cortex.chat("Hello");

    const entries = audit.entries({ action: "debug:system-prompt" });
    expect(entries).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — Cortex still writes `debug-prompt.log`, not the new files, and doesn't pass debug to provider.

**Step 3: Modify Cortex**

In `src/core/cortex.ts`:

1. Remove `private debugLogPath?: string;` (line 51)

2. Add two new private fields:

```ts
  private debugPayloadPath?: string;
  private debugResponsePath?: string;
```

3. In the constructor, replace the `debugLogPath` setup (lines 70-72):

```ts
    if (this.debug && config.projectRoot) {
      this.debugPayloadPath = `${config.projectRoot}/last-inference-payload.log`;
      this.debugResponsePath = `${config.projectRoot}/last-inference-response.log`;
    }
```

4. In `chat()`, replace the existing debug block (lines 110-129) with:

```ts
      if (this.debug) {
        this.audit?.log({
          action: "debug:system-prompt",
          source: "cortex",
          detail: systemPrompt,
          success: true,
        });
        // Clear inference log files at start of each chat() call
        if (this.debugPayloadPath && this.debugResponsePath) {
          try {
            await Bun.write(this.debugPayloadPath, "");
            await Bun.write(this.debugResponsePath, "");
          } catch {
            this.audit?.log({
              action: "debug:inference-write-failed",
              source: "cortex",
              detail: "Failed to clear inference log files",
              success: false,
            });
          }
        }
      }
```

5. In the `options` construction (lines 131-135), add the debug field:

```ts
      const options = {
        model: this.model,
        maxTokens: this.maxTokens,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      };
```

6. In the tool loop (line 137), pass debug info. Change the `this.provider.chat()` call to include round:

```ts
      for (let i = 0; i < this.maxToolIterations; i++) {
        const roundOptions = {
          ...options,
          ...(this.debug && this.debugPayloadPath && this.debugResponsePath ? {
            debug: {
              payloadPath: this.debugPayloadPath,
              responsePath: this.debugResponsePath,
              round: i + 1,
            },
          } : {}),
        };
        const response = await this.provider.chat(
          systemPrompt,
          this.conversationHistory,
          roundOptions,
        );
```

**Step 4: Run tests**

Run: `bun test tests/unit/friday.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(cortex): wire inference logging, replace debug-prompt.log"
```

---

### Task 6: Add .gitignore entries and update CLAUDE.md

**Files:**
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

**Step 1: Add gitignore entries**

Add to `.gitignore`:

```
last-inference-payload.log
last-inference-response.log
```

(Also verify `debug-prompt.log` is already listed — if so, it can be removed since we no longer produce it.)

**Step 2: Update CLAUDE.md**

In the "Debug Prompt Logging" section of CLAUDE.md, update to reflect the new behavior:

- `--debug` now writes `last-inference-payload.log` (wire-format request) and `last-inference-response.log` (raw API response)
- Files cleared at start of each `chat()`, rounds appended with timestamp separators
- Replaces old `debug-prompt.log` (removed)
- Debug audit entries retained (`debug:system-prompt`, `debug:inference-write-failed`)

**Step 3: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add .gitignore CLAUDE.md
git commit -m "docs: update CLAUDE.md and .gitignore for inference logging"
```

---

### Task 7: Final verification

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

**Step 2: Run lint**

Run: `bun run lint`
Expected: Clean

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Manual smoke test (optional)**

Run: `bun run start --debug chat` (requires API key)
Send a message, then check:
- `last-inference-payload.log` contains the wire-format request JSON with round separators
- `last-inference-response.log` contains the raw API response JSON
- `debug-prompt.log` is NOT created
