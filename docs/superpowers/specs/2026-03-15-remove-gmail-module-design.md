# Remove Gmail Module

**Date**: 2026-03-15
**Status**: Approved
**Purpose**: Remove the Gmail module and all references to clear the way for Twilio-based communication channels.

## Scope

### Delete entirely (19 files)

**Source** — `src/modules/gmail/` directory:
- `index.ts`, `auth.ts`, `client.ts`, `state.ts`, `types.ts`, `protocol.ts`
- `tools/search.ts`, `tools/read.ts`, `tools/send.ts`, `tools/reply.ts`, `tools/modify.ts`, `tools/labels.ts`

**Tests** — 7 files:
- `tests/unit/gmail-auth.test.ts`
- `tests/unit/gmail-client.test.ts`
- `tests/unit/gmail-module.test.ts`
- `tests/unit/gmail-protocol.test.ts`
- `tests/unit/gmail-tools-read.test.ts`
- `tests/unit/gmail-tools-write.test.ts`
- `tests/unit/module-context-gmail.test.ts`

**Guide**:
- `docs/guides/gmail-setup.md`

### Edit (6 files)

1. `src/core/clearance.ts` — remove `"email-send"` from `ClearanceName` union
2. `.env.example` — remove Gmail OAuth section (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
3. `package.json` — remove `googleapis` dependency
4. `CLAUDE.md` — remove Gmail from architecture tree, module list (8→7), env vars, patterns
5. `README.md` — remove Gmail from module table, protocol commands, env vars, architecture diagram
6. `MEMORY.md` — remove Gmail Module section, update module count

### Edit (test files with incidental references)

1. `tests/unit/tui-thinking.test.ts` — change `"gmail.search"` to another tool name (e.g., `"fs.read"`)
2. `tests/unit/clearance.test.ts` — remove `"email-send"` test cases

### Preserve (historical design docs)

Design docs in `docs/superpowers/specs/` stay as historical snapshots per project convention.
`ModuleContext` spec/plan stays — it's about the interface, not Gmail.

### Post-removal

- Remove `googleapis` from lockfile: `bun install`
- Verify: `bun test`, `bun run typecheck`, `bun run lint`

## What stays

- `SecretStore` (`src/core/secrets.ts`) — used by other systems
- `ModuleContext` / `onLoad(context)` — general infrastructure
- `ModuleContext` tests (`tests/unit/module-context.test.ts`) — tests the interface, not Gmail
