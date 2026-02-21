# CLI Markdown Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render LLM markdown responses as styled ANSI terminal output so bold, headers, code blocks, tables, and lists display properly in Friday's CLI.

**Architecture:** A single `renderMarkdown()` utility in `src/cli/render.ts` wraps `marked` + `marked-terminal`. The chat command pipes LLM/protocol output through this function before printing. Configuration is a single options object with cyan headers to match Friday's theme.

**Tech Stack:** `marked@15`, `marked-terminal@7` (brings `cli-highlight`, `cli-table3`, `node-emoji` as transitive deps)

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install marked and marked-terminal**

Run:
```bash
bun add marked@15 marked-terminal@7
```

**Step 2: Verify installation**

Run:
```bash
bun run typecheck
```

Expected: Clean (no type errors)

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add marked@15 and marked-terminal@7 for CLI markdown rendering"
```

---

### Task 2: Create render.ts — Write the Failing Test

**Files:**
- Create: `tests/unit/render.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/render.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "../../src/cli/render.ts";

describe("renderMarkdown", () => {
  test("renders bold text with ANSI bold sequences", () => {
    const result = renderMarkdown("**bold**");
    // Should contain ANSI bold escape and not contain literal **
    expect(result).not.toContain("**bold**");
    expect(result).toContain("bold");
  });

  test("renders italic text with ANSI italic sequences", () => {
    const result = renderMarkdown("*italic*");
    expect(result).not.toContain("*italic*");
    expect(result).toContain("italic");
  });

  test("renders headers with styling", () => {
    const result = renderMarkdown("# Hello");
    // Should not contain the raw # prefix
    expect(result).not.toContain("# Hello");
    expect(result).toContain("Hello");
  });

  test("renders inline code distinctly", () => {
    const result = renderMarkdown("use `console.log`");
    // Should not contain literal backticks
    expect(result).not.toContain("`console.log`");
    expect(result).toContain("console.log");
  });

  test("renders fenced code blocks", () => {
    const result = renderMarkdown("```typescript\nconst x = 1;\n```");
    // Should contain the code content, not the fence markers
    expect(result).not.toContain("```");
    expect(result).toContain("const x = 1");
  });

  test("renders unordered lists", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  test("returns empty string for empty input", () => {
    const result = renderMarkdown("");
    expect(result.trim()).toBe("");
  });

  test("passes plain text through unchanged (minus trailing newline)", () => {
    const result = renderMarkdown("just plain text");
    expect(result.trim()).toBe("just plain text");
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/unit/render.test.ts
```

Expected: FAIL — `Cannot find module "../../src/cli/render.ts"`

---

### Task 3: Create render.ts — Implement

**Files:**
- Create: `src/cli/render.ts`

**Step 1: Write the implementation**

Create `src/cli/render.ts`:

```typescript
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

marked.use(
  markedTerminal({
    firstHeading: chalk.cyan.bold.underline,
    heading: chalk.cyan.bold,
    codespan: chalk.yellow,
    tab: 2,
  }),
);

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return marked.parse(text) as string;
}
```

**Step 2: Run tests to verify they pass**

Run:
```bash
bun test tests/unit/render.test.ts
```

Expected: 8 pass, 0 fail

**Step 3: Run full test suite**

Run:
```bash
bun test
```

Expected: All tests pass (existing 84 + 8 new = 92)

**Step 4: Commit**

```bash
git add src/cli/render.ts tests/unit/render.test.ts
git commit -m "feat: add renderMarkdown utility with marked-terminal"
```

---

### Task 4: Wire renderMarkdown into chat.ts

**Files:**
- Modify: `src/cli/commands/chat.ts:1-7` (imports)
- Modify: `src/cli/commands/chat.ts:78` (output line)

**Step 1: Add import**

In `src/cli/commands/chat.ts`, add to the imports:

```typescript
import { renderMarkdown } from "../render.ts";
```

**Step 2: Replace the raw output line**

Change line 78 from:

```typescript
console.log(`\n${prefix} ${result.output}\n`);
```

to:

```typescript
console.log(`\n${prefix} ${renderMarkdown(result.output)}`);
```

Note: `marked.parse()` already appends a trailing newline, so we remove the `\n` suffix.

**Step 3: Run typecheck**

Run:
```bash
bun run typecheck
```

Expected: Clean

**Step 4: Run full test suite**

Run:
```bash
bun test
```

Expected: All 92 tests pass

**Step 5: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat: render markdown in CLI chat output"
```

---

### Task 5: Lint and Final Verification

**Step 1: Run lint fix**

Run:
```bash
bun run lint:fix
```

Expected: Clean or auto-fixed

**Step 2: Run typecheck**

Run:
```bash
bun run typecheck
```

Expected: Clean

**Step 3: Run full test suite**

Run:
```bash
bun test
```

Expected: All tests pass (92 total)

**Step 4: Commit any lint fixes**

If lint changed anything:

```bash
git add -A
git commit -m "style: lint fixes for markdown rendering"
```

---

### Done Checklist

- [ ] `marked@15` and `marked-terminal@7` installed
- [ ] `src/cli/render.ts` created with `renderMarkdown()` function
- [ ] `tests/unit/render.test.ts` with 8 tests passing
- [ ] `src/cli/commands/chat.ts` calls `renderMarkdown()` on output
- [ ] `bun test` — all 92 tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
- [ ] Manual test: `bun run start` — markdown renders styled in terminal
