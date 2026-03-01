# Protocol Clearance Enforcement Design

**Date:** 2026-03-01
**Status:** Approved

## Problem

Protocols (`/commands`) declare a `clearance` field on `FridayProtocol`, but this field is never checked at execution time. Two call sites bypass clearance:

1. **`runtime.process()`** — user-initiated `/commands` call `protocol.execute()` directly with no clearance gate.
2. **Directive `onDirectiveAction` handler** — `type: "protocol"` and `type: "tool"` dispatch to targets without checking the target's own clearance (only the directive's clearance is checked by DirectiveEngine).

All other execution paths enforce clearance: Cortex tools (cortex.ts:244), DirectiveEngine (engine.ts:95), Arc Rhythm executor (executor.ts:43), and Vox (vox.ts:80).

## Approach

**Inline checks** at the two call sites in `runtime.ts`, matching the existing Cortex pattern. No new abstractions — simple, auditable, consistent.

## Changes

### 1. `runtime.process()` (~line 504)

After resolving the protocol but before calling `execute()`, add a clearance check:

```ts
if (protocol.clearance.length > 0) {
    const check = this._clearance.checkAll(protocol.clearance);
    if (!check.granted) {
        this._audit.log({
            action: "protocol:blocked",
            source: protocol.name,
            detail: check.reason ?? `Clearance denied for protocol: ${protocol.name}`,
            success: false,
        });
        return { output: check.reason ?? `Clearance denied for protocol: ${protocol.name}`, source: "protocol" };
    }
}
```

### 2. Directive `onDirectiveAction` handler

Two `case` blocks in the `onDirectiveAction` callback need clearance checks on the target:

- **`case "protocol":`** — After resolving `protocol`, check `protocol.clearance` against `this._clearance`. If denied, audit as `protocol:blocked` and `break`.
- **`case "tool":`** — After resolving `tool`, check `tool.clearance` against `this._clearance`. If denied, audit as `tool:blocked` and `break`.

### 3. Tests

New test file `tests/unit/protocol-clearance.test.ts`:

1. Protocol with non-empty clearance is blocked when clearance not granted → returns denial message
2. Protocol with non-empty clearance executes when clearance is granted
3. Protocol with empty clearance always executes
4. Directive dispatching a protocol is blocked when target protocol's clearance is denied
5. Directive dispatching a tool is blocked when target tool's clearance is denied
6. Audit entries are logged for blocked protocols

### 4. No changes needed

- `ProtocolRegistry` — stays a pure lookup
- `ClearanceManager` — already has the needed API
- Protocol definitions — their `clearance` arrays are already correct

## Affected Protocols

| Protocol | Clearance | Impact |
|----------|-----------|--------|
| `/gmail` | `["network"]` | Now enforced |
| `/smart` | `["read-fs"]` | Now enforced |
| `/history` | `[]` | No change |
| `/env` | `[]` | No change |
| `/voice` | `[]` | No change |
| `/arc` | `[]` | No change |
