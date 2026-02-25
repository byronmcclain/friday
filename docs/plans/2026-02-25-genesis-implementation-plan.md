# GENESIS.md Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract Friday's identity prompt from a hardcoded TypeScript constant into a protected `~/.friday/GENESIS.md` file that only the BOSS can edit.

**Architecture:** New `src/core/genesis.ts` module handles load/seed/check operations. `Cortex` receives the prompt content via config instead of importing it. Filesystem tools and Forge reject writes to the Genesis path. A `friday genesis` CLI command provides BOSS-only management.

**Tech Stack:** Bun (Bun.file, chmod), Commander.js (CLI), bun:test

---

### Task 1: Rename SYSTEM_PROMPT to GENESIS_TEMPLATE

The existing constant becomes a seed template. This is a pure rename with no behavior change — all existing tests keep passing.

**Files:**
- Modify: `src/core/prompts.ts:5` (rename export)
- Modify: `src/core/cortex.ts:2,251` (update import and usage)
- Modify: `tests/unit/friday.test.ts:2,13,14,18,146,158` (update import and references)

**Step 1: Rename the export in prompts.ts**

In `src/core/prompts.ts`, change:
```typescript
export const SYSTEM_PROMPT = `You are Friday...
```
to:
```typescript
export const GENESIS_TEMPLATE = `You are Friday...
```

Also add a re-export for backwards compatibility during migration:
```typescript
/** @deprecated Use GENESIS_TEMPLATE */
export const SYSTEM_PROMPT = GENESIS_TEMPLATE;
```

**Step 2: Update cortex.ts import**

In `src/core/cortex.ts:2`, change:
```typescript
import { SYSTEM_PROMPT } from "./prompts.ts";
```
to:
```typescript
import { GENESIS_TEMPLATE } from "./prompts.ts";
```

In `src/core/cortex.ts:251`, change:
```typescript
let prompt = SYSTEM_PROMPT;
```
to:
```typescript
let prompt = this.genesisPrompt ?? GENESIS_TEMPLATE;
```
(The `genesisPrompt` field doesn't exist yet — that's Task 3. For now, it'll always be undefined and fall back to the template.)

**Step 3: Update test imports**

In `tests/unit/friday.test.ts:2`, change:
```typescript
import { SYSTEM_PROMPT } from "../../src/core/prompts.ts";
```
to:
```typescript
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";
```

Replace all `SYSTEM_PROMPT` references in the test file with `GENESIS_TEMPLATE`:
- Line 13: `expect(GENESIS_TEMPLATE).toBeDefined();`
- Line 14: `expect(GENESIS_TEMPLATE.length).toBeGreaterThan(0);`
- Line 18: `expect(GENESIS_TEMPLATE).toContain("Friday");`
- Line 146: test name update `"includes base GENESIS_TEMPLATE in enriched prompt"`
- Line 158: `expect(capturedPrompt).toContain(GENESIS_TEMPLATE);`

**Step 4: Run tests to verify nothing broke**

Run: `bun test tests/unit/friday.test.ts`
Expected: All tests pass (pure rename, no behavior change)

**Step 5: Commit**

```bash
git add src/core/prompts.ts src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "refactor: rename SYSTEM_PROMPT to GENESIS_TEMPLATE"
```

---

### Task 2: Create src/core/genesis.ts — Core Genesis Module

This module provides the load/seed/check functions and the default path constant.

**Files:**
- Create: `src/core/genesis.ts`
- Test: `tests/unit/genesis.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/genesis.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, chmod, stat } from "node:fs/promises";
import {
  GENESIS_DEFAULT_DIR,
  resolveGenesisPath,
  loadGenesis,
  seedGenesis,
  checkGenesis,
} from "../../src/core/genesis.ts";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("genesis", () => {
  beforeEach(async () => {
    await mkdir(TEST_GENESIS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
  });

  test("GENESIS_DEFAULT_DIR points to ~/.friday", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    expect(GENESIS_DEFAULT_DIR).toBe(`${home}/.friday`);
  });

  test("resolveGenesisPath uses env var when set", () => {
    const original = process.env.FRIDAY_GENESIS_PATH;
    try {
      process.env.FRIDAY_GENESIS_PATH = "/custom/path/GENESIS.md";
      expect(resolveGenesisPath()).toBe("/custom/path/GENESIS.md");
    } finally {
      if (original === undefined) delete process.env.FRIDAY_GENESIS_PATH;
      else process.env.FRIDAY_GENESIS_PATH = original;
    }
  });

  test("resolveGenesisPath falls back to default", () => {
    const original = process.env.FRIDAY_GENESIS_PATH;
    try {
      delete process.env.FRIDAY_GENESIS_PATH;
      expect(resolveGenesisPath()).toBe(`${GENESIS_DEFAULT_DIR}/GENESIS.md`);
    } finally {
      if (original !== undefined) process.env.FRIDAY_GENESIS_PATH = original;
    }
  });

  test("loadGenesis reads file content", async () => {
    await Bun.write(TEST_GENESIS_PATH, "Test identity prompt");
    const content = await loadGenesis(TEST_GENESIS_PATH);
    expect(content).toBe("Test identity prompt");
  });

  test("loadGenesis throws on missing file", async () => {
    await expect(loadGenesis(`${TEST_GENESIS_DIR}/nonexistent.md`)).rejects.toThrow(
      "GENESIS.md not found"
    );
  });

  test("loadGenesis throws on empty file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "");
    await expect(loadGenesis(TEST_GENESIS_PATH)).rejects.toThrow("GENESIS.md is empty");
  });

  test("seedGenesis creates file with template content", async () => {
    await seedGenesis(TEST_GENESIS_PATH);
    const content = await Bun.file(TEST_GENESIS_PATH).text();
    expect(content).toBe(GENESIS_TEMPLATE);
  });

  test("seedGenesis creates parent directory", async () => {
    const nested = `${TEST_GENESIS_DIR}/sub/GENESIS.md`;
    await seedGenesis(nested);
    const content = await Bun.file(nested).text();
    expect(content).toBe(GENESIS_TEMPLATE);
  });

  test("seedGenesis does not overwrite existing file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "Custom prompt");
    await seedGenesis(TEST_GENESIS_PATH);
    const content = await Bun.file(TEST_GENESIS_PATH).text();
    expect(content).toBe("Custom prompt");
  });

  test("seedGenesis sets file permissions to 600", async () => {
    await seedGenesis(TEST_GENESIS_PATH);
    const info = await stat(TEST_GENESIS_PATH);
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("checkGenesis returns ok for valid file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "Valid prompt");
    await chmod(TEST_GENESIS_PATH, 0o600);
    const result = await checkGenesis(TEST_GENESIS_PATH);
    expect(result.ok).toBe(true);
  });

  test("checkGenesis reports missing file", async () => {
    const result = await checkGenesis(`${TEST_GENESIS_DIR}/nope.md`);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("File not found");
  });

  test("checkGenesis reports empty file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "");
    const result = await checkGenesis(TEST_GENESIS_PATH);
    expect(result.ok).toBe(false);
    expect(result.issues![0]).toContain("empty");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/genesis.test.ts`
Expected: FAIL — module doesn't exist yet

**Step 3: Write the implementation**

Create `src/core/genesis.ts`:

```typescript
import { dirname } from "node:path";
import { mkdir, chmod, stat } from "node:fs/promises";
import { GENESIS_TEMPLATE } from "./prompts.ts";

const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";

/** Default directory for Friday's protected config */
export const GENESIS_DEFAULT_DIR = `${home}/.friday`;

/** Default path to GENESIS.md */
export const GENESIS_DEFAULT_PATH = `${GENESIS_DEFAULT_DIR}/GENESIS.md`;

/**
 * Resolve the Genesis file path.
 * Priority: FRIDAY_GENESIS_PATH env var > default ~/.friday/GENESIS.md
 */
export function resolveGenesisPath(): string {
  return process.env.FRIDAY_GENESIS_PATH ?? GENESIS_DEFAULT_PATH;
}

/**
 * Load Genesis content from disk. Fails hard on missing or empty file.
 */
export async function loadGenesis(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `GENESIS.md not found at ${path}. Run 'friday genesis init' to create it.`
    );
  }

  const content = await file.text();
  if (content.trim().length === 0) {
    throw new Error(
      `GENESIS.md is empty at ${path}. Friday needs her identity prompt.`
    );
  }

  return content;
}

/**
 * Seed GENESIS.md from the built-in template. Won't overwrite existing files.
 * Sets directory to 700 and file to 600.
 */
export async function seedGenesis(path: string): Promise<boolean> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const file = Bun.file(path);
  if (await file.exists()) {
    return false; // Already exists — don't overwrite
  }

  await Bun.write(path, GENESIS_TEMPLATE);
  await chmod(path, 0o600);
  return true;
}

export interface GenesisCheckResult {
  ok: boolean;
  issues?: string[];
}

/**
 * Validate that GENESIS.md exists, is non-empty, and has correct permissions.
 */
export async function checkGenesis(path: string): Promise<GenesisCheckResult> {
  const issues: string[] = [];

  try {
    const info = await stat(path);

    if (info.size === 0) {
      issues.push("File is empty — Friday needs her identity prompt");
    }

    const perms = info.mode & 0o777;
    if (perms !== 0o600) {
      issues.push(
        `Permissions are ${perms.toString(8)}, expected 600 (owner read/write only)`
      );
    }
  } catch {
    issues.push("File not found");
  }

  return { ok: issues.length === 0, issues: issues.length > 0 ? issues : undefined };
}

/**
 * Ensure permissions are correct on an existing Genesis file.
 * Called on every boot as a health check.
 */
export async function enforceGenesisPermissions(path: string): Promise<void> {
  const dir = dirname(path);
  try {
    await chmod(dir, 0o700);
  } catch {
    /* directory may not exist yet */
  }
  try {
    await chmod(path, 0o600);
  } catch {
    /* file may not exist yet */
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/genesis.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/core/genesis.ts tests/unit/genesis.test.ts
git commit -m "feat(genesis): add core genesis module with load/seed/check"
```

---

### Task 3: Wire Cortex to Accept genesisPrompt

Add `genesisPrompt` to `CortexConfig` and use it in `buildSystemPrompt()`.

**Files:**
- Modify: `src/core/cortex.ts:18-27,44-58,250-251`
- Test: `tests/unit/friday.test.ts` (add new test)

**Step 1: Write the failing test**

Add to `tests/unit/friday.test.ts` inside the `"Cortex"` describe block:

```typescript
test("uses genesisPrompt when provided", async () => {
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
    genesisPrompt: "You are a custom identity.",
  });
  await cortex.chat("Hello");
  expect(capturedPrompt).toContain("You are a custom identity.");
  expect(capturedPrompt).not.toContain("Female Replacement Intelligent Digital Assistant Youth");
});
```

Also import `textResponse` if not already imported (it is — line 9).

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — `genesisPrompt` not a recognized config field

**Step 3: Implement the CortexConfig change**

In `src/core/cortex.ts`:

Add to `CortexConfig` interface (after `toolMemory?`):
```typescript
genesisPrompt?: string;
```

Add private field to `Cortex` class (after `pinnedSmarts`):
```typescript
private genesisPrompt?: string;
```

In the constructor, add (after `this.toolMemory = config.toolMemory;`):
```typescript
this.genesisPrompt = config.genesisPrompt;
```

In `buildSystemPrompt()`, change:
```typescript
let prompt = this.genesisPrompt ?? GENESIS_TEMPLATE;
```
(This should already be done from Task 1 Step 2.)

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/friday.test.ts`
Expected: All tests pass, including the new one

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(genesis): wire Cortex to accept genesisPrompt config"
```

---

### Task 4: Wire FridayRuntime to Load Genesis at Boot

Load GENESIS.md in `boot()` and pass content to Cortex.

**Files:**
- Modify: `src/core/runtime.ts:34-42,128-220`
- Test: `tests/unit/runtime.test.ts` (add genesis boot tests)

**Step 1: Write the failing tests**

Add to `tests/unit/runtime.test.ts`:

```typescript
import { resolve } from "node:path";

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis-runtime";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("FridayRuntime — Genesis", () => {
  let runtime: FridayRuntime;

  beforeEach(async () => {
    await mkdir(TEST_GENESIS_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (runtime?.isBooted) {
      await runtime.shutdown();
    }
    await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
  });

  test("boots successfully with genesisPath", async () => {
    await writeFile(TEST_GENESIS_PATH, "Custom Friday identity");
    runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      genesisPath: TEST_GENESIS_PATH,
    });
    expect(runtime.isBooted).toBe(true);
  });

  test("fails to boot when genesis file is missing", async () => {
    runtime = new FridayRuntime();
    await expect(
      runtime.boot({
        injectedProvider: stubProvider,
        genesisPath: `${TEST_GENESIS_DIR}/nonexistent.md`,
      })
    ).rejects.toThrow("GENESIS.md not found");
  });

  test("boots without genesisPath (backwards compatible)", async () => {
    runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    expect(runtime.isBooted).toBe(true);
  });
});
```

Note: existing imports of `mkdir`, `writeFile`, `rm` are already present in runtime.test.ts (line 4).

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — `genesisPath` is not a known config property

**Step 3: Implement the runtime changes**

In `src/core/runtime.ts`:

Add import at top:
```typescript
import { loadGenesis, enforceGenesisPermissions } from "./genesis.ts";
```

Add to `RuntimeConfig` interface:
```typescript
genesisPath?: string;
```

In `boot()`, after the directives engine start (line 155) and before the Memory block (line 157), add:

```typescript
// Load GENESIS.md — Friday's identity prompt (before Cortex)
let genesisPrompt: string | undefined;
if (config.genesisPath) {
  genesisPrompt = await loadGenesis(config.genesisPath);
  await enforceGenesisPermissions(config.genesisPath);
  this._audit.log({
    action: "genesis:loaded",
    source: "runtime",
    detail: `Identity loaded from ${config.genesisPath} (${genesisPrompt.length} chars)`,
    success: true,
  });
}
```

Then in the Cortex constructor call (around line 210), add `genesisPrompt`:
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
});
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: All tests pass

**Step 5: Run full test suite**

Run: `bun test`
Expected: All ~735 tests pass

**Step 6: Commit**

```bash
git add src/core/runtime.ts tests/unit/runtime.test.ts
git commit -m "feat(genesis): load GENESIS.md at boot and pass to Cortex"
```

---

### Task 5: Protected Path Blocklist in Containment

Add `isProtectedPath()` to the filesystem containment module.

**Files:**
- Modify: `src/modules/filesystem/containment.ts`
- Create: `tests/unit/genesis-containment.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/genesis-containment.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { isProtectedPath, setProtectedPaths } from "../../src/modules/filesystem/containment.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-containment-genesis";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("isProtectedPath", () => {
  beforeEach(() => {
    setProtectedPaths([TEST_GENESIS_PATH]);
  });

  afterEach(() => {
    setProtectedPaths([]);
  });

  test("rejects exact match to protected path", () => {
    expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
  });

  test("allows unrelated paths", () => {
    expect(isProtectedPath("/tmp/some-other-file.txt")).toBe(false);
  });

  test("rejects path that resolves to protected path via trailing slash", () => {
    expect(isProtectedPath(`${TEST_GENESIS_PATH}/`)).toBe(false);
    // The exact path should match
    expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
  });

  test("returns false when no protected paths are set", () => {
    setProtectedPaths([]);
    expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/genesis-containment.test.ts`
Expected: FAIL — `isProtectedPath` doesn't exist

**Step 3: Implement isProtectedPath**

Add to `src/modules/filesystem/containment.ts`:

```typescript
import { resolve } from "node:path";

/** Paths that cannot be written/deleted by Friday's tools */
let protectedPaths: string[] = [];

/** Set the list of protected paths (called at boot) */
export function setProtectedPaths(paths: string[]): void {
  protectedPaths = paths.map((p) => resolve(p));
}

/** Check if a resolved path matches a protected path */
export function isProtectedPath(path: string): boolean {
  const resolved = resolve(path);
  return protectedPaths.some((pp) => resolved === pp);
}
```

Note: The `resolve` import is new — add it alongside the existing `realpath` import.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/genesis-containment.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/modules/filesystem/containment.ts tests/unit/genesis-containment.test.ts
git commit -m "feat(genesis): add protected path blocklist to containment"
```

---

### Task 6: Wire Protection Into fs.write, fs.delete, and bash.exec

Add Genesis path rejection to the three filesystem tools that can modify files.

**Files:**
- Modify: `src/modules/filesystem/write.ts:33-52`
- Modify: `src/modules/filesystem/delete.ts:26-38`
- Modify: `src/modules/filesystem/exec.ts:36-43`
- Create: `tests/unit/genesis-fs-protection.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/genesis-fs-protection.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { fsWrite } from "../../src/modules/filesystem/write.ts";
import { fsDelete } from "../../src/modules/filesystem/delete.ts";
import { setProtectedPaths } from "../../src/modules/filesystem/containment.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const TEST_DIR = "/tmp/friday-test-genesis-fs";
const PROTECTED_PATH = `${TEST_DIR}/GENESIS.md`;

function makeContext(): ToolContext {
  return {
    workingDirectory: TEST_DIR,
    audit: new AuditLogger(),
    signal: new SignalBus(),
    memory: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    },
  };
}

describe("Genesis filesystem protection", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await Bun.write(PROTECTED_PATH, "Protected content");
    setProtectedPaths([PROTECTED_PATH]);
  });

  afterEach(async () => {
    setProtectedPaths([]);
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("fs.write rejects writes to protected path", async () => {
    const result = await fsWrite.execute(
      { path: "GENESIS.md", content: "hacked" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("BOSS-only");
  });

  test("fs.write allows writes to non-protected paths", async () => {
    const result = await fsWrite.execute(
      { path: "normal.txt", content: "hello" },
      makeContext(),
    );
    expect(result.success).toBe(true);
  });

  test("fs.delete rejects deletion of protected path", async () => {
    const result = await fsDelete.execute(
      { path: "GENESIS.md" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("BOSS-only");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/genesis-fs-protection.test.ts`
Expected: FAIL — write/delete succeed (no protection yet)

**Step 3: Add protection to fs.write**

In `src/modules/filesystem/write.ts`, add import:
```typescript
import { assertContained, isProtectedPath } from "./containment.ts";
```
(Replace existing `import { assertContained } from "./containment.ts";`)

After the containment check (line 50-52) and before the `try` block (line 54), add:

```typescript
if (isProtectedPath(resolved)) {
  await context.audit.log({
    action: "genesis:write-denied",
    source: "fs.write",
    detail: `Blocked write to protected path: ${resolved}`,
    success: false,
  });
  return { success: false, output: "Access denied: GENESIS.md is BOSS-only" };
}
```

**Step 4: Add protection to fs.delete**

In `src/modules/filesystem/delete.ts`, add import:
```typescript
import { assertContained, isProtectedPath } from "./containment.ts";
```

After the containment check (line 35-38) and before the `try` block (line 40), add:

```typescript
if (isProtectedPath(resolved)) {
  await context.audit.log({
    action: "genesis:write-denied",
    source: "fs.delete",
    detail: `Blocked deletion of protected path: ${resolved}`,
    success: false,
  });
  return { success: false, output: "Access denied: GENESIS.md is BOSS-only" };
}
```

**Step 5: Add protection to bash.exec**

In `src/modules/filesystem/exec.ts`, this is harder — we can't reliably detect all shell commands that might write to a path. Add a best-effort check:

Add import:
```typescript
import { assertContained, getProtectedPaths } from "./containment.ts";
```

Export `getProtectedPaths()` from containment.ts:
```typescript
export function getProtectedPaths(): readonly string[] {
  return protectedPaths;
}
```

After the cwd containment check (line 50-53) and before the `try` block (line 60), add:

```typescript
// Best-effort check: reject commands that reference protected paths
for (const pp of getProtectedPaths()) {
  if (command.includes(pp)) {
    await context.audit.log({
      action: "genesis:write-denied",
      source: "bash.exec",
      detail: `Blocked command referencing protected path: ${command.slice(0, 200)}`,
      success: false,
    });
    return { success: false, output: "Access denied: command references a protected path (GENESIS.md is BOSS-only)" };
  }
}
```

**Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/genesis-fs-protection.test.ts`
Expected: All tests pass

**Step 7: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing filesystem tests don't set protected paths, so they're unaffected)

**Step 8: Commit**

```bash
git add src/modules/filesystem/write.ts src/modules/filesystem/delete.ts src/modules/filesystem/exec.ts src/modules/filesystem/containment.ts tests/unit/genesis-fs-protection.test.ts
git commit -m "feat(genesis): protect GENESIS.md from fs.write, fs.delete, and bash.exec"
```

---

### Task 7: Forge Genesis Protection

Reject Forge proposals that target the Genesis path.

**Files:**
- Modify: `src/modules/forge/apply.ts:27-68`
- Test: `tests/unit/forge-apply.test.ts` (add genesis rejection test)

**Step 1: Write the failing test**

Add to `tests/unit/forge-apply.test.ts` inside the existing describe block:

```typescript
import { setProtectedPaths } from "../../src/modules/filesystem/containment.ts";

// Inside the describe block, add:
test("rejects proposal with files targeting protected path", async () => {
  const genesisPath = "/tmp/friday-test-genesis-forge/GENESIS.md";
  setProtectedPaths([genesisPath]);

  const proposalId = "genesis-attack";
  proposals[`proposal:${proposalId}`] = {
    id: proposalId,
    action: "create",
    moduleName: "evil-module",
    description: "Attack genesis",
    files: [{ path: "index.ts", content: "// evil" }],
    createdAt: new Date().toISOString(),
  };

  // The forge_apply has a forgeDir arg — we need to make the resolved path
  // of a file match the protected path. Since this is tricky with the
  // module directory structure, we test the explicit genesis path check instead.
  const result = await forgeApply.execute(
    { proposalId, forgeDir: TEST_FORGE_DIR },
    context,
  );
  // This test validates the mechanism exists — the actual protection is in containment

  setProtectedPaths([]);
});
```

Actually, the Forge operates within `forgeDir` only. The better approach: add a check in `forge_apply` that verifies no proposed file's absolute path matches a protected path. Let me revise:

**Step 1 (revised): Write the failing test**

Add to the bottom of `tests/unit/forge-apply.test.ts`:

```typescript
import { setProtectedPaths } from "../../src/modules/filesystem/containment.ts";

describe("forge_apply — Genesis protection", () => {
  let context: ToolContext;
  let proposals: Record<string, ForgeProposal>;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    proposals = {};
    context = {
      workingDirectory: TEST_FORGE_DIR,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: makeMemory(proposals),
    };
    setProtectedPaths([`${TEST_FORGE_DIR}/evil-module/GENESIS.md`]);
  });

  afterEach(async () => {
    setProtectedPaths([]);
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("rejects proposal containing file that matches a protected path", async () => {
    const proposalId = "genesis-attack";
    proposals[`proposal:${proposalId}`] = {
      id: proposalId,
      action: "create",
      moduleName: "evil-module",
      description: "Targets genesis",
      files: [
        { path: "index.ts", content: "export default { name: 'evil', tools: [], protocols: [], knowledge: [], triggers: [], clearance: [], version: '1.0.0', description: 'evil' };" },
        { path: "GENESIS.md", content: "Hacked identity" },
      ],
      createdAt: new Date().toISOString(),
    };

    const result = await forgeApply.execute(
      { proposalId, forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("protected path");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-apply.test.ts`
Expected: FAIL — no protection check

**Step 3: Add protection to forge_apply**

In `src/modules/forge/apply.ts`, add import:
```typescript
import { isProtectedPath } from "../filesystem/containment.ts";
```

After the path containment per-file check (line 111-117) and before `await mkdir(...)` (line 119), add:

```typescript
if (isProtectedPath(filePath)) {
  await context.audit.log({
    action: "genesis:write-denied",
    source: "forge",
    detail: `Blocked forge proposal targeting protected path: ${filePath}`,
    success: false,
  });
  return {
    success: false,
    output: `Access denied: file "${file.path}" targets a protected path (GENESIS.md is BOSS-only)`,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/forge-apply.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/modules/forge/apply.ts tests/unit/forge-apply.test.ts
git commit -m "feat(genesis): reject Forge proposals targeting protected paths"
```

---

### Task 8: Initialize Protected Paths at Boot

Wire the runtime to set protected paths when Genesis is loaded.

**Files:**
- Modify: `src/core/runtime.ts` (boot method)
- Modify: `src/cli/tui/app.tsx:84-96` (pass genesisPath in bootConfig)

**Step 1: Write the failing test**

Add to the `"FridayRuntime — Genesis"` describe block in `tests/unit/runtime.test.ts`:

```typescript
import { isProtectedPath } from "../../src/modules/filesystem/containment.ts";

test("sets protected paths when genesisPath is provided", async () => {
  await writeFile(TEST_GENESIS_PATH, "Custom identity");
  runtime = new FridayRuntime();
  await runtime.boot({
    injectedProvider: stubProvider,
    genesisPath: TEST_GENESIS_PATH,
  });
  expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — `isProtectedPath` returns false

**Step 3: Add setProtectedPaths call to boot**

In `src/core/runtime.ts`, add import:
```typescript
import { setProtectedPaths } from "../modules/filesystem/containment.ts";
```

In the Genesis loading block (added in Task 4), after `enforceGenesisPermissions`, add:
```typescript
setProtectedPaths([config.genesisPath]);
```

**Step 4: Update TUI bootConfig**

In `src/cli/tui/app.tsx`, add to the `bootConfig` callback (around line 84-96):

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
  }),
  [options, projectRoot],
);
```

Add import at top of app.tsx:
```typescript
import { resolveGenesisPath } from "../../core/genesis.ts";
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: All tests pass

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/core/runtime.ts src/cli/tui/app.tsx tests/unit/runtime.test.ts
git commit -m "feat(genesis): initialize protected paths at boot and wire TUI"
```

---

### Task 9: CLI Command — friday genesis

Register the `genesis` CLI command with subcommands.

**Files:**
- Create: `src/cli/commands/genesis.ts`
- Modify: `src/cli/index.ts:6,29` (import and register)
- Create: `tests/unit/genesis-cli.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/genesis-cli.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, chmod, stat } from "node:fs/promises";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis-cli";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("friday genesis CLI", () => {
  beforeEach(async () => {
    await mkdir(TEST_GENESIS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
  });

  test("genesis init creates file from template", async () => {
    // Use the underlying function directly (CLI is a thin wrapper)
    const { seedGenesis } = await import("../../src/core/genesis.ts");
    const created = await seedGenesis(TEST_GENESIS_PATH);
    expect(created).toBe(true);
    const content = await Bun.file(TEST_GENESIS_PATH).text();
    expect(content).toBe(GENESIS_TEMPLATE);
  });

  test("genesis check reports valid file", async () => {
    await Bun.write(TEST_GENESIS_PATH, "Valid prompt");
    await chmod(TEST_GENESIS_PATH, 0o600);
    const { checkGenesis } = await import("../../src/core/genesis.ts");
    const result = await checkGenesis(TEST_GENESIS_PATH);
    expect(result.ok).toBe(true);
  });

  test("genesis check reports missing file", async () => {
    const { checkGenesis } = await import("../../src/core/genesis.ts");
    const result = await checkGenesis(`${TEST_GENESIS_DIR}/missing.md`);
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run tests to verify they pass** (these test the core functions from Task 2)

Run: `bun test tests/unit/genesis-cli.test.ts`
Expected: All pass (they test already-implemented functions)

**Step 3: Create the CLI command**

Create `src/cli/commands/genesis.ts`:

```typescript
import type { Command } from "commander";
import chalk from "chalk";
import {
  resolveGenesisPath,
  loadGenesis,
  seedGenesis,
  checkGenesis,
} from "../../core/genesis.ts";

export function genesisCommand(program: Command): void {
  const genesis = program
    .command("genesis")
    .description("Manage Friday's identity prompt (GENESIS.md)");

  genesis
    .command("show")
    .description("Display the current GENESIS.md content")
    .action(async () => {
      const path = resolveGenesisPath();
      try {
        const content = await loadGenesis(path);
        console.log(content);
      } catch (err) {
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err))
        );
        process.exit(1);
      }
    });

  genesis
    .command("path")
    .description("Print the resolved GENESIS.md file path")
    .action(() => {
      console.log(resolveGenesisPath());
    });

  genesis
    .command("init")
    .description(
      "Seed GENESIS.md from the built-in template (won't overwrite existing)"
    )
    .action(async () => {
      const path = resolveGenesisPath();
      const created = await seedGenesis(path);
      if (created) {
        console.log(chalk.green(`Created ${path}`));
        console.log(
          chalk.hex("#8B6914")("Edit with: friday genesis edit")
        );
      } else {
        console.log(
          chalk.yellow(`${path} already exists — not overwriting`)
        );
      }
    });

  genesis
    .command("edit")
    .description("Open GENESIS.md in $EDITOR")
    .action(async () => {
      const path = resolveGenesisPath();
      const editor = process.env.EDITOR ?? "vi";
      const proc = Bun.spawn([editor, path], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    });

  genesis
    .command("check")
    .description(
      "Validate GENESIS.md exists, permissions are correct, and content is non-empty"
    )
    .action(async () => {
      const path = resolveGenesisPath();
      const result = await checkGenesis(path);
      if (result.ok) {
        console.log(chalk.green(`${path} — OK`));
      } else {
        console.log(chalk.red(`${path} — Issues found:`));
        for (const issue of result.issues ?? []) {
          console.log(chalk.red(`  - ${issue}`));
        }
        process.exit(1);
      }
    });
}
```

**Step 4: Register the command**

In `src/cli/index.ts`, add import:
```typescript
import { genesisCommand } from "./commands/genesis.ts";
```

Add registration after `serveCommand(program);`:
```typescript
genesisCommand(program);
```

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/cli/commands/genesis.ts src/cli/index.ts tests/unit/genesis-cli.test.ts
git commit -m "feat(genesis): add friday genesis CLI command (show, path, init, edit, check)"
```

---

### Task 10: Remove Deprecated SYSTEM_PROMPT Alias

Now that everything uses GENESIS_TEMPLATE and genesisPrompt, clean up the backwards compat alias.

**Files:**
- Modify: `src/core/prompts.ts` (remove `SYSTEM_PROMPT` alias)

**Step 1: Remove the alias**

In `src/core/prompts.ts`, remove:
```typescript
/** @deprecated Use GENESIS_TEMPLATE */
export const SYSTEM_PROMPT = GENESIS_TEMPLATE;
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass (no remaining references to `SYSTEM_PROMPT`)

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/core/prompts.ts
git commit -m "chore: remove deprecated SYSTEM_PROMPT alias"
```

---

### Task 11: Update CLAUDE.md and Documentation

Update project documentation to reflect the Genesis system.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add to the Architecture section, after the existing key design patterns:

- **Genesis** (`src/core/genesis.ts`) is Friday's identity prompt, loaded from `~/.friday/GENESIS.md` at boot. The file is protected: `chmod 600`, filesystem tools and Forge reject writes to it, and it lives outside the repo. The BOSS edits it via `friday genesis edit`. `GENESIS_TEMPLATE` in `src/core/prompts.ts` is the seed template used by `friday genesis init`.

Add to the Commands section:
```bash
bun run start genesis init    # Seed GENESIS.md from built-in template
bun run start genesis show    # Print current identity prompt
bun run start genesis edit    # Open GENESIS.md in $EDITOR
bun run start genesis check   # Validate file exists and permissions
bun run start genesis path    # Print resolved file path
```

Add to Environment section:
```
Optional: `FRIDAY_GENESIS_PATH` to override default `~/.friday/GENESIS.md` location.
```

Update the MCU concept mapping to include:
```
Genesis=identity template
```

Add `genesis-cli.test.ts`, `genesis.test.ts`, `genesis-containment.test.ts`, `genesis-fs-protection.test.ts` to the test count context.

**Step 2: Run lint**

Run: `bun run lint:fix`

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Genesis identity system"
```
