# GENESIS.md — Friday's Identity Prompt Design

**Date:** 2026-02-25
**Status:** Approved
**MCU Mapping:** Genesis = origin template, the foundational identity only the BOSS can modify

## Problem

Friday's entire personality and behavioral directives are hardcoded in `src/core/prompts.ts` as a TypeScript string constant (`SYSTEM_PROMPT`). This has three issues:

1. **Friday can self-modify** — The Forge or filesystem tools could theoretically alter the source file
2. **No filesystem protection** — Any process or user with repo access can read/edit the prompt
3. **Casually visible** — The prompt ships in the repo, visible on GitHub and to anyone browsing the codebase

## Solution

Extract the identity prompt into `~/.friday/GENESIS.md` — a protected Markdown file outside the repo that only the BOSS can edit.

## File Location

- **Default path:** `~/.friday/GENESIS.md`
- **Override:** `FRIDAY_GENESIS_PATH` environment variable (Bun auto-loads from `.env`)
- **Directory permissions:** `0o700` (owner-only)
- **File permissions:** `0o600` (owner read/write only)

```
~/.friday/
└── GENESIS.md          # Friday's identity prompt (chmod 600)
```

## Boot-Time Loading

In `FridayRuntime.boot()`, before Cortex creation:

1. Resolve Genesis path: `process.env.FRIDAY_GENESIS_PATH ?? ~/.friday/GENESIS.md`
2. Read file via `Bun.file(path).text()`
3. Pass content into `Cortex` via new `CortexConfig.genesisPrompt` field
4. `Cortex.buildSystemPrompt()` uses `this.genesisPrompt` instead of imported `SYSTEM_PROMPT`

If the file is missing or unreadable, boot **fails hard** with a clear error. No silent fallback — Genesis is non-optional.

**Boot order:**
```
SignalBus → Clearance → Audit → Notifications → Protocols → Directives
→ [Load GENESIS.md] → Memory → SMARTS → Sensorium → Cortex → ...
```

## Protection Layer A: Friday Can't Self-Modify

### Path Blocklist (filesystem module)

New `isProtectedPath()` function in `src/modules/filesystem/containment.ts`. The Genesis path is blocklisted. `fs.write`, `fs.delete`, and `bash.exec` check against it. Any write attempt returns: `"Access denied: GENESIS.md is BOSS-only"`.

### Forge Rejection

`forge_apply` gets an additional check: if any proposed file's resolved path matches or contains the Genesis path, the proposal is rejected.

### Audit Trail

Any denied write attempt is logged with action `genesis:write-denied` for visibility.

## Protection Layer B: Filesystem Permissions

On first-run seed and every boot (health check):

```typescript
await mkdir(genesisDir, { recursive: true, mode: 0o700 });
await chmod(genesisPath, 0o600);
```

Standard Unix security — other user accounts cannot read or write the file.

## Protection Layer C: Not Casually Visible

- `~/.friday/` is outside the repo — never committed, never pushed
- `SYSTEM_PROMPT` in `src/core/prompts.ts` becomes `GENESIS_TEMPLATE` — a seed template only used by `friday genesis init`
- No `.gitignore` changes needed (already outside repo)

## CLI Command: `friday genesis`

| Subcommand | Description |
|---|---|
| `friday genesis edit` | Opens `$EDITOR` (or `vi`) on `~/.friday/GENESIS.md` |
| `friday genesis show` | Prints current Genesis content to stdout |
| `friday genesis path` | Prints the resolved file path |
| `friday genesis init` | Seeds from built-in template (won't overwrite existing) |
| `friday genesis check` | Validates file exists, permissions correct, content non-empty |

No `write` or `set` subcommand — editing is always through `$EDITOR` for intentional friction.

## Changes to `src/core/prompts.ts`

`SYSTEM_PROMPT` is renamed to `GENESIS_TEMPLATE`. It remains in TypeScript as the seed template used by `friday genesis init` and the existing test suite. No longer loaded at runtime.

## New Files

```
src/core/genesis.ts          # loadGenesis(), seedGenesis(), checkGenesis(), GENESIS_DEFAULT_PATH
src/cli/commands/genesis.ts  # CLI command registration
```

## Modified Files

| File | Change |
|---|---|
| `src/core/cortex.ts` | Add `CortexConfig.genesisPrompt`, use in `buildSystemPrompt()` |
| `src/core/runtime.ts` | Add `RuntimeConfig.genesisPath`, load Genesis in `boot()` |
| `src/modules/filesystem/containment.ts` | Add `isProtectedPath()` check |
| `src/modules/filesystem/write.ts` | Genesis path rejection before write |
| `src/modules/forge/apply.ts` | Genesis path rejection for proposals |
| `src/cli/index.ts` | Register genesis command |
| `src/core/prompts.ts` | Rename `SYSTEM_PROMPT` → `GENESIS_TEMPLATE` |

## Testing

- `Cortex` receives `genesisPrompt` via config, uses it in `buildSystemPrompt()`
- `containment.ts` rejects writes to the Genesis path
- `forge_apply` rejects proposals targeting the Genesis path
- Boot fails when Genesis file is missing/unreadable
- `friday genesis init` seeds the file correctly
- `friday genesis check` validates permissions
- `fs.write` tool with Genesis path argument returns access denied
