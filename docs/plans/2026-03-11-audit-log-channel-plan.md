# AuditLogChannel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dead-code `LogChannel` with an `AuditLogChannel` that routes notifications through the `AuditLogger`, wired as a default channel at boot.

**Architecture:** New `AuditLogChannel` class in `notifications.ts` takes `AuditLogger` via constructor, maps `FridayNotification` fields to `AuditEntry`, and is instantiated alongside `TerminalChannel` in `FridayRuntime.boot()`.

**Tech Stack:** TypeScript, bun:test, AuditLogger circular buffer

---

### Task 1: Replace LogChannel with AuditLogChannel (test first)

**Files:**
- Modify: `tests/unit/notifications.test.ts`
- Modify: `src/core/notifications.ts`

**Step 1: Write the failing test**

Replace the `LogChannel` describe block (lines 76-81) in `tests/unit/notifications.test.ts` with:

```ts
describe("AuditLogChannel", () => {
  test("has name 'audit'", () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    expect(channel.name).toBe("audit");
  });

  test("send() logs notification as audit entry", async () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    await channel.send({
      level: "warning",
      title: "Memory High",
      body: "Memory usage at 92%",
      source: "sensorium",
    });

    const entries = audit.entries({ action: "notification:warning" });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("notification:warning");
    expect(entries[0].source).toBe("sensorium");
    expect(entries[0].detail).toBe("Memory High: Memory usage at 92%");
    expect(entries[0].success).toBe(true);
  });

  test("send() maps alert level to action string", async () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    await channel.send({
      level: "alert",
      title: "Container Down",
      body: "nginx is not running",
      source: "sensorium",
    });

    const entries = audit.entries({ action: "notification:alert" });
    expect(entries).toHaveLength(1);
  });
});
```

Update imports at the top of the file:
- Remove `LogChannel` from the import
- Add `AuditLogChannel` to the import
- Add `import { AuditLogger } from "../../src/audit/logger.ts";`

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/notifications.test.ts`
Expected: FAIL — `AuditLogChannel` is not exported from `notifications.ts`

**Step 3: Implement AuditLogChannel in `src/core/notifications.ts`**

Remove the `appendFile` import from line 2:
```ts
// DELETE: import { appendFile } from "node:fs/promises";
```

Add import for AuditLogger at the top:
```ts
import type { AuditLogger } from "../audit/logger.ts";
```

Delete `LogChannel` class (lines 73-85). Replace with:

```ts
export class AuditLogChannel implements NotificationChannel {
  name = "audit";
  private audit: AuditLogger;

  constructor(audit: AuditLogger) {
    this.audit = audit;
  }

  async send(notification: FridayNotification): Promise<void> {
    this.audit.log({
      action: `notification:${notification.level}`,
      source: notification.source,
      detail: `${notification.title}: ${notification.body}`,
      success: true,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/notifications.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/notifications.ts tests/unit/notifications.test.ts
git commit -m "refactor: replace LogChannel with AuditLogChannel for notification audit trail"
```

---

### Task 2: Wire AuditLogChannel at boot

**Files:**
- Modify: `src/core/runtime.ts`

**Step 1: Update import**

Change line 11 from:
```ts
import { NotificationManager, TerminalChannel, type NotificationChannel } from "./notifications.ts";
```
to:
```ts
import { NotificationManager, TerminalChannel, AuditLogChannel, type NotificationChannel } from "./notifications.ts";
```

**Step 2: Add AuditLogChannel to default channels**

Change line 195 from:
```ts
this._notifications = new NotificationManager(config.channels ?? [new TerminalChannel()]);
```
to:
```ts
this._notifications = new NotificationManager(config.channels ?? [new TerminalChannel(), new AuditLogChannel(this._audit)]);
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS — no existing tests depend on the exact set of default channels

**Step 4: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: wire AuditLogChannel as default notification channel at boot"
```

---

### Task 3: Update documentation reference

**Files:**
- Modify: `docs/plans/2026-02-27-inference-payload-logging-design.md`

**Step 1: Update LogChannel reference**

Change line 78 from:
```
- `appendFile` from `node:fs/promises` for round-by-round appending (same pattern as LogChannel)
```
to:
```
- `appendFile` from `node:fs/promises` for round-by-round appending (same pattern as AuditLogChannel)
```

**Step 2: Commit**

```bash
git add docs/plans/2026-02-27-inference-payload-logging-design.md
git commit -m "docs: update LogChannel reference to AuditLogChannel"
```
