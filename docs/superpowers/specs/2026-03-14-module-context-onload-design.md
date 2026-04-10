# ModuleContext for onLoad() — Persistent Module Storage

**Date**: 2026-03-14
**Status**: Approved
**Problem**: Gmail OAuth tokens lost on every restart — requires `/gmail auth` each boot

## Background

`FridayModule.onLoad()` takes zero arguments. The Gmail module needs `ScopedMemory` to persist encrypted OAuth tokens via `SecretStore`, but works around the missing context with an ephemeral `Map`. Tokens vanish on restart. There is an existing TODO in `src/modules/gmail/index.ts` acknowledging this gap.

The runtime already provides `ScopedMemory` to tools (via `ToolContext`), protocols (via `ProtocolContext`), and directives — but not to module lifecycle hooks.

## Design

### New type: `ModuleContext`

Add to `src/modules/types.ts`:

```typescript
export interface ModuleContext {
  memory: ScopedMemory;
}
```

Deliberately minimal. Can grow later (audit, signals, notifications) without breaking anything.

### Interface change: `FridayModule.onLoad()`

```typescript
// Before:
onLoad?(): Promise<void>;

// After:
onLoad?(context: ModuleContext): Promise<void>;
```

**Backward compatible at the module level**: JavaScript functions silently ignore extra arguments. Existing modules with zero-arg `onLoad()` continue to work unchanged — TypeScript allows a function accepting fewer params to be assigned to a function type expecting more params. The two call sites in `runtime.ts` **must** be updated to pass the context argument (TypeScript will error until they do). No new imports needed in `types.ts` — `ScopedMemory` is already imported there for `ToolContext`.

### Runtime wiring

In `src/core/runtime.ts`, two call sites (core modules ~line 458, Forge modules ~line 482) change from:

```typescript
await mod.onLoad();
```

to:

```typescript
await mod.onLoad({
  memory: this._memory?.scoped(mod.name) ?? {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  },
});
```

Each module gets its own SQLite KV namespace keyed by `mod.name` (e.g., `"gmail"`, `"filesystem"`). This follows the existing pattern used for tools (`this._memory?.scoped("tools")`), directives (`scoped("directive")`), and Arc Rhythm (`scoped("arc-rhythm")`).

**Null-object fallback**: When `this._memory` is undefined (no `dataDir` at boot), the no-op fallback silently degrades to ephemeral behavior — the same as today's `Map` workaround. This is acceptable: `dataDir` is always set in normal operation. The fallback matches the existing pattern used for directives and protocols.

### Gmail module update

In `src/modules/gmail/index.ts`, replace the ephemeral `Map` workaround (lines 43-58) with:

```typescript
async onLoad(context) {
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
    console.log("[Gmail] Not authenticated. Run /gmail auth to set up.");
  }
},
```

This removes ~15 lines of `Map` boilerplate and the TODO comment. Encrypted token blobs now persist in SQLite's `kv` table under namespace `"gmail"`, surviving restarts.

### Forge template update

In `src/modules/forge/propose.ts`, update `generateModuleTemplate()`:

1. Add `ModuleContext` to the template's import line:
   ```typescript
   import type { FridayModule, FridayTool, ToolContext, ToolResult, ModuleContext } from "../../src/modules/types.ts";
   ```

2. Add a commented `onLoad` example after the existing tool example:
   ```typescript
   // Optional lifecycle hook with persistent storage:
   //
   // async onLoad(context: ModuleContext) {
   //   const saved = await context.memory.get<string>("my-key");
   //   await context.memory.set("my-key", "my-value");
   // },
   ```

The generated module itself does not define `onLoad()` (unchanged).

### Documentation updates

| File | Change |
|------|--------|
| `CLAUDE.md` | Note `ModuleContext` in module pattern description, update `FridayModule` interface notes |
| `README.md` | Update module anatomy diagram label, update example `onLoad(context)` signature |

Design docs in `docs/superpowers/specs/` are historical snapshots — left as-is.

## What does NOT change

- `onUnload()` — stays zero-arg (no persistence needed during teardown)
- Existing Forge-generated modules — none define `onLoad()`
- Existing core modules (filesystem, git, docker, code-exec, web-fetch, notify, forge) — none define `onLoad()`; only Gmail does
- `ToolContext`, `ProtocolContext` — untouched
- `SecretStore`, `GmailAuth`, `GmailClient` — no API changes, just different `ScopedMemory` backing

## Files to modify

1. `src/modules/types.ts` — add `ModuleContext`, update `onLoad` signature
2. `src/core/runtime.ts` — pass `ModuleContext` at both module loading sites
3. `src/modules/gmail/index.ts` — use `context.memory` instead of ephemeral `Map`
4. `src/modules/forge/propose.ts` — update template comments
5. `CLAUDE.md` — document `ModuleContext`
6. `README.md` — update module example and anatomy

## Testing

- Existing Gmail tests should continue to pass (they mock at the `GmailAuth`/`GmailClient` level)
- Existing module loader tests should continue to pass (they test discovery/validation, not `onLoad` args)
- Add a test verifying that `onLoad` receives a `ModuleContext` with working `ScopedMemory` (roundtrip set/get)
- Verify backward compatibility: a module with zero-arg `onLoad()` still loads without error
- Test null-object fallback: boot without `dataDir`, module with `onLoad` defined — should not throw
- Test Gmail token roundtrip: `SecretStore` backed by real `ScopedMemory` can encrypt, persist, and decrypt tokens across two separate `loadTokens()` calls (proves the core fix works)
