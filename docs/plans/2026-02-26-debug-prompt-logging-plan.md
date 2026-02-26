# Debug Prompt Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--debug` global CLI flag that logs the fully assembled system prompt (after SMARTS/Sensorium enrichment) to both the audit subsystem and a `debug-prompt.log` file on every `chat()` call.

**Architecture:** Cortex-level interceptor. After `buildSystemPrompt()` returns and before `provider.chat()` fires, when debug mode is on, write the system prompt to an audit entry and overwrite a file in the project root. The flag flows through the existing config chain: CLI global option → RuntimeConfig → CortexConfig → Cortex field.

**Tech Stack:** Commander.js (CLI), Bun.write (file I/O), existing AuditLogger

---

### Task 1: Add debug fields to CortexConfig and Cortex constructor

**Files:**
- Modify: `src/core/cortex.ts:19-65`

**Step 1: Write the failing test**

Add to `tests/unit/friday.test.ts` after the existing "defaults to grok provider" tests:

```typescript
test("debug defaults to false", () => {
  const cortex = new Cortex({ injectedProvider: grokStub });
  // debug is private, so verify indirectly: chat() should NOT write debug-prompt.log
  // We'll test this properly in Task 3. For now just verify construction works.
  expect(cortex.providerName).toBe("grok");
});
```

**Step 2: Run test to verify it passes (construction already works)**

Run: `bun test tests/unit/friday.test.ts`
Expected: PASS (this test just confirms the constructor still works)

**Step 3: Add debug and projectRoot to CortexConfig and Cortex constructor**

In `src/core/cortex.ts`, add to `CortexConfig`:
```typescript
export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  clearance?: ClearanceManager;
  maxToolIterations?: number;
  smartsStore?: SmartsStore;
  sensorium?: Sensorium;
  audit?: AuditLogger;
  signals?: SignalBus;
  toolMemory?: ScopedMemory;
  genesisPrompt?: string;
  vox?: Vox;
  debug?: boolean;
  projectRoot?: string;
}
```

Add private fields and constructor lines:
```typescript
private debug: boolean;
private debugLogPath?: string;
```

In constructor:
```typescript
this.debug = config.debug ?? false;
if (this.debug && config.projectRoot) {
  this.debugLogPath = `${config.projectRoot}/debug-prompt.log`;
}
```

**Step 4: Run test to verify it still passes**

Run: `bun test tests/unit/friday.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(debug): add debug and projectRoot to CortexConfig"
```

---

### Task 2: Add debug logging to Cortex.chat()

**Files:**
- Modify: `src/core/cortex.ts:95-108`
- Test: `tests/unit/friday.test.ts`

**Step 1: Write the failing test**

Add a new `describe("Cortex — debug prompt logging")` block at the end of `tests/unit/friday.test.ts`:

```typescript
import { existsSync } from "node:fs";

const DEBUG_LOG_PATH = "/tmp/friday-test-debug-prompt.log";

describe("Cortex — debug prompt logging", () => {
  afterEach(async () => {
    await unlink(DEBUG_LOG_PATH).catch(() => {});
  });

  test("writes system prompt to debug-prompt.log when debug enabled", async () => {
    let capturedPrompt = "";
    const capturingProvider: LLMProvider = {
      name: "capturing",
      defaultModel: "capture",
      defaultFastModel: "capture-fast",
      chat: async (systemPrompt) => {
        capturedPrompt = systemPrompt;
        return textResponse("ok");
      },
    };

    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      debug: true,
      projectRoot: "/tmp",
    });
    await cortex.chat("Hello");

    const fileContent = await Bun.file(DEBUG_LOG_PATH).text();
    expect(fileContent).toBe(capturedPrompt);
  });

  test("logs audit entry with action debug:system-prompt when debug enabled", async () => {
    const { AuditLogger } = await import("../../src/audit/logger.ts");
    const audit = new AuditLogger();

    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
      projectRoot: "/tmp",
      audit,
    });
    await cortex.chat("Hello");

    const entries = audit.entries({ action: "debug:system-prompt" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe("cortex");
    expect(entries[0]!.detail.length).toBeGreaterThan(0);
  });

  test("does NOT write debug-prompt.log when debug is false", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: false,
      projectRoot: "/tmp",
    });
    await cortex.chat("Hello");

    expect(existsSync(DEBUG_LOG_PATH)).toBe(false);
  });

  test("does NOT write debug-prompt.log when debug is true but no projectRoot", async () => {
    const cortex = new Cortex({
      injectedProvider: stubProvider,
      debug: true,
    });
    await cortex.chat("Hello");

    expect(existsSync(DEBUG_LOG_PATH)).toBe(false);
  });

  test("overwrites debug-prompt.log on each chat() call", async () => {
    let callCount = 0;
    const countingProvider: LLMProvider = {
      name: "counting",
      defaultModel: "count",
      defaultFastModel: "count-fast",
      chat: async () => {
        callCount++;
        return textResponse(`response ${callCount}`);
      },
    };

    const cortex = new Cortex({
      injectedProvider: countingProvider,
      debug: true,
      projectRoot: "/tmp",
    });

    await cortex.chat("First message");
    const content1 = await Bun.file(DEBUG_LOG_PATH).text();

    await cortex.chat("Second message");
    const content2 = await Bun.file(DEBUG_LOG_PATH).text();

    // File should contain only the latest prompt (overwritten, not appended)
    expect(content2).not.toBe(content1);
    // Second call's prompt includes "Second message" in SMARTS query context
    // but the prompt itself is the system prompt, not the user message.
    // Just verify it's a valid prompt containing genesis template content.
    expect(content2.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — "writes system prompt to debug-prompt.log" fails because chat() doesn't write the file yet

**Step 3: Implement debug logging in chat()**

In `src/core/cortex.ts`, in the `chat()` method, immediately after line 101 (`const systemPrompt = await this.buildSystemPrompt(userMessage);`), add:

```typescript
if (this.debug) {
  this.audit?.log({
    action: "debug:system-prompt",
    source: "cortex",
    detail: systemPrompt,
    success: true,
  });
  if (this.debugLogPath) {
    await Bun.write(this.debugLogPath, systemPrompt);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/friday.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(debug): log system prompt to audit + file in debug mode"
```

---

### Task 3: Add --debug global CLI flag

**Files:**
- Modify: `src/cli/index.ts:13-27`
- Modify: `src/cli/commands/chat.ts:25-33`

**Step 1: Add --debug to the Commander program**

In `src/cli/index.ts`, add the global option after `.version(version)`:

```typescript
program
  .name("friday")
  .description(description)
  .version(version)
  .option("--debug", "Enable debug prompt logging")
  .hook("preAction", () => {
```

**Step 2: Pass debug from chat command to launchTui**

In `src/cli/commands/chat.ts`, the `.action()` callback receives the command's own options. To access the global `--debug` flag, use the command's `.optsWithGlobals()`. Modify the action:

```typescript
.action(async function(this: Command, options) {
  const globalOpts = this.optsWithGlobals();
  const { launchTui } = await import("../tui/app.tsx");
  await launchTui({
    provider: options.provider,
    model: options.model,
    fastModel: options.fastModel,
    fresh: options.fresh,
    debug: globalOpts.debug,
  });
});
```

Note: use `function` (not arrow) so `this` binds to the Command instance. Import `type { Command }` from `"commander"` is already present.

**Step 3: Run existing tests to verify nothing breaks**

Run: `bun test tests/unit/friday.test.ts`
Expected: PASS (no behavioral change yet — just plumbing)

**Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/commands/chat.ts
git commit -m "feat(debug): add --debug global CLI flag"
```

---

### Task 4: Thread debug through launchTui → RuntimeConfig → CortexConfig

**Files:**
- Modify: `src/cli/tui/app.tsx:48-54,86-99,490-495`
- Modify: `src/core/runtime.ts:41-52,258-271`

**Step 1: Add debug to launchTui options type**

In `src/cli/tui/app.tsx`, update the `FridayAppProps` interface and `launchTui` options:

```typescript
interface FridayAppProps {
  options: {
    provider: string;
    model?: string;
    fastModel?: string;
    fresh?: boolean;
    debug?: boolean;
  };
  renderer: Awaited<ReturnType<typeof createCliRenderer>>;
}
```

And the exported `launchTui` function signature:

```typescript
export async function launchTui(options: {
  provider: string;
  model?: string;
  fastModel?: string;
  fresh?: boolean;
  debug?: boolean;
}): Promise<void> {
```

**Step 2: Pass debug through bootConfig**

In `FridayApp`, the `bootConfig` callback (around line 86-100) builds the RuntimeConfig. Add `debug`:

```typescript
const bootConfig = useCallback(
  () => ({
    provider: options.provider as ProviderName,
    model: options.model,
    fastModel: options.fastModel,
    smartsDir: resolve(projectRoot, "smarts"),
    dataDir: resolve(projectRoot, "data"),
    modulesDir: resolve(projectRoot, "src/modules"),
    forgeDir: resolve(projectRoot, "forge"),
    fresh: options.fresh,
    genesisPath: resolveGenesisPath(),
    channels: [],
    debug: options.debug,
  }),
  [options, projectRoot],
);
```

**Step 3: Add debug to RuntimeConfig**

In `src/core/runtime.ts`, add to `RuntimeConfig`:

```typescript
export interface RuntimeConfig extends Partial<FridayConfig> {
  modulesDir?: string;
  injectedProvider?: LLMProvider;
  smartsDir?: string;
  dataDir?: string;
  forgeDir?: string;
  fresh?: boolean;
  enableSensorium?: boolean;
  enableVox?: boolean;
  genesisPath?: string;
  channels?: NotificationChannel[];
  debug?: boolean;
}
```

**Step 4: Pass debug and projectRoot to CortexConfig in boot()**

In `FridayRuntime.boot()`, where the Cortex is constructed (around line 258-271), add `debug` and `projectRoot`. The `projectRoot` needs to be resolved — the simplest approach is to derive it from `config.modulesDir` (which is always `<root>/src/modules`) or use `process.cwd()`. Since `modulesDir` may not be provided, use `process.cwd()`:

```typescript
this._cortex = new Cortex({
  provider: providerName,
  model: reasoningModel,
  maxTokens: config.maxTokens,
  injectedProvider: config.injectedProvider,
  smartsStore: this._smarts,
  sensorium: this._sensorium,
  clearance: this._clearance,
  audit: this._audit,
  signals: this._signals,
  toolMemory: this._memory?.scoped("tools"),
  genesisPrompt,
  vox: this._vox,
  debug: config.debug,
  projectRoot: process.cwd(),
});
```

Also log a boot-time audit entry when debug is enabled (add after the existing `runtime:boot` audit log at end of `boot()`):

```typescript
if (config.debug) {
  this._audit.log({
    action: "debug:enabled",
    source: "runtime",
    detail: "Debug prompt logging active — system prompts will be written to debug-prompt.log",
    success: true,
  });
}
```

**Step 5: Run all tests to verify nothing breaks**

Run: `bun test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/cli/tui/app.tsx src/core/runtime.ts
git commit -m "feat(debug): thread debug flag through TUI and Runtime to Cortex"
```

---

### Task 5: Thread debug through serve command

**Files:**
- Modify: `src/cli/commands/serve.ts:21-39`

**Step 1: Pass debug from serve command to RuntimeConfig**

In `src/cli/commands/serve.ts`, access the global `--debug` flag via `this.optsWithGlobals()` and pass it to `runtimeConfig`:

```typescript
.action(async function(this: Command, options) {
  const globalOpts = this.optsWithGlobals();
  const port = Number.parseInt(options.port, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.error(chalk.red("Invalid port number"));
    process.exit(1);
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const server = createFridayServer({
    port,
    staticDir: resolve(projectRoot, "web/dist"),
    runtimeConfig: {
      provider: options.provider as ProviderName,
      model: options.model,
      smartsDir: resolve(projectRoot, "smarts"),
      dataDir: resolve(projectRoot, "data"),
      modulesDir: resolve(projectRoot, "src/modules"),
      debug: globalOpts.debug,
    },
  });
```

Import `type { Command }` at the top (it's already imported as `type`).

Note: use `function` (not arrow) so `this` binds to the Command instance.

**Step 2: Run tests**

Run: `bun test`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/cli/commands/serve.ts
git commit -m "feat(debug): thread debug flag through serve command"
```

---

### Task 6: Add runtime-level debug tests

**Files:**
- Test: `tests/unit/runtime.test.ts`

**Step 1: Write runtime debug test**

Add a new describe block at the end of `tests/unit/runtime.test.ts`:

```typescript
describe("FridayRuntime — debug mode", () => {
  test("passes debug flag to Cortex when enabled", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      enableSensorium: false,
      enableVox: false,
      debug: true,
    });

    // Verify debug:enabled audit entry was logged
    const entries = runtime.audit.entries({ action: "debug:enabled" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.detail).toContain("debug-prompt.log");

    await runtime.shutdown();
  });

  test("does not log debug:enabled when debug is false", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      enableSensorium: false,
      enableVox: false,
    });

    const entries = runtime.audit.entries({ action: "debug:enabled" });
    expect(entries).toHaveLength(0);

    await runtime.shutdown();
  });
});
```

Note: check what imports are already at the top of `runtime.test.ts`. `stubProvider` should already be imported from `tests/helpers/stubs.ts`. If not, add the import.

**Step 2: Run the new tests**

Run: `bun test tests/unit/runtime.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/runtime.test.ts
git commit -m "test(debug): add runtime debug mode tests"
```

---

### Task 7: Run full test suite and lint

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (939+ tests)

**Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Fix any issues found**

If lint or typecheck fails, fix the issues and re-run.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint/typecheck issues from debug logging"
```

---

### Summary of files changed

| File | Type | Description |
|------|------|-------------|
| `src/core/cortex.ts` | Modify | Add `debug`, `projectRoot` to config; log prompt in `chat()` |
| `src/cli/index.ts` | Modify | Add `--debug` global CLI option |
| `src/cli/commands/chat.ts` | Modify | Read global debug flag, pass to `launchTui()` |
| `src/cli/commands/serve.ts` | Modify | Read global debug flag, pass to `runtimeConfig` |
| `src/cli/tui/app.tsx` | Modify | Accept `debug` in options, pass through `bootConfig` |
| `src/core/runtime.ts` | Modify | Add `debug` to `RuntimeConfig`, pass to Cortex, log boot audit |
| `tests/unit/friday.test.ts` | Modify | Add debug prompt logging tests (5 tests) |
| `tests/unit/runtime.test.ts` | Modify | Add runtime debug mode tests (2 tests) |
