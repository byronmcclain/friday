# Module Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 18 code review issues (security, bugs, conventions, code smells, test gaps) across 6 modules.

**Architecture:** Grouped by fix type — validation foundation first, then security fixes that consume it, then bugs, conventions, smells, and finally tests. Each task is independently committable.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Create shared validation utilities

**Files:**
- Create: `src/modules/validation.ts`
- Test: `tests/unit/validation.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, expect, test } from "bun:test";
import { assertSafeArg, assertAllowedProtocol, assertInteger } from "../../src/modules/validation.ts";

describe("assertSafeArg", () => {
	test("returns null for safe values", () => {
		expect(assertSafeArg("main", "ref")).toBeNull();
		expect(assertSafeArg("feature/foo", "ref")).toBeNull();
		expect(assertSafeArg("HEAD~3", "ref")).toBeNull();
	});

	test("rejects values starting with dash", () => {
		const result = assertSafeArg("--upload-pack=evil", "ref");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("ref");
	});

	test("rejects empty string", () => {
		const result = assertSafeArg("", "name");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});
});

describe("assertAllowedProtocol", () => {
	test("allows http URLs", () => {
		expect(assertAllowedProtocol("http://example.com")).toBeNull();
	});

	test("allows https URLs", () => {
		expect(assertAllowedProtocol("https://example.com/path")).toBeNull();
	});

	test("rejects file: protocol", () => {
		const result = assertAllowedProtocol("file:///etc/passwd");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("file:");
	});

	test("rejects data: protocol", () => {
		const result = assertAllowedProtocol("data:text/html,<h1>hi</h1>");
		expect(result).not.toBeNull();
		expect(result!.output).toContain("data:");
	});

	test("rejects ftp: protocol", () => {
		const result = assertAllowedProtocol("ftp://files.example.com");
		expect(result).not.toBeNull();
	});

	test("rejects invalid URLs", () => {
		const result = assertAllowedProtocol("not-a-url");
		expect(result).not.toBeNull();
		expect(result!.output).toContain("Invalid URL");
	});
});

describe("assertInteger", () => {
	test("accepts valid numbers", () => {
		const result = assertInteger(5, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(5);
	});

	test("accepts zero", () => {
		const result = assertInteger(0, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(0);
	});

	test("floors floating point", () => {
		const result = assertInteger(2.7, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(2);
	});

	test("rejects negative numbers", () => {
		const result = assertInteger(-1, "index");
		expect("success" in result).toBe(true);
		if ("success" in result) expect(result.success).toBe(false);
	});

	test("rejects NaN", () => {
		const result = assertInteger(NaN, "index");
		expect("success" in result).toBe(true);
	});

	test("rejects strings", () => {
		const result = assertInteger("not-a-number", "index");
		expect("success" in result).toBe(true);
	});

	test("coerces numeric strings", () => {
		const result = assertInteger("3", "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(3);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/validation.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import type { ToolResult } from "./types.ts";

/**
 * Reject CLI argument values starting with "-" to prevent flag injection.
 * Returns null if safe, or a ToolResult rejection to early-return.
 */
export function assertSafeArg(value: string, label: string): ToolResult | null {
	if (!value) {
		return { success: false, output: `Invalid ${label}: must not be empty` };
	}
	if (value.startsWith("-")) {
		return { success: false, output: `Invalid ${label}: must not start with "-"` };
	}
	return null;
}

/**
 * Allowlist http: and https: protocols only. Prevents SSRF via file:, data:, ftp:, etc.
 * Returns null if safe, or a ToolResult rejection to early-return.
 */
export function assertAllowedProtocol(url: string): ToolResult | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { success: false, output: `Invalid URL: ${url}` };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { success: false, output: `Disallowed protocol: ${parsed.protocol}. Only http: and https: are permitted.` };
	}
	return null;
}

/**
 * Validate and coerce a value to a non-negative integer.
 * Prevents type confusion from `as number` casts on LLM-provided args.
 * Returns { value: number } on success, or a ToolResult rejection.
 */
export function assertInteger(value: unknown, label: string): { value: number } | ToolResult {
	const num = Number(value);
	if (!Number.isFinite(num) || num < 0) {
		return { success: false, output: `Invalid ${label}: must be a non-negative integer` };
	}
	return { value: Math.floor(num) };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/validation.test.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add src/modules/validation.ts tests/unit/validation.test.ts
git commit -m "feat(modules): add shared input validation utilities

assertSafeArg, assertAllowedProtocol, assertInteger for
preventing flag injection, SSRF, and type confusion."
```

---

### Task 2: Fix SSRF in web-fetch and notify modules

**Files:**
- Modify: `src/modules/web-fetch/fetch.ts:56-60`
- Modify: `src/modules/notify/send.ts:75-76,118-119,159-160`
- Test: `tests/unit/web-fetch-module.test.ts`
- Test: `tests/unit/notify-module.test.ts`

**Step 1: Add SSRF tests to web-fetch**

Append to the `web.fetch` describe block in `tests/unit/web-fetch-module.test.ts`:

```typescript
	test("rejects file: protocol (SSRF)", async () => {
		const result = await webFetch.execute({ url: "file:///etc/passwd" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});

	test("rejects data: protocol (SSRF)", async () => {
		const result = await webFetch.execute({ url: "data:text/html,hello" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});
```

Append to the `notify.send` describe block in `tests/unit/notify-module.test.ts`:

```typescript
	test("rejects non-http webhook URL (SSRF)", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "webhook", url: "file:///etc/passwd" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/web-fetch-module.test.ts tests/unit/notify-module.test.ts`
Expected: FAIL — new tests fail (SSRF not blocked yet)

**Step 3: Add protocol validation to web-fetch/fetch.ts**

In `src/modules/web-fetch/fetch.ts`, add import and protocol check after the `new URL()` check:

Replace lines 1-2 with:
```typescript
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertAllowedProtocol } from "../validation.ts";
```

Replace lines 56-60 with:
```typescript
		const protocolCheck = assertAllowedProtocol(url);
		if (protocolCheck) return protocolCheck;
```

This replaces the existing `try { new URL(url) } catch` block because `assertAllowedProtocol` already handles invalid URLs.

**Step 4: Add protocol validation to notify/send.ts**

In `src/modules/notify/send.ts`, add import:
```typescript
import { assertAllowedProtocol } from "../validation.ts";
```

After each `webhookUrl` resolution (3 places — slack, webhook, email), before the `sendWebhook()` call, add:
```typescript
					const protocolCheck = assertAllowedProtocol(webhookUrl);
					if (protocolCheck) return protocolCheck;
```

Add after line 83 (slack case, after the `if (!webhookUrl)` guard).
Add after line 126 (webhook case, after the `if (!webhookUrl)` guard).
Add after line 167 (email case, after the `if (!emailWebhookUrl)` guard).

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/web-fetch-module.test.ts tests/unit/notify-module.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/web-fetch/fetch.ts src/modules/notify/send.ts tests/unit/web-fetch-module.test.ts tests/unit/notify-module.test.ts
git commit -m "fix(security): add SSRF protection to web-fetch and notify

Validate URL protocols (http/https only) before making requests.
Blocks file:, data:, ftp:, and other dangerous protocols."
```

---

### Task 3: Fix git flag injection

**Files:**
- Modify: `src/modules/git/diff.ts:53`
- Modify: `src/modules/git/log.ts:67`
- Modify: `src/modules/git/branch.ts:79-81`
- Modify: `src/modules/git/push.ts:38,40`
- Modify: `src/modules/git/pull.ts:45-46`
- Test: `tests/unit/git-module.test.ts`

**Step 1: Add flag injection tests**

Append to the `git.diff` describe block in `tests/unit/git-module.test.ts`:

```typescript
	test("rejects ref starting with dash (flag injection)", async () => {
		const result = await gitDiff.execute({ ref: "--upload-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
```

Append to the `git.log` describe block:

```typescript
	test("rejects ref starting with dash (flag injection)", async () => {
		const result = await gitLog.execute({ ref: "--exec=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
```

Append to the `git.branch` describe block:

```typescript
	test("rejects branch name starting with dash (flag injection)", async () => {
		const result = await gitBranch.execute(
			{ action: "create", name: "--option=evil" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
```

Add new imports at top of test file, then add describe blocks:

Import `gitPush` and `gitPull`:
```typescript
import { gitPush } from "../../src/modules/git/push.ts";
import { gitPull } from "../../src/modules/git/pull.ts";
```

```typescript
// ─── git.push ───────────────────────────────────────────────────────
describe("git.push", () => {
	test("rejects remote starting with dash", async () => {
		const result = await gitPush.execute({ remote: "--receive-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("rejects branch starting with dash", async () => {
		const result = await gitPush.execute({ branch: "--force" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("fails on detached HEAD without explicit branch", async () => {
		// Detach HEAD
		const hash = await Bun.$`git -C ${testDir} rev-parse HEAD`.quiet();
		await Bun.$`git -C ${testDir} checkout ${hash.stdout.toString().trim()}`.quiet().nothrow();

		const result = await gitPush.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Could not determine current branch");
	});

	test("declares clearances", () => {
		expect(gitPush.clearance).toContain("git-write");
		expect(gitPush.clearance).toContain("network");
	});
});

// ─── git.pull ───────────────────────────────────────────────────────
describe("git.pull", () => {
	test("rejects remote starting with dash", async () => {
		const result = await gitPull.execute({ remote: "--upload-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("rejects branch starting with dash", async () => {
		const result = await gitPull.execute({ branch: "--recurse-submodules" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares clearances", () => {
		expect(gitPull.clearance).toContain("git-write");
		expect(gitPull.clearance).toContain("network");
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/git-module.test.ts`
Expected: FAIL — flag injection tests fail

**Step 3: Add validation to git tools**

In each file, add import:
```typescript
import { assertSafeArg } from "../validation.ts";
```

**`git/diff.ts`** — after line 48 (`const stat = ...`), add:
```typescript
			if (ref) {
				const refCheck = assertSafeArg(ref, "ref");
				if (refCheck) return refCheck;
			}
```

**`git/log.ts`** — after line 51 (`const path = ...`), add:
```typescript
			if (ref) {
				const refCheck = assertSafeArg(ref, "ref");
				if (refCheck) return refCheck;
			}
```

**`git/branch.ts`** — after line 39 (`const from = ...`), add:
```typescript
		if (name) {
			const nameCheck = assertSafeArg(name, "name");
			if (nameCheck) return nameCheck;
		}
		if (from) {
			const fromCheck = assertSafeArg(from, "from");
			if (fromCheck) return fromCheck;
		}
```

**`git/push.ts`** — after line 40 (`let branch = ...`), add:
```typescript
			const remoteCheck = assertSafeArg(remote, "remote");
			if (remoteCheck) return remoteCheck;
			if (branch) {
				const branchCheck = assertSafeArg(branch, "branch");
				if (branchCheck) return branchCheck;
			}
```

**`git/pull.ts`** — after line 48 (`const autostash = ...`), add:
```typescript
			const remoteCheck = assertSafeArg(remote, "remote");
			if (remoteCheck) return remoteCheck;
			if (branch) {
				const branchCheck = assertSafeArg(branch, "branch");
				if (branchCheck) return branchCheck;
			}
```

**Step 4: Fix git.push silent failure on detached HEAD**

In `git/push.ts`, replace lines 42-51 with:
```typescript
			if (!branch) {
				const branchResult =
					await Bun.$`git -C ${context.workingDirectory} rev-parse --abbrev-ref HEAD`
						.quiet()
						.nothrow();
				if (branchResult.exitCode !== 0 || branchResult.stdout.toString().trim() === "HEAD") {
					return {
						success: false,
						output: "Could not determine current branch. Specify branch explicitly.",
					};
				}
				branch = branchResult.stdout.toString().trim();
			}
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/git-module.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/git/diff.ts src/modules/git/log.ts src/modules/git/branch.ts src/modules/git/push.ts src/modules/git/pull.ts tests/unit/git-module.test.ts
git commit -m "fix(security): add flag injection protection to git tools

Validate refs, branch names, and remote names don't start with '-'.
Fix git.push silent failure on detached HEAD."
```

---

### Task 4: Fix docker command injection and stash index cast

**Files:**
- Modify: `src/modules/docker/run.ts:57-61,105-106`
- Modify: `src/modules/git/stash.ts:79,132`
- Test: `tests/unit/docker-module.test.ts`
- Test: `tests/unit/git-module.test.ts`

**Step 1: Add tests**

In `tests/unit/docker-module.test.ts`, append to `docker.run` describe block:

```typescript
	test("command parameter is type array", () => {
		const cmdParam = dockerRun.parameters.find((p) => p.name === "command");
		expect(cmdParam?.type).toBe("array");
	});
```

In `tests/unit/git-module.test.ts`, append to `git.stash` describe block:

```typescript
	test("rejects non-numeric stash index", async () => {
		const result = await gitStash.execute(
			{ action: "pop", index: "not-a-number" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/docker-module.test.ts tests/unit/git-module.test.ts`
Expected: FAIL

**Step 3: Fix docker/run.ts**

Add import:
```typescript
import { assertSafeArg } from "../validation.ts";  // not needed here actually, skip
```

Change `command` parameter type from `"string"` to `"array"` and update description:

Replace lines 57-61:
```typescript
		{
			name: "command",
			type: "array",
			description: 'Command to run inside the container as array (e.g., ["npm", "start"])',
			required: false,
		},
```

Replace lines 84 and 105-107:
```typescript
			const command = args.command as string[] | undefined;
```

```typescript
			if (command && command.length > 0) {
				cmdParts.push(...command);
			}
```

**Step 4: Fix git/stash.ts**

Add import:
```typescript
import { assertInteger } from "../validation.ts";
```

Replace `const index = (args.index as number) ?? 0;` in both `pop` (line 79) and `drop` (line 132) cases with:

```typescript
					const indexResult = assertInteger(args.index ?? 0, "index");
					if ("success" in indexResult) return indexResult;
					const index = indexResult.value;
```

**Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/docker-module.test.ts tests/unit/git-module.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/docker/run.ts src/modules/git/stash.ts tests/unit/docker-module.test.ts tests/unit/git-module.test.ts
git commit -m "fix(security): fix docker command injection and stash index cast

Change docker.run command param from string to array.
Validate stash index is a non-negative integer."
```

---

### Task 5: Fix timeout race condition (5 files)

**Files:**
- Modify: `src/modules/code-exec/eval.ts:118-119`
- Modify: `src/modules/code-exec/run-file.ts:100-101`
- Modify: `src/modules/docker/build.ts:81-82`
- Modify: `src/modules/docker/run.ts:122-123`
- Modify: `src/modules/filesystem/exec.ts:75-77`

**Step 1: Fix all 5 files**

The fix is identical in all files: swap the order of `clearTimeout` and `await proc.exited`.

In each file, find this pattern:
```typescript
			clearTimeout(timeoutId);
			const exitCode = await proc.exited;
```

Replace with:
```typescript
			const exitCode = await proc.exited;
			clearTimeout(timeoutId);
```

Files and line numbers:
- `code-exec/eval.ts`: lines 118-119
- `code-exec/run-file.ts`: lines 100-101
- `docker/build.ts`: lines 81-82
- `docker/run.ts`: lines 122-123
- `filesystem/exec.ts`: lines 75-77 (line 75 is `clearTimeout`, line 77 is `const exitCode`)

**Step 2: Run existing tests to verify nothing breaks**

Run: `bun test tests/unit/code-exec-module.test.ts tests/unit/docker-module.test.ts tests/unit/filesystem.test.ts`
Expected: PASS — existing tests still pass

**Step 3: Commit**

```bash
git add src/modules/code-exec/eval.ts src/modules/code-exec/run-file.ts src/modules/docker/build.ts src/modules/docker/run.ts src/modules/filesystem/exec.ts
git commit -m "fix: move clearTimeout after proc.exited in all spawn sites

Prevents timeout guard from being cancelled before process exits.
Fixes potential hang when stdout/stderr close before process."
```

---

### Task 6: Fix docker logs stderr, diff truncation, containment result

**Files:**
- Modify: `src/modules/docker/logs.ts:83`
- Modify: `src/modules/git/diff.ts:69-76`
- Modify: `src/modules/code-exec/run-file.ts:57-63`
- Modify: `src/modules/web-fetch/fetch.ts:91-96,125`

**Step 1: Fix docker/logs.ts — merge both streams**

Replace line 83:
```typescript
			const output = stdout.trim() || stderr || "(no logs)";
```

With:
```typescript
			const parts: string[] = [];
			if (stdout.trim()) parts.push(stdout.trim());
			if (stderr) parts.push(stderr);
			const output = parts.join("\n") || "(no logs)";
```

**Step 2: Fix git/diff.ts — trim before truncation marker**

Replace lines 69-76:
```typescript
			let output = result.stdout.toString();
			let truncated = false;
			if (output.length > MAX_OUTPUT_BYTES) {
				output = `${output.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated, ${output.length} total bytes)`;
				truncated = true;
			}

			output = output.trim();
```

With:
```typescript
			let output = result.stdout.toString();
			let truncated = false;
			if (output.length > MAX_OUTPUT_BYTES) {
				const totalBytes = output.length;
				output = `${output.slice(0, MAX_OUTPUT_BYTES).trim()}\n... (truncated, ${totalBytes} total bytes)`;
				truncated = true;
			} else {
				output = output.trim();
			}
```

**Step 3: Fix code-exec/run-file.ts — use containment.resolved**

Replace lines 57-63:
```typescript
		const resolved = resolve(context.workingDirectory, filePath);
		const containment = await assertContained(resolved, context.workingDirectory);
		if (!containment.ok) {
			return { success: false, output: containment.reason };
		}

		const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
```

With:
```typescript
		const resolved = resolve(context.workingDirectory, filePath);
		const containment = await assertContained(resolved, context.workingDirectory);
		if (!containment.ok) {
			return { success: false, output: containment.reason };
		}
		const realPath = containment.resolved;

		const lastDot = realPath.lastIndexOf(".");
		if (lastDot === -1) {
			return { success: false, output: "File has no extension; cannot detect runtime." };
		}
		const ext = realPath.substring(lastDot).toLowerCase();
```

Then replace all subsequent uses of `resolved` with `realPath` (lines 72, 84, 87, 121, 125, 133):
- `await Bun.file(resolved).exists()` → `await Bun.file(realPath).exists()`
- `return { success: false, output: \`File not found: ${resolved}\` }` → `...${realPath}...`
- `const cmd = [...cmdFactory(resolved), ...scriptArgs]` → `...cmdFactory(realPath)...`
- audit detail: `Ran ${resolved}` → `Ran ${realPath}`
- artifacts: `path: resolved` → `path: realPath`

**Step 4: Fix web-fetch/fetch.ts — truncation length**

Replace lines 91-96:
```typescript
		let responseBody = await response.text();
		let truncated = false;
		if (responseBody.length > MAX_BODY_BYTES) {
			responseBody = `${responseBody.slice(0, MAX_BODY_BYTES)}\n... (truncated, ${responseBody.length} total bytes)`;
			truncated = true;
		}
```

With:
```typescript
		const rawBody = await response.text();
		const originalLength = rawBody.length;
		let responseBody = rawBody;
		let truncated = false;
		if (originalLength > MAX_BODY_BYTES) {
			responseBody = `${rawBody.slice(0, MAX_BODY_BYTES)}\n... (truncated, ${originalLength} total chars)`;
			truncated = true;
		}
```

And fix the `contentLength` artifact (line 125) to use `originalLength`:
```typescript
					contentLength: originalLength,
```

**Step 5: Run all tests**

Run: `bun test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/docker/logs.ts src/modules/git/diff.ts src/modules/code-exec/run-file.ts src/modules/web-fetch/fetch.ts
git commit -m "fix: docker logs stderr, diff truncation, containment result, fetch length

- docker.logs: merge stdout and stderr (don't drop stderr)
- git.diff: trim before appending truncation marker
- code.run_file: use containment.resolved realpath, handle no-extension
- web.fetch: report original length in contentLength artifact"
```

---

### Task 7: Convention fixes — satisfies FridayModule and Node.js cleanup

**Files:**
- Modify: `src/modules/code-exec/index.ts:5`
- Modify: `src/modules/docker/index.ts:8`
- Modify: `src/modules/git/index.ts:11`
- Modify: `src/modules/notify/index.ts:4`
- Modify: `src/modules/web-fetch/index.ts:5`
- Modify: `src/modules/filesystem/index.ts:8`
- Modify: `src/modules/code-exec/eval.ts:2,96,156-163`

**Step 1: Change all 6 module index files**

In each file, replace the pattern:
```typescript
const xxxModule: FridayModule = {
```
With:
```typescript
const xxxModule = {
```
And add `satisfies FridayModule` after the closing `}`:
```typescript
} satisfies FridayModule;
```

Specific replacements:

**`code-exec/index.ts`**: `const codeExecModule: FridayModule = {` → `const codeExecModule = {` and `};` → `} satisfies FridayModule;`

**`docker/index.ts`**: `const dockerModule: FridayModule = {` → `const dockerModule = {` and `};` → `} satisfies FridayModule;`

**`git/index.ts`**: `const gitModule: FridayModule = {` → `const gitModule = {` and `};` → `} satisfies FridayModule;`

**`notify/index.ts`**: `const notifyModule: FridayModule = {` → `const notifyModule = {` and `};` → `} satisfies FridayModule;`

**`web-fetch/index.ts`**: `const webFetchModule: FridayModule = {` → `const webFetchModule = {` and `};` → `} satisfies FridayModule;`

**`filesystem/index.ts`**: `const filesystemModule: FridayModule = {` → `const filesystemModule = {` and `};` → `} satisfies FridayModule;`

**Step 2: Clean up Node.js APIs in code-exec/eval.ts**

Remove import on line 2:
```typescript
import { mkdirSync } from "node:fs";
```

Remove `mkdirSync` call on line 96:
```typescript
			mkdirSync(sandboxDir, { recursive: true });
```
(`Bun.write()` on the next line creates parent dirs automatically)

Replace the finally block (lines 156-164):
```typescript
		} finally {
			try {
				const { rmSync } = await import("node:fs");
				rmSync(sandboxDir, { recursive: true, force: true });
			} catch {
				/* best-effort cleanup */
			}
		}
```
With:
```typescript
		} finally {
			try {
				await Bun.$`rm -rf ${sandboxDir}`.quiet().nothrow();
			} catch {
				/* best-effort cleanup */
			}
		}
```

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/modules/code-exec/index.ts src/modules/docker/index.ts src/modules/git/index.ts src/modules/notify/index.ts src/modules/web-fetch/index.ts src/modules/filesystem/index.ts src/modules/code-exec/eval.ts
git commit -m "refactor: use satisfies FridayModule and remove node:fs from eval

Apply satisfies FridayModule convention across all 6 modules.
Replace mkdirSync and rmSync with Bun-idiomatic equivalents."
```

---

### Task 8: Code smell fixes — docker.ps splice and notify.send duplication

**Files:**
- Modify: `src/modules/docker/ps.ts:33-35`
- Modify: `src/modules/notify/send.ts:72-216`

**Step 1: Fix docker/ps.ts — replace splice with push**

Replace lines 33-35:
```typescript
			const cmdParts = ["docker", "ps", "--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"];
			if (all) cmdParts.splice(2, 0, "-a");
			if (filter) cmdParts.splice(2, 0, "--filter", filter);
```

With:
```typescript
			const cmdParts = ["docker", "ps"];
			if (all) cmdParts.push("-a");
			if (filter) cmdParts.push("--filter", filter);
			cmdParts.push("--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}");
```

**Step 2: Fix notify/send.ts — extract helper**

Add `dispatchNotification` helper before `sendWebhook` (before line 218):

```typescript
async function dispatchNotification(
	channel: string,
	webhookUrl: string,
	payload: Record<string, unknown>,
	title: string,
	level: string,
	context: ToolContext,
): Promise<ToolResult> {
	const result = await sendWebhook(webhookUrl, payload);
	if (!result.ok) {
		return {
			success: false,
			output: `${channel} webhook failed: ${result.status} ${result.statusText}`,
		};
	}

	context.audit.log({
		action: "tool:notify.send",
		source: "notify.send",
		detail: `Sent ${channel} notification: ${title}`,
		success: true,
	});

	return {
		success: true,
		output: `${channel} notification sent: ${title}`,
		artifacts: { channel, level, title },
	};
}
```

Then replace each case body's send+audit+return block with a single call:

**Slack case** — replace lines 95-114 with:
```typescript
					return dispatchNotification("Slack", webhookUrl, payload, title, level, context);
```

**Webhook case** — replace lines 136-155 with:
```typescript
					return dispatchNotification("Webhook", webhookUrl, payload, title, level, context);
```

**Email case** — replace lines 177-196 with:
```typescript
					return dispatchNotification("Email", emailWebhookUrl, payload, title, level, context);
```

Note: also remove the `await` before `context.audit.log` — it returns `void`, not `Promise`.

**Step 3: Run tests**

Run: `bun test tests/unit/docker-module.test.ts tests/unit/notify-module.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/modules/docker/ps.ts src/modules/notify/send.ts
git commit -m "refactor: fix docker.ps splice and extract notify dispatch helper

Replace fragile splice() with push() in docker.ps.
Extract dispatchNotification() to eliminate triple duplication in notify.send."
```

---

### Task 9: Add test coverage — path traversal, happy paths, push/pull

**Files:**
- Modify: `tests/unit/code-exec-module.test.ts`
- Modify: `tests/unit/web-fetch-module.test.ts`
- Modify: `tests/unit/notify-module.test.ts`

**Step 1: Add path traversal test to code-exec**

Append to `code.run_file` describe block in `tests/unit/code-exec-module.test.ts`:

```typescript
	test("rejects path traversal outside working directory", async () => {
		const result = await codeRunFile.execute({ path: "../../etc/passwd" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Access denied");
	});

	test("rejects path with no extension", async () => {
		writeFileSync(resolve(testDir, "Makefile"), "all:\n\techo hi\n");
		const result = await codeRunFile.execute({ path: "Makefile" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("no extension");
	});
```

**Step 2: Add happy-path test to web-fetch with local server**

Add to `tests/unit/web-fetch-module.test.ts`:

```typescript
import { afterAll, beforeAll } from "bun:test";

let testServer: ReturnType<typeof Bun.serve>;
let testServerUrl: string;

beforeAll(() => {
	testServer = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/json") {
				return new Response(JSON.stringify({ ok: true, data: "test" }), {
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.pathname === "/large") {
				return new Response("x".repeat(2_000_000));
			}
			return new Response("Hello from test server", {
				headers: { "X-Custom": "friday" },
			});
		},
	});
	testServerUrl = `http://localhost:${testServer.port}`;
});

afterAll(() => {
	testServer.stop();
});
```

Then append to the `web.fetch` describe block:

```typescript
	test("fetches from local server successfully", async () => {
		const result = await webFetch.execute({ url: testServerUrl }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("200");
		expect(result.output).toContain("Hello from test server");
	});

	test("captures response headers", async () => {
		const result = await webFetch.execute({ url: testServerUrl }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("x-custom: friday");
	});

	test("truncates large responses", async () => {
		const result = await webFetch.execute({ url: `${testServerUrl}/large` }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("truncated");
		expect(result.artifacts?.truncated).toBe(true);
	});

	test("detects JSON content type", async () => {
		const result = await webFetch.execute({ url: `${testServerUrl}/json` }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("application/json");
	});
```

**Step 3: Add happy-path test to notify with mock server**

Add to `tests/unit/notify-module.test.ts`:

```typescript
import { afterAll, beforeAll } from "bun:test";

let mockWebhookServer: ReturnType<typeof Bun.serve>;
let mockWebhookUrl: string;

beforeAll(() => {
	mockWebhookServer = Bun.serve({
		port: 0,
		fetch() {
			return new Response("ok", { status: 200 });
		},
	});
	mockWebhookUrl = `http://localhost:${mockWebhookServer.port}`;
});

afterAll(() => {
	mockWebhookServer.stop();
});
```

Then append to the `notify.send` describe block:

```typescript
	test("sends webhook notification successfully", async () => {
		const result = await notifySend.execute(
			{ title: "Test Alert", body: "Something happened", channel: "webhook", url: mockWebhookUrl },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Webhook notification sent");
		expect(result.artifacts?.channel).toBe("webhook");
		expect(result.artifacts?.title).toBe("Test Alert");
	});

	test("sends slack notification successfully", async () => {
		const result = await notifySend.execute(
			{ title: "Slack Test", body: "Hello Slack", channel: "slack", url: mockWebhookUrl },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Slack notification sent");
	});
```

**Step 4: Run all tests**

Run: `bun test`
Expected: PASS — all existing + new tests pass

**Step 5: Commit**

```bash
git add tests/unit/code-exec-module.test.ts tests/unit/web-fetch-module.test.ts tests/unit/notify-module.test.ts
git commit -m "test: add path traversal, happy-path, and push/pull coverage

- code-exec: path traversal rejection, no-extension handling
- web-fetch: local server for fetch, truncation, headers, JSON
- notify: mock webhook server for successful delivery"
```

---

### Task 10: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (should be ~590+ tests)

**Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Verify git status is clean**

Run: `git status`
Expected: Clean working tree, all changes committed
