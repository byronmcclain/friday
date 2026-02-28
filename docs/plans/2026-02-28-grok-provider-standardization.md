# Grok Provider Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all multi-provider abstraction code and standardize Friday on Grok (xAI) as the sole LLM provider.

**Architecture:** Delete the provider factory's switch statement, `ProviderName` type, and `PROVIDER_DEFAULTS` record. Replace with a flat `GROK_DEFAULTS` constant and a single-param `createModel(modelId)`. Remove `--provider` CLI flag and `@ai-sdk/anthropic` dependency. Keep `--model`/`--fast-model` override chain intact.

**Tech Stack:** TypeScript, Bun, AI SDK v6 (`@ai-sdk/xai`), Commander.js

**Design doc:** `docs/plans/2026-02-28-grok-provider-standardization-design.md`

---

### Task 1: Provider Factory + Types (foundation)

**Files:**
- Modify: `src/providers/index.ts`
- Modify: `src/core/types.ts`

**Step 1: Write the failing test**

Update `tests/unit/provider-create-model.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createModel, GROK_DEFAULTS } from "../../src/providers/index.ts";

describe("createModel", () => {
	test("creates xai model for the given model ID", () => {
		const model = createModel(GROK_DEFAULTS.model);
		expect(model.modelId).toContain("grok");
		expect(model.provider).toContain("xai");
	});

	test("GROK_DEFAULTS has reasoning and fast model", () => {
		expect(GROK_DEFAULTS.model).toBe("grok-4-1-fast-reasoning-latest");
		expect(GROK_DEFAULTS.fastModel).toBe("grok-4-1-fast-non-reasoning");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/provider-create-model.test.ts`
Expected: FAIL — `GROK_DEFAULTS` not exported, `createModel` signature mismatch

**Step 3: Write implementation**

Replace `src/providers/index.ts` with:

```typescript
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { xai } from "@ai-sdk/xai";

export const GROK_DEFAULTS = {
	model: "grok-4-1-fast-reasoning-latest",
	fastModel: "grok-4-1-fast-non-reasoning",
} as const;

/** Create an AI SDK LanguageModelV3 for the given Grok model ID */
export function createModel(modelId: string): LanguageModelV3 {
	return xai(modelId);
}
```

Update `src/core/types.ts` — remove `ProviderName` type and `provider` field from `FridayConfig`:

```typescript
/** Configuration for Cortex */
export interface FridayConfig {
  /** Model identifier (e.g., "grok-4-1-fast-reasoning-latest") */
  model: string;
  /** Fast model for utility tasks (summarization, knowledge extraction) */
  fastModel?: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}
```

Delete these lines:
- `/** Supported LLM provider names */`
- `export type ProviderName = "anthropic" | "grok";`
- `/** Which LLM provider to use */`
- `provider: ProviderName;`

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/provider-create-model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/index.ts src/core/types.ts tests/unit/provider-create-model.test.ts
git commit -m "refactor: simplify provider factory to Grok-only"
```

---

### Task 2: Cortex — remove provider abstraction

**Files:**
- Modify: `src/core/cortex.ts`
- Modify: `tests/unit/cortex-ai-sdk.test.ts`
- Modify: `tests/unit/friday.test.ts`

**Step 1: Write the failing tests**

Update `tests/unit/cortex-ai-sdk.test.ts` — remove the `providerName` test (line 99-105) and remove `provider: "grok"` from configs:

In the `providerName returns configured provider` test, change to test `modelName` instead (providerName getter is being removed):

```typescript
// DELETE this test entirely:
// test("providerName returns configured provider", () => { ... })
```

Update `tests/unit/friday.test.ts` — remove `provider: "grok"` from Cortex constructors:

Lines 32 and 37: change `new Cortex({ injectedModel: createMockModel(), provider: "grok" })` to `new Cortex({ injectedModel: createMockModel() })`.

Remove the `providerName` assertion on line 33: `expect(cortex.providerName).toBe("grok");`

Change line 38 to use `GROK_DEFAULTS`:
```typescript
import { GROK_DEFAULTS } from "../../src/providers/index.ts";
// ...
expect(cortex.modelName).toBe(GROK_DEFAULTS.model);
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts`
Expected: FAIL — `provider` no longer exists in CortexConfig

**Step 3: Write implementation**

In `src/core/cortex.ts`:

1. Remove imports of `DEFAULT_PROVIDER` and `PROVIDER_DEFAULTS` (line 8). Change to import `GROK_DEFAULTS`:
```typescript
import { createModel, GROK_DEFAULTS } from "../providers/index.ts";
```

2. Remove `_providerName` field (line 43) and its getter (lines 86-88).

3. Update constructor (lines 61-68):
```typescript
constructor(config: CortexConfig = {}) {
	this._modelName = config.model ?? GROK_DEFAULTS.model;
	this.maxTokens = config.maxTokens ?? 12288;
	this.maxToolIterations = config.maxToolIterations ?? 10;

	this.aiModel = config.injectedModel ?? createModel(this._modelName);

	this.historyManager = new HistoryManager({ maxTokens: 128000 });
	// ... rest unchanged
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts
git commit -m "refactor: remove provider abstraction from Cortex"
```

---

### Task 3: Runtime — simplify model resolution

**Files:**
- Modify: `src/core/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

**Step 1: Update tests**

In `tests/unit/runtime.test.ts`:

1. Change import (line 5): `PROVIDER_DEFAULTS` → `GROK_DEFAULTS`:
```typescript
import { GROK_DEFAULTS } from "../../src/providers/index.ts";
```

2. Remove `providerName` assertion (line 28): `expect(runtime.cortex.providerName).toBe("grok");` — replace with:
```typescript
expect(runtime.cortex.modelName).toBe(GROK_DEFAULTS.model);
```

3. Update `fastModel` default test (line 394): `PROVIDER_DEFAULTS.grok.fastModel` → `GROK_DEFAULTS.fastModel`:
```typescript
expect(runtime.fastModel).toBe(GROK_DEFAULTS.fastModel);
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — `PROVIDER_DEFAULTS` no longer exported

**Step 3: Write implementation**

In `src/core/runtime.ts`:

1. Remove `ProviderName` from import (line 2):
```typescript
import type { FridayConfig } from "./types.ts";
```

2. Change provider import (line 4):
```typescript
import { createModel, GROK_DEFAULTS } from "../providers/index.ts";
```

3. Simplify model resolution (lines 272-276):
```typescript
// Resolve dual models: CLI flag > env var > default
const reasoningModel = config.model ?? process.env.FRIDAY_REASONING_MODEL ?? GROK_DEFAULTS.model;
this._fastModel = config.fastModel ?? process.env.FRIDAY_FAST_MODEL ?? GROK_DEFAULTS.fastModel;
```

4. Remove `provider: providerName` from Cortex constructor call (line 318):
```typescript
this._cortex = new Cortex({
	model: reasoningModel,
	maxTokens: config.maxTokens,
	injectedModel: config.injectedModel,
	// ... rest unchanged (remove provider line)
});
```

5. Update `createModel` call to single-param (line 370):
```typescript
const subsystemModel: LanguageModelV3 =
	config.injectedFastModel ?? config.injectedModel ?? createModel(this._fastModel);
```

6. Update audit log (line 430) — remove provider reference:
```typescript
detail: `Friday online. Model: ${reasoningModel}, Modules: ${this._modules.length}`,
```

7. Update conversation save (line 580) — hardcode `"grok"` since the SQLite schema column still exists:
```typescript
provider: "grok",
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/runtime.ts tests/unit/runtime.test.ts
git commit -m "refactor: simplify runtime model resolution to Grok-only"
```

---

### Task 4: CLI commands — remove --provider flag

**Files:**
- Modify: `src/cli/commands/chat.ts`
- Modify: `src/cli/commands/serve.ts`
- Modify: `tests/unit/serve-command.test.ts`

**Step 1: Update tests**

In `tests/unit/serve-command.test.ts` — delete the provider test (lines 18-22):
```typescript
// DELETE:
// test("has --provider option", () => { ... })
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/serve-command.test.ts`
Expected: FAIL — `--provider` option no longer registered

**Step 3: Write implementation**

In `src/cli/commands/chat.ts`:

1. Remove `DEFAULT_PROVIDER` import (line 2):
```typescript
// DELETE: import { DEFAULT_PROVIDER } from "../../providers/index.ts";
```

2. Remove the `--provider` option (lines 12-16).

3. Remove `provider` from launchTui options (line 34):
```typescript
await launchTui({
	model: options.model,
	fastModel: options.fastModel,
	fresh: options.fresh,
	debug: globalOpts.debug,
	socketPath: singletonAvailable
		? DEFAULT_SOCKET_PATH
		: undefined,
});
```

In `src/cli/commands/serve.ts`:

1. Remove imports (lines 11-12):
```typescript
// DELETE: import type { ProviderName } from "../../core/types.ts";
// DELETE: import { DEFAULT_PROVIDER } from "../../providers/index.ts";
```

2. Remove the `--provider` option (lines 19-23).

3. Remove `provider` from runtimeConfig (line 38):
```typescript
runtimeConfig: {
	model: options.model,
	smartsDir: resolve(projectRoot, "smarts"),
	dataDir: resolve(projectRoot, "data"),
	modulesDir: resolve(projectRoot, "src/modules"),
	debug: globalOpts.debug,
},
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/serve-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/chat.ts src/cli/commands/serve.ts tests/unit/serve-command.test.ts
git commit -m "refactor: remove --provider CLI flag from chat and serve commands"
```

---

### Task 5: TUI — remove provider from props and display

**Files:**
- Modify: `src/cli/tui/app.tsx`
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/components/header.tsx`
- Modify: `src/cli/tui/components/welcome.tsx`
- Modify: `src/cli/tui/components/chat-area.tsx`

**Step 1: Write implementation**

In `src/cli/tui/app.tsx`:

1. Remove `ProviderName` import (line 10):
```typescript
// DELETE: import type { ProviderName } from "../../core/types.ts";
```

2. Remove `provider` from `FridayAppProps.options` interface (line 53):
```typescript
interface FridayAppProps {
	options: {
		model?: string;
		fastModel?: string;
		fresh?: boolean;
		debug?: boolean;
		socketPath?: string;
	};
	renderer: Awaited<ReturnType<typeof createCliRenderer>>;
}
```

3. Remove `provider` from `bootConfig` (line 96):
```typescript
const bootConfig = useCallback(
	() => ({
		model: options.model,
		fastModel: options.fastModel,
		// ... rest unchanged (remove provider line, remove ProviderName cast)
	}),
	[options, projectRoot],
);
```

4. Update singleton connection display (line 157 area) — remove `runtimeProvider`, simplify:
```typescript
let runtimeModel = options.model ?? "...";
try {
	const info = await socketBridge.identify();
	runtimeModel = info.model;
} catch {
	// Identification failed — use CLI options as fallback
}
```

5. Update `set-welcome` dispatches to remove `provider`:
```typescript
dispatch({
	type: "set-welcome",
	info: { model: runtimeModel },
});
```

6. Update local mode provider label (line 254 area):
```typescript
const modelLabel = runtime.cortex.modelName;
const toolCount = runtime.cortex.availableTools.length;
dispatch({
	type: "set-welcome",
	info: { model: modelLabel },
});
dispatch({
	type: "add-message",
	message: createMessage(
		"system",
		`Friday online. (Grok: ${modelLabel}, ${toolCount} tools)`,
	),
});
```

7. Update header props (lines 558-565) — remove provider computation:
```typescript
const model = headerRuntime?.isBooted
	? headerRuntime.cortex.modelName
	: (state.welcomeInfo?.model ?? options.model ?? "...");
```

8. Pass only `model` to Header (line 578):
```typescript
<Header model={model} />
```

9. Update `launchTui` signature (line 604):
```typescript
export async function launchTui(options: {
	model?: string;
	fastModel?: string;
	fresh?: boolean;
	debug?: boolean;
	socketPath?: string;
}): Promise<void> {
```

In `src/cli/tui/state.ts`:

1. Remove `provider` from `WelcomeInfo` (line 9):
```typescript
export interface WelcomeInfo {
	model: string;
}
```

In `src/cli/tui/components/header.tsx`:

1. Change props (line 44-46):
```typescript
interface HeaderProps {
	model: string;
}
```

2. Update function signature and display (line 49):
```typescript
export function Header({ model }: HeaderProps) {
```

3. Change the model display (line 65):
```typescript
<text fg={PALETTE.amberDim}>
	{`Grok: ${model}`}
</text>
```

In `src/cli/tui/components/welcome.tsx`:

1. Change props:
```typescript
interface WelcomeProps {
	model: string;
}

export function Welcome({ model }: WelcomeProps) {
```

2. Change display (line 25):
```typescript
{`Model: ${model}`}
```

In `src/cli/tui/components/chat-area.tsx`:

1. Update Welcome usage (line 73):
```typescript
<Welcome model={welcomeInfo.model} />
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/tui/app.tsx src/cli/tui/state.ts src/cli/tui/components/header.tsx src/cli/tui/components/welcome.tsx src/cli/tui/components/chat-area.tsx
git commit -m "refactor: remove provider from TUI props and display"
```

---

### Task 6: Server protocol — remove provider from messages

**Files:**
- Modify: `src/server/protocol.ts`
- Modify: `src/server/handler.ts`
- Modify: `src/server/index.ts`
- Modify: `tests/unit/socket-server.test.ts` (if provider references exist)

**Step 1: Write implementation**

In `src/server/protocol.ts`:

1. Remove `ProviderName` import (line 1):
```typescript
// DELETE: import type { ProviderName } from "../core/types.ts";
```

2. Remove `provider` from `session:boot` client message (line 12):
```typescript
| {
		type: "session:boot";
		id: string;
		model?: string;
		fastModel?: string;
		fresh?: boolean;
  }
```

3. Remove `provider` from `session:booted` server message (line 44):
```typescript
| { type: "session:booted"; requestId: string; model: string; fastModel: string }
```

4. Remove `provider` from `session:ready` server message (line 63):
```typescript
| { type: "session:ready"; requestId: string; model: string; capabilities: string[] }
```

In `src/server/handler.ts`:

1. Update `handleIdentify` — remove `providerName` (line 145):
```typescript
send({
	type: "session:ready",
	requestId: msg.id,
	model: this.runtime.cortex.modelName,
	capabilities: [...capabilities],
});
```

2. Update `handleLegacyBoot` — remove `providerName` (line 169):
```typescript
send({
	type: "session:booted",
	requestId: msg.id,
	model: this.runtime.cortex.modelName,
	fastModel: this.runtime.fastModel,
});
```

In `src/server/index.ts` — no changes needed (passes `runtimeConfig` which no longer has `provider`).

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/server/protocol.ts src/server/handler.ts
git commit -m "refactor: remove provider from server protocol messages"
```

---

### Task 7: Bridge + remaining test cleanup

**Files:**
- Modify: `src/core/bridges/socket.ts` (update identify return type)
- Modify: `tests/unit/socket-server.test.ts`
- Modify: `tests/unit/memory.test.ts`
- Modify: `tests/unit/history-protocol.test.ts`
- Modify: `tests/unit/recall-tool.test.ts`
- Modify: `tests/unit/memory-conversations.test.ts`

**Step 1: Write implementation**

In `src/core/bridges/socket.ts` — update `identify()` return type (line 130):
```typescript
async identify(): Promise<{ model: string }> {
```

And update the resolve calls accordingly — remove `provider` from the returned objects.

In test files, the `provider` field still exists on `ConversationSession` (SQLite schema unchanged). The `provider: "grok"` or `provider: "anthropic"` values in test fixtures should all be changed to `provider: "grok"`. This is data, not code logic — we're just standardizing the test data.

Update in `tests/unit/memory.test.ts`:
- Lines 92, 109, 130: Change `provider: "anthropic"` → `provider: "grok"`

Update in `tests/unit/history-protocol.test.ts`:
- Line 37: Change `provider: "anthropic"` → `provider: "grok"`

In `tests/unit/socket-server.test.ts`:
- Lines 15, 28: Remove `providerName` from mockRuntime cortex — update to only have `modelName`:
```typescript
const mockRuntime = { isBooted: true, cortex: { modelName: "test" } } as any;
```

**Step 2: Run the full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/core/bridges/socket.ts tests/unit/socket-server.test.ts tests/unit/memory.test.ts tests/unit/history-protocol.test.ts tests/unit/recall-tool.test.ts tests/unit/memory-conversations.test.ts
git commit -m "refactor: clean up provider references in bridges and tests"
```

---

### Task 8: Remove @ai-sdk/anthropic dependency

**Files:**
- Modify: `package.json`
- Regenerate: `bun.lock`

**Step 1: Remove the dependency**

Run: `bun remove @ai-sdk/anthropic`

**Step 2: Verify clean install**

Run: `bun install`
Expected: No errors

**Step 3: Run the full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: remove @ai-sdk/anthropic dependency"
```

---

### Task 9: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Update CLAUDE.md**

Remove/update these sections:
- Environment section: Remove `ANTHROPIC_API_KEY` reference, remove `--provider anthropic` line
- Architecture patterns: Remove "Dual-model architecture" mention of `PROVIDER_DEFAULTS` record shape, update to `GROK_DEFAULTS`
- Remove all mentions of `ProviderName` type
- Update provider factory description
- Update CLI commands section to remove `--provider` references

**Step 2: Update README.md**

- Remove `ANTHROPIC_API_KEY` from environment section
- Remove `--provider` from CLI usage
- Remove Anthropic references from Docker examples
- Update architecture diagram if provider factory is mentioned

**Step 3: Update .env.example**

Remove the `ANTHROPIC_API_KEY` line.

**Step 4: Lint**

Run: `bun run lint:fix`

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add CLAUDE.md README.md .env.example
git commit -m "docs: update documentation for Grok-only provider"
```

---

### Task 10: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS — same count as before (tests removed for anthropic provider, but no new test failures)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS (no violations)

**Step 4: Verify no remaining anthropic references**

Run: `grep -ri "anthropic" src/ tests/ --include="*.ts" --include="*.tsx" -l`
Expected: No files (only docs/plans/ design doc should reference it historically)

**Step 5: Verify no remaining ProviderName references**

Run: `grep -ri "ProviderName" src/ tests/ --include="*.ts" --include="*.tsx" -l`
Expected: No files
