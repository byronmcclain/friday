# Module Remediation Design

**Date:** 2026-02-22
**Scope:** 5 new modules (code-exec, docker, git, notify, web-fetch) + pre-existing filesystem module
**Issues:** 18 from code review — security, bugs, conventions, code smells, test gaps

## Approach

Single-pass grouped by fix type rather than module-by-module. Ensures consistency across all modules and avoids re-visiting the same pattern in multiple passes.

## Group 1: Input Validation Foundation

Create `src/modules/validation.ts` with three focused validator functions:

- `assertSafeArg(value: string, label: string): ToolResult | null` — rejects values starting with `-` to prevent flag injection in CLI tools. Returns `null` if safe, `ToolResult` if rejected.
- `assertAllowedProtocol(url: string): ToolResult | null` — allowlists `http:` and `https:` protocols only to prevent SSRF (`file:`, `data:`, `ftp:` etc). Returns `null` if safe, `ToolResult` if rejected.
- `assertInteger(value: unknown, label: string): { value: number } | ToolResult` — validates and coerces to a safe non-negative integer. Prevents type confusion from `as number` casts on LLM-provided args.

Design principle: each returns `null` or `{ value }` on success, or a `ToolResult` on rejection, so callers can early-return cleanly with `const check = assertX(...); if (check) return check;`.

## Group 2: Security Fixes

### SSRF Prevention (web-fetch, notify)
- `web-fetch/fetch.ts`: Add `assertAllowedProtocol()` after `new URL(url)` parsing
- `notify/send.ts`: Add `assertAllowedProtocol()` for resolved webhook URLs in all three channels

### Git Flag Injection (all git tools)
- Apply `assertSafeArg()` to user-supplied positional args: `ref` (diff, log), `name`/`from` (branch), `remote`/`branch` (pull, push), `message` is safe (always after a `"-m"` flag)

### Docker Command Injection
- `docker/run.ts`: Change `command` parameter type from `"string"` to `"array"`, consume directly without `.split(" ")`

### Stash Index Type Confusion
- `git/stash.ts`: Replace `args.index as number` with `assertInteger()` validation

## Group 3: Bug Fixes

### Timeout Race (5 files)
Move `clearTimeout(timeoutId)` after `await proc.exited` in:
- `src/modules/code-exec/eval.ts`
- `src/modules/code-exec/run-file.ts`
- `src/modules/docker/build.ts`
- `src/modules/docker/run.ts`
- `src/modules/filesystem/exec.ts` (pre-existing)

### Docker Logs Stderr Dropped
- `docker/logs.ts`: Replace `stdout.trim() || stderr` with `parts.push()` pattern merging both streams (consistent with `docker/run.ts`)

### Git Push Silent Failure
- `git/push.ts`: Return `{ success: false }` when `rev-parse --abbrev-ref HEAD` fails instead of silently proceeding

### Truncation Bugs
- `web-fetch/fetch.ts`: Capture original length before mutation; report correct `contentLength` in artifacts
- `git/diff.ts`: Apply `.trim()` before appending truncation marker, not after

### Containment Result Discarded
- `code-exec/run-file.ts`: Use `containment.resolved` (the realpath) for all subsequent operations instead of the pre-canonicalized `resolved`

## Group 4: Convention Fixes

### `satisfies FridayModule` (6 files)
Change `: FridayModule` to `satisfies FridayModule` in:
- `src/modules/code-exec/index.ts`
- `src/modules/docker/index.ts`
- `src/modules/git/index.ts`
- `src/modules/notify/index.ts`
- `src/modules/web-fetch/index.ts`
- `src/modules/filesystem/index.ts` (pre-existing)

### Node.js API Cleanup (code-exec/eval.ts)
- Remove `import { mkdirSync } from "node:fs"` — `Bun.write()` auto-creates parent dirs
- Replace dynamic `import("node:fs")` rmSync in finally block with `Bun.$`

## Group 5: Code Smells

### Docker PS Fragile Splice
- `docker/ps.ts`: Replace `splice(2, 0, ...)` with `.push()`, move `--format` to end of array construction

### Notify Send Duplication
- `notify/send.ts`: Extract `dispatchNotification()` helper to eliminate triple-duplicated case bodies (~30 lines each)

## Group 6: Test Coverage

### Path Traversal Test
- `code-exec-module.test.ts`: Add test for `../../etc/passwd` rejection via `assertContained`

### Happy-Path Tests
- `notify-module.test.ts`: Mock `fetch` via `mock.module` to test successful delivery path
- `web-fetch-module.test.ts`: Spin up local `Bun.serve()` test server to test fetch, truncation, and header capture

### Pull/Push Error Tests
- `git-module.test.ts`: Add tests for push/pull to non-existent remote (error paths)

## Out of Scope

- `git.pull` autostash default change — behavior change, separate decision
- `web.search` scraping quality — feature enhancement, not a fix
- Pre-commit signal blocking semantics — architectural decision about SignalBus design
- `git.pull`/`git.push` full network test coverage — would need remote stubs

## File Summary

| Action | Count | Files |
|--------|-------|-------|
| New | 1 | `src/modules/validation.ts` |
| Edit | ~23 | All tool files + index files + test files across 6 modules |
