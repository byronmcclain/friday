# Forge Propose Simplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the reasoning-model hang in `forge_propose` by removing the `files` parameter from the LLM-visible tool interface, making creates always use a template, and updating the tool description to guide the LLM toward a multi-step workflow (propose skeleton → apply → modify via fs tools).

**Architecture:** The `files` parameter is removed from the LLM-facing `parameters` array but kept as a hidden arg (tests pass `files` directly via `execute()`). The `forge_propose` description is updated to teach the LLM the correct workflow: propose a skeleton, apply it, then use `fs.write` to fill in the actual code. The `clearance` is also fixed — `forge_propose` doesn't call the LLM provider, so `"provider"` clearance is wrong.

**Tech Stack:** TypeScript, Bun, bun:test

**Root Cause Context:** The Grok reasoning model (`grok-4-1-fast-reasoning-latest`) hangs when generating the `forge_propose` tool call because the `files` parameter asks it to embed entire TypeScript source files as JSON-escaped strings inside tool call arguments. The reasoning model's extended thinking phase (30-120+ seconds) produces zero visible text tokens, making the TUI appear frozen. Removing `files` from the LLM-visible schema reduces tool call complexity from "generate hundreds of lines of code as JSON" to "send 3 short strings."

---

### Task 1: Remove `files` from LLM-visible parameters, fix clearance

**Files:**
- Modify: `src/modules/forge/propose.ts:36-65` (parameters array + clearance)
- Test: `tests/unit/forge-propose.test.ts`

**Step 1: Write the failing test**

Add a test to `tests/unit/forge-propose.test.ts` that verifies `files` is NOT in the visible parameters and that clearance no longer includes `"provider"`:

```typescript
test("does not expose files parameter to the LLM", () => {
  const paramNames = forgePropose.parameters.map((p) => p.name);
  expect(paramNames).not.toContain("files");
});

test("does not require provider clearance", () => {
  expect(forgePropose.clearance).not.toContain("provider");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: 2 FAIL — `files` is currently in parameters, `"provider"` is in clearance

**Step 3: Modify propose.ts**

In `src/modules/forge/propose.ts`, make two changes:

1. Remove the `files` parameter object from the `parameters` array (lines 58-63). The array should only contain `action`, `moduleName`, and `description`.

2. Change `clearance: ["provider"]` to `clearance: []` — `forge_propose` doesn't call the LLM provider, it just stores a proposal in memory.

The `parameters` array should now be:

```typescript
parameters: [
  {
    name: "action",
    type: "string",
    description:
      '"create" for a new module or "patch" to modify an existing one',
    required: true,
  },
  {
    name: "moduleName",
    type: "string",
    description: "Name of the module to create or patch",
    required: true,
  },
  {
    name: "description",
    type: "string",
    description:
      "What the module should do (for create) or what to change (for patch)",
    required: true,
  },
],
clearance: [],
```

**Important:** Do NOT remove the `files` handling from the `execute()` function body. Tests and the `/forge` protocol can still pass `files` directly via `args`. We're only removing it from the LLM-visible schema.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add -f src/modules/forge/propose.ts tests/unit/forge-propose.test.ts
git commit -m "fix(forge): remove files param from LLM schema, fix clearance on propose"
```

---

### Task 2: Update the tool description to guide multi-step workflow

**Files:**
- Modify: `src/modules/forge/propose.ts:34-35` (description string)

**Step 1: Update the description**

Replace the current description string in `src/modules/forge/propose.ts` with a workflow-aware description that teaches the LLM the correct multi-step approach:

```typescript
description:
  "Create a skeleton module or register a patch proposal in the forge. For 'create': generates a template module with empty tools/protocols arrays — after forge_apply writes it to disk, use fs.write to add the actual implementation code to the module files. For 'patch': registers intent to modify an existing module — use fs.read to read current code, then fs.write to make changes, then forge_validate to check. Does NOT write to disk — use forge_apply with the returned proposalId to write.",
```

Key changes from the old description:
- Explicitly says the create action generates a **skeleton/template** (not full code)
- Teaches the multi-step workflow: propose → apply → fs.write → validate
- Removes the strict-mode TypeScript instruction (no longer relevant since LLM isn't generating code in the tool call)

**Step 2: Run all forge tests**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: ALL PASS (description change doesn't affect test assertions)

**Step 3: Commit**

```bash
git add -f src/modules/forge/propose.ts
git commit -m "docs(forge): update propose description for multi-step workflow"
```

---

### Task 3: Update existing test for clearance change

**Files:**
- Modify: `tests/unit/forge-propose.test.ts:23-25`

**Step 1: Fix the existing clearance test**

The existing test at line 23-25 checks `expect(forgePropose.clearance).toContain("provider")`. Update it to match the new clearance:

```typescript
test("has correct name and clearance", () => {
  expect(forgePropose.name).toBe("forge_propose");
  expect(forgePropose.clearance).toEqual([]);
});
```

**Step 2: Run test to verify it passes**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/unit/forge-propose.test.ts
git commit -m "test(forge): update propose clearance assertion to match empty array"
```

---

### Task 4: Update forge module clearance array

**Files:**
- Modify: `src/modules/forge/index.ts:17-24`

**Step 1: Write the failing test**

In `tests/unit/forge-propose.test.ts`, add:

```typescript
import forgeModule from "../../src/modules/forge/index.ts";

test("forge module does not declare provider clearance", () => {
  expect(forgeModule.clearance).not.toContain("provider");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: FAIL — forge module currently lists `"provider"` in clearance

**Step 3: Remove `"provider"` from the module clearance array**

In `src/modules/forge/index.ts`, update the clearance array from:

```typescript
clearance: [
  "provider",
  "write-fs",
  "read-fs",
  "exec-shell",
  "system",
  "forge-modify",
],
```

To:

```typescript
clearance: [
  "write-fs",
  "read-fs",
  "exec-shell",
  "system",
  "forge-modify",
],
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add -f src/modules/forge/index.ts tests/unit/forge-propose.test.ts
git commit -m "fix(forge): remove unnecessary provider clearance from forge module"
```

---

### Task 5: Enrich the skeleton template

**Files:**
- Modify: `src/modules/forge/propose.ts:4-30` (generateModuleTemplate function)
- Test: `tests/unit/forge-propose.test.ts`

**Step 1: Write the failing test**

The current template generates a completely empty module with `tools: []`. A better template should include a commented-out example tool so the LLM knows the structure when it fills in code via `fs.write`. Add:

```typescript
test("create template includes example tool comment", async () => {
  const result = await forgePropose.execute(
    { action: "create", moduleName: "example-mod", description: "An example" },
    context,
  );
  expect(result.success).toBe(true);
  expect(result.output).toContain("// TODO: Add your tools here");
  expect(result.output).toContain("FridayTool");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: FAIL — template doesn't contain the comment

**Step 3: Update generateModuleTemplate**

Replace the `generateModuleTemplate` function in `src/modules/forge/propose.ts` with:

```typescript
function generateModuleTemplate(
	moduleName: string,
	description: string,
): ForgeFile[] {
	const toolName = moduleName.replace(/-/g, "_");
	return [
		{
			path: "index.ts",
			content: `import type { FridayModule, FridayTool } from "../../src/modules/types.ts";

// TODO: Add your tools here
// Example tool structure:
//
// const myTool: FridayTool = {
//   name: "${toolName}.my_action",
//   description: "What this tool does",
//   parameters: [
//     { name: "input", type: "string", description: "The input", required: true },
//   ],
//   clearance: [],
//   async execute(args, context) {
//     const input = args.input as string;
//     return { success: true, output: \`Processed: \${input}\` };
//   },
// };

const ${toolName}Module = {
  name: ${JSON.stringify(moduleName)},
  description: ${JSON.stringify(description)},
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
} satisfies FridayModule;

export default ${toolName}Module;
`,
		},
	];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add -f src/modules/forge/propose.ts tests/unit/forge-propose.test.ts
git commit -m "feat(forge): enrich skeleton template with example tool structure"
```

---

### Task 6: Run full test suite and lint

**Step 1: Run all tests**

Run: `bun test`
Expected: ALL PASS (1111+ tests)

**Step 2: Run lint**

Run: `bun run lint`
Expected: Clean

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 4: Final commit if any lint fixes were needed**

If lint auto-fix was required:
```bash
bun run lint:fix
git add -A
git commit -m "style(forge): lint fixes"
```

---

## Summary of Changes

| File | Change |
|---|---|
| `src/modules/forge/propose.ts` | Remove `files` from `parameters` array (keep in execute body), fix clearance `[]`, update description for multi-step workflow, enrich template |
| `src/modules/forge/index.ts` | Remove `"provider"` from module clearance array |
| `tests/unit/forge-propose.test.ts` | Add tests for hidden `files` param, fix clearance assertion, test enriched template |

## What This Fixes

**Before:** LLM calls `forge_propose` with `files: [{path: "index.ts", content: "...300 lines of TS..."}]` — reasoning model spends 60-120s thinking, generates massive JSON, TUI hangs.

**After:** LLM calls `forge_propose` with just `{action: "create", moduleName: "...", description: "..."}` — fast tool call (~1s), gets skeleton back, then uses `fs.write` to add code file-by-file in separate, smaller tool calls.
