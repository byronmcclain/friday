# Notification Broadcast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Broadcast notifications from Sensorium/Arc Rhythm to all connected clients (TUI + web) by renaming the transport-agnostic channel class, wiring it per-client on Unix sockets, and rendering as toast + log panel in the TUI.

**Architecture:** Rename `WebSocketNotificationChannel` → `PushNotificationChannel` (same class, transport-agnostic). Wire per-client in `socket.ts` on identify. Add `onNotification` callback to `SocketBridge`. TUI wires callback to toast + log panel.

**Tech Stack:** TypeScript, bun:test, OpenTUI toast (`@opentui-ui/toast`)

---

### Task 1: Rename WebSocketNotificationChannel → PushNotificationChannel

**Files:**
- Rename: `src/server/ws-channel.ts` → `src/server/push-channel.ts`
- Modify: `src/server/handler.ts` (update import)
- Rename test: `tests/unit/ws-channel.test.ts` → `tests/unit/push-channel.test.ts`

**Step 1: Update the test file**

Rename `tests/unit/ws-channel.test.ts` to `tests/unit/push-channel.test.ts`.

Update its contents — change all references from `WebSocketNotificationChannel` to `PushNotificationChannel`, update the import path, and update the name expectation:

```ts
import { describe, test, expect } from "bun:test";
import { PushNotificationChannel } from "../../src/server/push-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("PushNotificationChannel", () => {
	test("sends notification to registered callback", async () => {
		const sent: any[] = [];
		const channel = new PushNotificationChannel((msg) => sent.push(msg));

		const notification: FridayNotification = {
			level: "warning",
			title: "CPU High",
			body: "CPU at 92%",
			source: "sensorium",
		};
		await channel.send(notification);

		expect(sent).toHaveLength(1);
		expect(sent[0].type).toBe("notification");
		expect(sent[0].level).toBe("warning");
		expect(sent[0].title).toBe("CPU High");
	});

	test("has default name 'push'", () => {
		const channel = new PushNotificationChannel(() => {});
		expect(channel.name).toBe("push");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-channel.test.ts`
Expected: FAIL — `push-channel.ts` does not exist yet.

**Step 3: Rename and update the source file**

Rename `src/server/ws-channel.ts` to `src/server/push-channel.ts`. Update class name and default name:

```ts
import type {
	NotificationChannel,
	FridayNotification,
} from "../core/notifications.ts";
import type { SendFn } from "./client-registry.ts";

export class PushNotificationChannel implements NotificationChannel {
	name = "push";
	private sendFn: SendFn;

	constructor(sendFn: SendFn) {
		this.sendFn = sendFn;
	}

	async send(notification: FridayNotification): Promise<void> {
		this.sendFn({
			type: "notification",
			level: notification.level,
			title: notification.title,
			body: notification.body,
			source: notification.source,
		});
	}
}
```

**Step 4: Update `src/server/handler.ts` import**

Change line 8 from:
```ts
import { WebSocketNotificationChannel } from "./ws-channel.ts";
```
to:
```ts
import { PushNotificationChannel } from "./push-channel.ts";
```

Change line 147 from:
```ts
const channel = new WebSocketNotificationChannel(send);
```
to:
```ts
const channel = new PushNotificationChannel(send);
```

**Step 5: Delete the old test file**

Delete `tests/unit/ws-channel.test.ts` (replaced by `push-channel.test.ts`).

**Step 6: Run tests to verify**

Run: `bun test tests/unit/push-channel.test.ts`
Expected: ALL PASS

Run: `bun test tests/unit/server-handler.test.ts`
Expected: ALL PASS (import resolved)

**Step 7: Commit**

```bash
git add src/server/push-channel.ts src/server/handler.ts tests/unit/push-channel.test.ts
git rm src/server/ws-channel.ts tests/unit/ws-channel.test.ts
git commit -m "refactor: rename WebSocketNotificationChannel → PushNotificationChannel

Transport-agnostic notification push channel, preparing for Unix socket support.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Wire PushNotificationChannel per-client in socket.ts

**Files:**
- Modify: `src/server/socket.ts`
- Modify: `tests/unit/socket-server.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/socket-server.test.ts`:

```ts
test("adds notification channel on session:identify and removes on close", async () => {
	const addedChannels: string[] = [];
	const removedChannels: string[] = [];
	const mockRuntime = {
		isBooted: true,
		cortex: { modelName: "test" },
		protocols: { isProtocol: () => false },
		audit: new AuditLogger(),
		notifications: {
			addChannel: (ch: any) => addedChannels.push(ch.name),
			removeChannel: (name: string) => removedChannels.push(name),
		},
	} as any;
	const hub = createMockHub();
	const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
	await server.start();

	const { connect } = await import("node:net");
	const socket = connect({ path: TEST_SOCKET });
	await new Promise<void>((resolve) => { socket.on("connect", resolve); });
	socket.write(JSON.stringify({ type: "session:identify", id: "r1", clientType: "tui" }) + "\n");
	await new Promise((r) => setTimeout(r, 100));

	expect(addedChannels).toHaveLength(1);
	expect(addedChannels[0]).toMatch(/^socket-/);

	socket.end();
	await new Promise((r) => setTimeout(r, 100));

	expect(removedChannels).toHaveLength(1);
	expect(removedChannels[0]).toBe(addedChannels[0]);

	await server.stop();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: FAIL — `addedChannels` is empty (no channel wired yet).

**Step 3: Implement the changes in `src/server/socket.ts`**

Add import at top (after existing imports):
```ts
import { PushNotificationChannel } from "./push-channel.ts";
```

Change the `socketClients` map type on line 16 from:
```ts
private socketClients = new Map<unknown, string>();
```
to:
```ts
private socketClients = new Map<unknown, { clientId: string; channelName: string }>();
```

Update `open` handler (line 69-71) to store both clientId and channelName:
```ts
open: (socket) => {
  const clientId = crypto.randomUUID();
  const channelName = `socket-${clientId}`;
  this.socketClients.set(socket, { clientId, channelName });
},
```

Update `data` handler (line 73-75) to destructure:
```ts
data: (socket, data) => {
  const client = this.socketClients.get(socket);
  if (!client) return;

  const lines = data.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    const msg = parseClientMessage(line);
    if (!msg) continue;

    const send = (response: ServerMessage) => {
      socket.write(JSON.stringify(response) + "\n");
    };

    void this.handleMessage(msg, send, client.clientId, client.channelName);
  }
},
```

Update `close` handler (lines 90-96) to clean up notification channel:
```ts
close: (socket) => {
  const client = this.socketClients.get(socket);
  if (client) {
    if (this.runtime.notifications) {
      this.runtime.notifications.removeChannel(client.channelName);
    }
    void this.hub.unregisterClient(client.clientId);
    this.socketClients.delete(socket);
  }
},
```

Update `handleMessage` signature (line 119) to accept `channelName`:
```ts
private async handleMessage(
  msg: ReturnType<typeof parseClientMessage> & {},
  send: (msg: ServerMessage) => void,
  clientId: string,
  channelName: string,
): Promise<void> {
```

In the `session:identify` case (lines 125-138), add notification channel wiring after `registerClient`:
```ts
case "session:identify": {
  this.hub.registerClient({
    id: clientId,
    clientType: msg.clientType,
    send,
    capabilities: new Set(["text"]),
  });

  if (this.runtime.notifications) {
    const channel = new PushNotificationChannel(send);
    channel.name = channelName;
    this.runtime.notifications.addChannel(channel);
  }

  send({
    type: "session:ready",
    requestId: msg.id,
    model: this.runtime.cortex.modelName,
    capabilities: ["text"],
  });
  break;
}
```

Do the same for the `session:boot` case (lines 140-153) — add notification channel wiring after `registerClient`:
```ts
case "session:boot": {
  this.hub.registerClient({
    id: clientId,
    clientType: "chat",
    send,
    capabilities: new Set(["text"]),
  });

  if (this.runtime.notifications) {
    const channel = new PushNotificationChannel(send);
    channel.name = channelName;
    this.runtime.notifications.addChannel(channel);
  }

  send({
    type: "session:ready",
    requestId: msg.id,
    model: this.runtime.cortex.modelName,
    capabilities: ["text"],
  });
  break;
}
```

**Step 4: Run tests to verify**

Run: `bun test tests/unit/socket-server.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/server/socket.ts tests/unit/socket-server.test.ts
git commit -m "feat: wire PushNotificationChannel per-client on Unix socket

Mirrors WebSocket handler pattern — notification channel created on
session:identify/boot, removed on socket close.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add onNotification callback to SocketBridge

**Files:**
- Modify: `src/core/bridges/socket.ts`
- Modify: `tests/unit/socket-bridge.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/socket-bridge.test.ts`:

```ts
test("fires onNotification for notification events", () => {
	const bridge = new SocketBridge("/tmp/nonexistent.sock");
	const received: any[] = [];
	bridge.onNotification = (msg) => received.push(msg);

	(bridge as any).handleServerMessage({
		type: "notification",
		level: "warning",
		title: "Memory High",
		body: "Memory usage at 92%",
		source: "sensorium",
	});

	expect(received).toHaveLength(1);
	expect(received[0].level).toBe("warning");
	expect(received[0].title).toBe("Memory High");
	expect(received[0].body).toBe("Memory usage at 92%");
	expect(received[0].source).toBe("sensorium");
});

test("does not throw when onNotification is not set", () => {
	const bridge = new SocketBridge("/tmp/nonexistent.sock");

	(bridge as any).handleServerMessage({
		type: "notification",
		level: "alert",
		title: "Container Down",
		body: "nginx is not running",
		source: "sensorium",
	});
});

test("notification does not interfere with request-reply messages", () => {
	const bridge = new SocketBridge("/tmp/nonexistent.sock");
	const received: any[] = [];
	bridge.onNotification = (msg) => received.push(msg);

	// A notification should be handled by the callback, not by pendingCallbacks
	(bridge as any).handleServerMessage({
		type: "notification",
		level: "info",
		title: "Test",
		body: "test body",
		source: "test",
	});

	expect(received).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: FAIL — `onNotification` property does not exist on `SocketBridge`.

**Step 3: Implement the changes in `src/core/bridges/socket.ts`**

Add the callback property at line 17 (after `onToolCompleted`):
```ts
onNotification?: (msg: Extract<ServerMessage, { type: "notification" }>) => void;
```

In `handleServerMessage()` (line 202), add a case for `type: "notification"` after the `audit:entry` check (after line 210):
```ts
if (msg.type === "notification") {
  this.onNotification?.(msg);
  return;
}
```

**Step 4: Run tests to verify**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/bridges/socket.ts tests/unit/socket-bridge.test.ts
git commit -m "feat: add onNotification callback to SocketBridge

Handles type: 'notification' push messages from server, enabling TUI
clients to receive Sensorium/Arc Rhythm alerts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire TUI notification handler (toast + log panel)

**Files:**
- Modify: `src/cli/tui/app.tsx`

**Step 1: Add the onNotification wiring**

In `src/cli/tui/app.tsx`, locate the boot effect where bridge callbacks are wired (around lines 122-145). After the `onToolCompleted` wiring (line 145), add:

```tsx
// Wire notification push from the server into TUI toast + log panel
socketBridge.onNotification = (msg) => {
	if (cancelled) return;
	const prefix = { info: "\u2139", warning: "\u26A0", alert: "\uD83D\uDEA8" }[msg.level];
	toast(`${prefix} ${msg.title}: ${msg.body}`);
	const logLevel: LogEntry["level"] = msg.level === "alert" ? "error" : msg.level === "warning" ? "warning" : "info";
	pushLog(logLevel, msg.source, msg.title, msg.body);
};
```

Note: The unicode escapes are for `ℹ` (info), `⚠` (warning), `🚨` (alert). Using escapes avoids encoding issues.

**Step 2: Verify manually**

This is a TUI rendering change that can't be unit-tested without an OpenTUI test harness. Verify by:

1. Start the server: `friday serve`
2. Connect a TUI client: `friday chat`
3. Wait for a Sensorium poll cycle (30s) — if memory/CPU is near threshold, a notification will appear as a toast and in the log panel
4. Alternatively, trigger a test notification by asking Friday to run `/env status` and observing audit entries flow into the log panel — the notification path is the same

**Step 3: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat: display server notifications as TUI toast + log panel entry

Wires onNotification callback to show toast overlay (auto-dismiss) and
persist to debug log panel. Level-mapped: info→ℹ, warning→⚠, alert→🚨.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
