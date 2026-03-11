# AuditLogChannel Design

**Date:** 2026-03-11
**Status:** Approved

## Problem

`LogChannel` in `src/core/notifications.ts` appends notification lines to a flat file via `appendFile`. It was never wired at boot — dead code with no consumers. Meanwhile, the `AuditLogger` (circular buffer, 10,000 entries, filterable) already exists as Friday's centralized action log.

Notifications from Sensorium, Arc Rhythm, and other producers have no audit trail.

## Solution

Replace `LogChannel` with `AuditLogChannel` that routes notifications into `AuditLogger` instead of a file. Wire it as a default channel at boot alongside `TerminalChannel`.

## Design

### AuditLogChannel class (`src/core/notifications.ts`)

- Implements `NotificationChannel` with `name = "audit"`
- Constructor takes `AuditLogger` via dependency injection
- `send()` calls `audit.log()` with:
  - `action`: `notification:<level>` (e.g. `notification:warning`, `notification:alert`)
  - `source`: passthrough from `FridayNotification.source`
  - `detail`: `"${title}: ${body}"`
  - `success`: always `true`
- Remove `LogChannel` and its `appendFile` import entirely

### Boot wiring (`src/core/runtime.ts`)

Default channels change from `[new TerminalChannel()]` to `[new TerminalChannel(), new AuditLogChannel(this._audit)]`. `_audit` is created on the line immediately before `_notifications`, so the dependency is available.

### Audit entry format

```
action:    "notification:warning"
source:    "sensorium"
detail:    "Memory High: Memory usage at 92% (14.7GB/16.0GB)"
success:   true
timestamp: (auto-added by AuditLogger)
```

Queryable via `audit.entries({ action: "notification:alert" })`.

## Changes

| File | Change |
|---|---|
| `src/core/notifications.ts` | Delete `LogChannel`, add `AuditLogChannel`, remove `appendFile` import |
| `src/core/runtime.ts` | Import `AuditLogChannel`, add to default channels array |
| `tests/unit/notifications.test.ts` | Replace `LogChannel` tests with `AuditLogChannel` tests |
| `docs/plans/2026-02-27-inference-payload-logging-design.md` | Update `LogChannel` reference |
