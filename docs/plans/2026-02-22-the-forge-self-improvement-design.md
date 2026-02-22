# The Forge — Friday Self-Improvement System

**Date**: 2026-02-22
**Status**: Approved
**MCU Codename**: The Forge (where new suit upgrades are built)

## Overview

The Forge is a Friday module that enables self-improvement — Friday can author new modules and patch existing ones she's written, subject to human approval. It follows the existing `FridayModule` contract and extends Friday through the same tool/protocol system everything else uses.

The core principle: **Friday can extend herself, but cannot modify her foundations.** She can create new capabilities and fix her own creations, but the runtime core and human-authored modules are off-limits.

## Architecture

### Directory Structure

```
src/modules/forge/            # The Forge module itself (human-authored, protected)
├── index.ts                  # FridayModule manifest
├── propose.ts                # forge_propose tool — generate/patch module code
├── apply.ts                  # forge_apply tool — write approved code to disk
├── validate.ts               # forge_validate tool — typecheck + lint + import test
├── restart.ts                # forge_restart tool — trigger graceful self-restart
├── status.ts                 # forge_status tool — list forge modules + health
├── protocol.ts               # /forge protocol (list, status, history, rollback, protect)
├── manifest.ts               # ForgeManifest — read/write manifest.json
└── types.ts                  # ForgeEntry, ForgeProposal, ForgeValidationResult

forge/                        # Friday-authored modules (separate dir, gitignored)
├── manifest.json             # Tracks all forge modules with version history
├── <module-name>/            # Each module in its own directory
│   └── index.ts              # Exports FridayModule (same contract as all modules)
└── .backups/                 # Rollback snapshots before patches
    └── <module-name>-v<N>/
```

### Key Relationships

- The Forge module is **human-authored** and lives in `src/modules/forge/` (core-protected).
- Forge-created modules live in `forge/` (separate directory, gitignored by default).
- The **filesystem module is core-protected** — Friday cannot modify it. The Forge depends on it for file operations.
- The Forge itself is core-protected — if it can't load, Friday can't self-improve.

## Tools

### forge_propose

Generates code for a new module or a patch to an existing forge module. Returns proposed code as a preview — does NOT write to disk.

- **Inputs**: `action` ("create" | "patch"), `moduleName`, `description`, `targetFile` (for patches)
- **Output**: Generated source code shown as preview, plus a `proposalId` stored in scoped memory
- **Clearance**: `["provider"]`

Friday uses her own Cortex to reason about what code to write, then returns it for human review. The proposal is stored in the Forge's scoped memory so `forge_apply` can reference it later.

### forge_apply

After the user approves a proposal, writes the code to disk.

- **Inputs**: `proposalId`
- **Output**: Confirmation of files written + paths
- **Clearance**: `["write-fs", "forge-modify"]`

Before writing a patch, copies the current version to `.backups/` for rollback. Updates `forge/manifest.json` with the new/updated module entry.

### forge_validate

Runs the validation pipeline on a forge module before restart.

- **Inputs**: `moduleName`
- **Output**: Pass/fail with detailed errors
- **Clearance**: `["exec-shell"]`

Validation steps in order:
1. **Import test** — can Bun dynamically import the module without errors?
2. **Manifest check** — does it export a valid `FridayModule`?
3. **Typecheck** — `bunx tsc --noEmit` scoped to the module files
4. **Lint** — `bun run lint` scoped to the module directory

Stores a validation receipt in scoped memory on success. `forge_restart` checks for this receipt.

### forge_restart

Triggers a graceful self-restart to load new/patched modules.

- **Inputs**: `reason` (string describing why)
- **Output**: Confirmation that restart is initiating
- **Clearance**: `["system", "forge-modify"]`

Sets `runtime.restartRequested = true`. The REPL loop in `chat.ts` detects this flag, calls `shutdown()`, then calls `boot()` again with the same config. Conversation history is persisted and restored automatically.

### forge_status

Lists all forge-authored modules and their health.

- **Inputs**: none (or optional `moduleName` for detail)
- **Output**: Table of modules with name, version, status (loaded/failed/pending), last modified
- **Clearance**: `["read-fs"]`

## Graceful Self-Restart

### In-Process Restart (Recommended Approach)

Instead of killing the process and re-launching, Friday re-cycles her subsystems within the same Bun process:

```
forge_restart sets runtime.restartRequested = true
  → REPL loop in chat.ts detects the flag after process() returns
  → Calls runtime.shutdown():
      1. Stop Sensorium polling
      2. Save conversation history to SQLite
      3. SmartsCurator extracts knowledge
      4. Unload all modules (onUnload hooks)
      5. Close databases
  → Calls runtime.boot() with the same config:
      1. Re-initializes all subsystems
      2. Loads modules (with fault isolation)
      3. Restores conversation from last session
      4. Injects restart context into system prompt
  → Friday picks up where she left off
```

The runtime already supports `shutdown()` → `boot()` cycling (runtime.ts line 97: `if (this._booted) await this.shutdown()`).

### Crash Recovery: --resume Flag

For hard crashes (uncaught exceptions, OOM), the user can manually run `bun run start --resume` to restore the last saved session. This uses the existing conversation history persistence — no new infrastructure needed.

## Fault-Isolated Module Loading

### Boot-Time Load Order

```
1. [PROTECTED]  src/modules/filesystem/    — always first, boot fails if broken
2. [PROTECTED]  src/modules/forge/         — always second, boot fails if broken
3. [STANDARD]   src/modules/*/             — other human-authored modules, warn on failure
4. [FORGE]      forge/*/                   — fault-isolated, errors captured and reported
```

### ForgeHealthReport

```typescript
interface ForgeHealthReport {
  loaded: string[];
  failed: {
    name: string;
    error: string;
    lastWorkingVersion?: string;
  }[];
  pending: string[];
}
```

When forge modules fail to load, the health report is injected into the Cortex system prompt:

```
⚠ FORGE MODULE FAILURES:
- weather v1.2: ImportError — Cannot find module './api-client.ts'
  Last working: v1.1

You wrote these modules. Review the errors and use forge_propose to fix them.
```

Friday sees the errors, reasons about them, and can propose fixes — all without the core runtime being affected. She functions fully with Cortex, Memory, Signals, filesystem, and the Forge itself.

## /forge Protocol

Direct CLI access for human oversight — bypasses the LLM:

| Command | Description |
|---------|-------------|
| `/forge list` | Show all forge modules with status |
| `/forge status <name>` | Detailed health of a specific module |
| `/forge history <name>` | Version history from manifest |
| `/forge rollback <name>` | Restore from `.backups/` + trigger restart |
| `/forge protect <name>` | Mark a forge module as protected (immutable by Friday) |
| `/forge unprotect <name>` | Remove protection |
| `/forge manifest` | Dump raw manifest.json |

`/forge rollback` is the human escape hatch. `/forge protect` promotes a trusted forge module to protected status.

## Manifest

```json
{
  "version": 1,
  "modules": {
    "weather": {
      "description": "Weather lookups via OpenWeatherMap API",
      "version": "1.2.0",
      "created": "2026-02-22T10:30:00Z",
      "lastModified": "2026-02-22T11:45:00Z",
      "status": "loaded",
      "protected": false,
      "history": [
        {
          "version": "1.0.0",
          "date": "2026-02-22T10:30:00Z",
          "action": "created",
          "reason": "User requested weather capability"
        }
      ]
    }
  }
}
```

Every create/patch/rollback is recorded in the history array.

## New Clearance: forge-modify

```typescript
export type ClearanceName =
  | "read-fs" | "write-fs" | "delete-fs"
  | "exec-shell" | "network"
  | "git-read" | "git-write"
  | "provider" | "system"
  | "forge-modify";
```

Separates "can write files" from "can modify Friday's own modules." Granted at boot, can be revoked to disable self-improvement without affecting other operations.

## Security Boundaries

### Hard Constraints (Enforced in Code)

| Constraint | Enforcement |
|------------|-------------|
| Cannot modify `src/` directory | `forge_apply` rejects any path outside `forge/` |
| Cannot modify core-protected modules | Forge checks `manifest.protected` flag |
| Cannot restart without validation | `forge_restart` checks for validation receipt in scoped memory |
| Cannot skip user approval | `forge_apply` requires a `proposalId` from `forge_propose` |
| Cannot write arbitrary files | Path containment: resolve + realpath + prefix check on `forge/<moduleName>/` |
| Cannot delete modules | No delete tool. User-only via `/forge rollback` or manual deletion |

### Path Containment

Every file write in `forge_apply`:
1. Resolve the target path
2. Resolve symlinks via `realpath()`
3. Assert resolved path starts with `<forgeDir>/<moduleName>/`
4. Reject if containment check fails

Mirrors existing symlink protection in `discoverModules()` (src/modules/loader.ts:33-36).

### Approval Gate

The chat conversation IS the approval mechanism:
1. `forge_propose` generates code, returns it as a tool result
2. Cortex presents it to the user in conversation
3. User sees full code and says "yes" or requests changes
4. Only then does Friday call `forge_apply` with the `proposalId`

### Audit Trail

Every Forge action logs through the existing AuditLogger:
- `forge:propose` — what was proposed
- `forge:apply` — what was written and where
- `forge:validate` — pass/fail with details
- `forge:restart` — reason and timestamp
- `forge:rollback` — what was restored (via protocol)

## Changes to Existing Code

| File | Change |
|------|--------|
| `src/core/clearance.ts` | Add `"forge-modify"` to `ClearanceName` union |
| `src/core/runtime.ts` | Add `restartRequested` flag, forge module directory config, fault-isolated forge module loading, inject health report into Cortex |
| `src/modules/loader.ts` | Add `discoverForgeModules()` returning `{ loaded, failed }` |
| `src/cli/commands/chat.ts` | REPL loop checks `restartRequested`, cycles shutdown/boot |
| `CLAUDE.md` | Document The Forge architecture |
| `README.md` | Document The Forge as a feature |
| `.gitignore` | Add `forge/` directory |

No changes to Cortex, SignalBus, Memory, or other core subsystems.

## Example Flow

```
User: "Can you send me a Slack message when tests fail?"

Friday: "I don't have Slack integration, but I can build one. Want me to forge a module?"
User: "Yeah, go for it."

Friday → forge_propose(create, "slack-notify", "Slack Web API notifications on signals")
  → Shows proposed code to user

User: "Ship it"

Friday → forge_apply("abc-123")       → Writes to forge/slack-notify/
Friday → forge_validate("slack-notify") → Import ✓, Manifest ✓, Types ✓, Lint ✓
Friday → forge_restart("Load slack-notify module")
  → shutdown() → boot() → module loads
  → "I'm back. slack-notify is loaded. Want me to wire it to test:failed signals?"
```
