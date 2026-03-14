# ModuleContext for onLoad() Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give modules persistent `ScopedMemory` during `onLoad()` so Gmail OAuth tokens survive restarts.

**Architecture:** Add a `ModuleContext` interface to `src/modules/types.ts`, wire it through both module-loading loops in `src/core/runtime.ts`, and update Gmail's `onLoad()` to use `context.memory` instead of an ephemeral `Map`.

**Tech Stack:** TypeScript, bun:test, bun:sqlite

**Spec:** `docs/superpowers/specs/2026-03-14-module-context-onload-design.md`

---

## Chunk 1: Core Interface + Runtime Wiring + Tests

### Task 1: Add `ModuleContext` interface and update `FridayModule.onLoad()` signature

**Files:**
- Modify: `src/modules/types.ts:61-72`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/module-context.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { FridayModule, ModuleContext } from "../../src/modules/types.ts";

describe("ModuleContext", () => {
	test("ModuleContext type exists and has memory field", () => {
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		expect(context.memory).toBeDefined();
		expect(typeof context.memory.get).toBe("function");
		expect(typeof context.memory.set).toBe("function");
		expect(typeof context.memory.delete).toBe("function");
		expect(typeof context.memory.list).toBe("function");
	});

	test("FridayModule with zero-arg onLoad satisfies interface", () => {
		const mod = {
			name: "compat-test",
			description: "Tests backward compat",
			version: "1.0.0",
			tools: [],
			protocols: [],
			knowledge: [],
			triggers: [],
			clearance: [],
			async onLoad() {
				// zero-arg — must still be valid
			},
		} satisfies FridayModule;

		expect(typeof mod.onLoad).toBe("function");
	});

	test("FridayModule with ModuleContext onLoad satisfies interface", () => {
		const mod = {
			name: "context-test",
			description: "Tests new signature",
			version: "1.0.0",
			tools: [],
			protocols: [],
			knowledge: [],
			triggers: [],
			clearance: [],
			async onLoad(context: ModuleContext) {
				await context.memory.set("key", "value");
			},
		} satisfies FridayModule;

		expect(typeof mod.onLoad).toBe("function");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/module-context.test.ts`
Expected: FAIL — `ModuleContext` is not exported from `types.ts`

- [ ] **Step 3: Add `ModuleContext` and update `onLoad` signature**

In `src/modules/types.ts`, add the `ModuleContext` interface before `FridayModule` and update `onLoad`:

```typescript
// Add after ProtocolResult (after line 59):
export interface ModuleContext {
  memory: ScopedMemory;
}

// Change line 70 from:
//   onLoad?(): Promise<void>;
// To:
  onLoad?(context: ModuleContext): Promise<void>;
```

No new imports needed — `ScopedMemory` is already imported on line 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/module-context.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `bun test`
Expected: All existing tests pass. The `modules.test.ts` `validModule` object has no `onLoad` — unaffected. The `gmail-module.test.ts` checks `typeof gmailModule.onLoad === "function"` — unaffected (function still exists, just has a new param).

- [ ] **Step 6: Commit**

```bash
git add src/modules/types.ts tests/unit/module-context.test.ts
git commit -m "feat: add ModuleContext interface with ScopedMemory for onLoad()"
```

---

### Task 2: Wire `ModuleContext` through runtime module loading

**Files:**
- Modify: `src/core/runtime.ts:458-460` (core modules)
- Modify: `src/core/runtime.ts:482-484` (forge modules)

- [ ] **Step 1: Update core module loading call site**

In `src/core/runtime.ts`, change lines 458-460 from:

```typescript
if (mod.onLoad) {
    await mod.onLoad();
}
```

to:

```typescript
if (mod.onLoad) {
    await mod.onLoad({
        memory: this._memory?.scoped(mod.name) ?? {
            get: async () => undefined,
            set: async () => {},
            delete: async () => {},
            list: async () => [],
        },
    });
}
```

- [ ] **Step 2: Update forge module loading call site**

In `src/core/runtime.ts`, change lines 482-484 from:

```typescript
if (mod.onLoad) {
    await mod.onLoad();
}
```

to the same pattern:

```typescript
if (mod.onLoad) {
    await mod.onLoad({
        memory: this._memory?.scoped(mod.name) ?? {
            get: async () => undefined,
            set: async () => {},
            delete: async () => {},
            list: async () => [],
        },
    });
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — both call sites now provide the required `ModuleContext` argument.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass. Runtime tests don't exercise `onLoad` directly — they test boot orchestration at a higher level.

- [ ] **Step 5: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: pass ModuleContext to onLoad() at both module loading sites"
```

---

## Chunk 2: Gmail Fix + Forge Template + Tests

### Task 3: Update Gmail module to use persistent `context.memory`

**Files:**
- Modify: `src/modules/gmail/index.ts:1-84`
- Modify: `tests/unit/gmail-module.test.ts`

- [ ] **Step 1: Write the failing test for onLoad receiving context**

Add to `tests/unit/gmail-module.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import gmailModule from "../../src/modules/gmail/index.ts";
import type { ModuleContext } from "../../src/modules/types.ts";

describe("gmail module", () => {
	// ... existing tests stay unchanged ...

	test("onLoad accepts ModuleContext without error", async () => {
		// No GOOGLE_CLIENT_ID/SECRET set, so onLoad early-returns — but must accept context
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		// Should not throw — early returns due to missing env vars
		await gmailModule.onLoad(context);
	});
});
```

- [ ] **Step 2: Update Gmail `onLoad` to use `context.memory`**

Note: Skipping a "verify it fails" step here. Bun's runtime transpiler does not enforce TypeScript arity errors — calling `gmailModule.onLoad(context)` would pass at runtime even before the interface change (JavaScript ignores extra args). The real enforcement is `bun run typecheck`, which already covers this via Task 2.



Replace `src/modules/gmail/index.ts` lines 1 and 32-75. Change the import on line 1 and rewrite `onLoad`:

Line 1 — change from:
```typescript
import type { FridayModule } from "../types.ts";
```
to:
```typescript
import type { FridayModule, ModuleContext } from "../types.ts";
```

Lines 32-75 — replace the entire `onLoad` method:

```typescript
	async onLoad(context: ModuleContext) {
		const clientId = process.env.GOOGLE_CLIENT_ID;
		const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			console.warn(
				"[Gmail] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set — Gmail module inactive.",
			);
			return;
		}

		const secrets = new SecretStore(context.memory);
		const auth = new GmailAuth(secrets, clientId, clientSecret);
		setGmailAuth(auth);

		const client = new GmailClient(auth);
		const initialized = await client.initialize();

		if (initialized) {
			setGmailClient(client);
			console.log("[Gmail] Authenticated and ready.");
		} else {
			console.log(
				"[Gmail] Not authenticated. Run /gmail auth to set up.",
			);
		}
	},
```

This removes the ephemeral `Map`, the `scopedMemory` wrapper, and the TODO comment.

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test tests/unit/gmail-module.test.ts`
Expected: PASS (all tests including the new one)

- [ ] **Step 4: Commit**

```bash
git add src/modules/gmail/index.ts tests/unit/gmail-module.test.ts
git commit -m "fix: use persistent ScopedMemory for Gmail OAuth token storage"
```

---

### Task 4: Add token persistence roundtrip test

**Files:**
- Create: `tests/unit/module-context-gmail.test.ts`

- [ ] **Step 1: Write the roundtrip test**

Create `tests/unit/module-context-gmail.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { SecretStore } from "../../src/core/secrets.ts";

const TEST_DB = "/tmp/friday-test-module-context-gmail.db";

describe("Gmail token persistence via ScopedMemory", () => {
	afterEach(async () => {
		await unlink(TEST_DB).catch(() => {});
		await unlink(`${TEST_DB}-wal`).catch(() => {});
		await unlink(`${TEST_DB}-shm`).catch(() => {});
	});

	test("encrypted tokens survive across SecretStore instances sharing same ScopedMemory", async () => {
		const memory = new SQLiteMemory(TEST_DB);
		const scoped = memory.scoped("gmail");

		// First boot: encrypt and store a token
		const secrets1 = new SecretStore(scoped, { injectedKey: "test-key-for-gmail-roundtrip!!" });
		await secrets1.encrypt("gmail:access_token", "ya29.test-access-token");
		await secrets1.encrypt("gmail:refresh_token", "1//test-refresh-token");

		// Second boot: new SecretStore, same ScopedMemory backing
		const secrets2 = new SecretStore(scoped, { injectedKey: "test-key-for-gmail-roundtrip!!" });
		const access = await secrets2.decrypt("gmail:access_token");
		const refresh = await secrets2.decrypt("gmail:refresh_token");

		expect(access).toBe("ya29.test-access-token");
		expect(refresh).toBe("1//test-refresh-token");

		memory.close();
	});

	test("null-object fallback does not crash onLoad", async () => {
		const noopMemory = {
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
			list: async () => [],
		};

		// SecretStore with no-op memory — encrypt/decrypt should not throw
		const secrets = new SecretStore(noopMemory, { injectedKey: "test-key-noop-fallback!!!!!!!!" });
		await secrets.encrypt("gmail:access_token", "ya29.test");
		const result = await secrets.decrypt("gmail:access_token");

		// No-op set means nothing persisted — decrypt returns null
		expect(result).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/unit/module-context-gmail.test.ts`
Expected: PASS (both tests)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/module-context-gmail.test.ts
git commit -m "test: add Gmail token persistence roundtrip and null-object fallback tests"
```

---

### Task 5: Update Forge template with `ModuleContext` import and example

**Files:**
- Modify: `src/modules/forge/propose.ts:12-46`

- [ ] **Step 1: Update the template import line**

In `src/modules/forge/propose.ts`, change line 12 from:

```typescript
content: `import type { FridayModule, FridayTool, ToolContext, ToolResult } from "../../src/modules/types.ts";
```

to:

```typescript
content: `import type { FridayModule, FridayTool, ToolContext, ToolResult, ModuleContext } from "../../src/modules/types.ts";
```

- [ ] **Step 2: Add `onLoad` example comment to template**

Inside the same template string literal (between line 32's `// };` and line 34's `const ${toolName}Module`), add:

```typescript
//
// Optional lifecycle hook with persistent storage:
//
// async onLoad(context: ModuleContext) {
//   const saved = await context.memory.get<string>("my-key");
//   await context.memory.set("my-key", "my-value");
// },
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run existing Forge tests**

Run: `bun test tests/unit/modules.test.ts`
Expected: PASS — forge module discovery tests don't import the template

- [ ] **Step 5: Commit**

```bash
git add src/modules/forge/propose.ts
git commit -m "docs: add ModuleContext import and onLoad example to Forge template"
```

---

## Chunk 3: Documentation Updates

### Task 6: Update CLAUDE.md and README.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md module pattern note**

In `CLAUDE.md`, find line 203:

```markdown
- **Module pattern**: `satisfies FridayModule` preferred over `: FridayModule` for literal type preservation. Mutable arrays for triggers/clearance (no `as const`).
```

Change to:

```markdown
- **Module pattern**: `satisfies FridayModule` preferred over `: FridayModule` for literal type preservation. Mutable arrays for triggers/clearance (no `as const`). `onLoad(context: ModuleContext)` receives `ScopedMemory` for persistent storage (namespaced by module name).
```

- [ ] **Step 2: Update README.md module example**

In `README.md`, find lines 957-959:

```typescript
  async onLoad() {
    // Called when the module is loaded at boot
  },
```

Change to:

```typescript
  async onLoad(context) {
    // Called when the module is loaded at boot — context.memory provides persistent ScopedMemory
  },
```

- [ ] **Step 3: Update README.md mermaid diagram label**

In `README.md`, find line 241:

```
        M --> LC[Lifecycle: onLoad / onUnload]
```

Change to:

```
        M --> LC[Lifecycle: onLoad&#40;context&#41; / onUnload]
```

- [ ] **Step 4: Run lint to verify no formatting issues**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document ModuleContext in CLAUDE.md and README.md"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS
