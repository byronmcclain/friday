# Telegram Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Friday a Telegram bot interface so she can receive messages, route them through Cortex, reply with formatted text, and proactively send notifications.

**Architecture:** A FridayModule in `src/modules/telegram/` using grammY with Telegram's built-in Markdown parse mode. Webhook primary with polling fallback. Expands `ModuleContext` with optional `cortex`, `audit`, and `notifications` fields. Implements `NotificationChannel` for proactive alerts.

**Tech Stack:** TypeScript, grammy, bun:test

**Spec:** `docs/superpowers/specs/2026-03-15-telegram-module-design.md`

---

## Chunk 1: Dependencies + ModuleContext Expansion

### Task 1: Install grammY dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install grammy**

Run: `bun add grammy`

- [ ] **Step 2: Verify installation**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add grammy and @grammyjs/parse-mode for Telegram module"
```

---

### Task 2: Expand ModuleContext with optional cortex and audit

**Files:**
- Modify: `src/modules/types.ts:61-63`
- Modify: `src/core/runtime.ts:457-465` (core modules)
- Modify: `src/core/runtime.ts:488-495` (forge modules)
- Test: `tests/unit/module-context.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/module-context.test.ts`:

```typescript
	test("ModuleContext supports optional cortex field", () => {
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
			cortex: {
				chat: async (msg: string) => `echo: ${msg}`,
			},
		};
		expect(context.cortex).toBeDefined();
		expect(typeof context.cortex!.chat).toBe("function");
	});

	test("ModuleContext supports optional audit field", () => {
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
			audit: { log: () => {} } as unknown as import("../../src/audit/logger.ts").AuditLogger,
		};
		expect(context.audit).toBeDefined();
	});

	test("ModuleContext works without cortex and audit (backward compat)", () => {
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		expect(context.cortex).toBeUndefined();
		expect(context.audit).toBeUndefined();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/module-context.test.ts`
Expected: FAIL — `cortex` and `audit` not on `ModuleContext`

- [ ] **Step 3: Expand ModuleContext interface**

In `src/modules/types.ts`, change lines 61-63 from:

```typescript
export interface ModuleContext {
  memory: ScopedMemory;
}
```

to:

```typescript
export interface ModuleContext {
  memory: ScopedMemory;
  cortex?: { chat(msg: string): Promise<string> };
  audit?: AuditLogger;
  notifications?: NotificationManager;
}
```

No new imports needed — `AuditLogger` (line 3) and `NotificationManager` (line 6) are already imported.

- [ ] **Step 4: Update runtime core module loading**

In `src/core/runtime.ts`, change lines 458-465 from:

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

to:

```typescript
await mod.onLoad({
    memory: this._memory?.scoped(mod.name) ?? {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        list: async () => [],
    },
    cortex: this._cortex ? { chat: (msg: string) => this._cortex.chat(msg) } : undefined,
    audit: this._audit,
    notifications: this._notifications,
});
```

- [ ] **Step 5: Update runtime forge module loading**

Apply the same change to lines 489-495 (forge module loading site) — add `cortex`, `audit`, and `notifications` fields to the `onLoad()` call.

- [ ] **Step 6: Run tests**

Run: `bun test tests/unit/module-context.test.ts`
Expected: PASS (all tests including new ones)

- [ ] **Step 7: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/modules/types.ts src/core/runtime.ts tests/unit/module-context.test.ts
git commit -m "feat: add optional cortex and audit to ModuleContext"
```

---

## Chunk 2: Telegram Module Core

### Task 3: Create TelegramClient

**Files:**
- Create: `src/modules/telegram/client.ts`
- Create: `tests/unit/telegram-client.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/telegram-client.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { TelegramClient } from "../../src/modules/telegram/client.ts";

describe("TelegramClient", () => {
	test("stores and retrieves owner chat ID", () => {
		const client = new TelegramClient("fake-token");
		expect(client.getOwnerChatId()).toBeNull();
		client.setOwnerChatId(12345);
		expect(client.getOwnerChatId()).toBe(12345);
	});

	test("getBot returns grammY Bot instance", () => {
		const client = new TelegramClient("fake-token");
		const bot = client.getBot();
		expect(bot).toBeDefined();
		expect(typeof bot.api).toBe("object");
	});
});
```

- [ ] **Step 2: Create TelegramClient**

Create `src/modules/telegram/client.ts`:

```typescript
import { Bot } from "grammy";

export class TelegramClient {
	private bot: Bot;
	private ownerChatId: number | null = null;

	constructor(token: string) {
		this.bot = new Bot(token);
	}

	getBot(): Bot {
		return this.bot;
	}

	/** Send a message using Telegram's built-in Markdown parse mode.
	 *  Handles **bold**, _italic_, `code`, ```blocks```, [links](url) —
	 *  exactly what Cortex/LLM outputs. */
	async sendMessage(chatId: number, text: string): Promise<void> {
		await this.bot.api.sendMessage(chatId, text, {
			parse_mode: "Markdown",
		});
	}

	async getMe(): Promise<{ id: number; username: string }> {
		const me = await this.bot.api.getMe();
		return { id: me.id, username: me.username ?? "" };
	}

	setOwnerChatId(chatId: number): void {
		this.ownerChatId = chatId;
	}

	getOwnerChatId(): number | null {
		return this.ownerChatId;
	}
}
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/telegram-client.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/telegram/client.ts tests/unit/telegram-client.test.ts
git commit -m "feat: add TelegramClient wrapping grammY Bot with parse-mode"
```

---

### Task 4: Create TelegramListener with webhook/polling fallback

**Files:**
- Create: `src/modules/telegram/listener.ts`
- Create: `tests/unit/telegram-listener.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/telegram-listener.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { TelegramListener } from "../../src/modules/telegram/listener.ts";

describe("TelegramListener", () => {
	test("starts in stopped mode", () => {
		const listener = new TelegramListener();
		expect(listener.getMode()).toBe("stopped");
	});
});
```

- [ ] **Step 2: Create TelegramListener**

Create `src/modules/telegram/listener.ts`:

```typescript
import { webhookCallback } from "grammy";
import type { TelegramClient } from "./client.ts";
import type { ScopedMemory } from "../../core/memory.ts";
import type { AuditLogger } from "../../audit/logger.ts";

export interface ListenerConfig {
	ownerId?: number;
	webhookUrl?: string;
	memory: ScopedMemory;
	audit?: AuditLogger;
}

export class TelegramListener {
	private mode: "webhook" | "polling" | "stopped" = "stopped";
	private webhookHandler: ((req: Request) => Response | Promise<Response>) | null = null;

	async start(
		client: TelegramClient,
		cortex: { chat(msg: string): Promise<string> } | undefined,
		config: ListenerConfig,
	): Promise<void> {
		const bot = client.getBot();
		const ownerId = config.ownerId;
		const audit = config.audit;

		bot.on("message:text", async (ctx) => {
			if (ownerId && ctx.from.id !== ownerId) return;

			if (!client.getOwnerChatId()) {
				client.setOwnerChatId(ctx.chat.id);
				await config.memory.set("owner_chat_id", ctx.chat.id);
			}

			if (!ownerId) {
				console.log(
					`[Telegram] Message from user ${ctx.from.id} — set TELEGRAM_OWNER_ID to lock access`,
				);
			}

			audit?.log({
				action: "telegram:message-received",
				source: "telegram",
				detail: `From ${ctx.from.id}`,
				success: true,
			});

			if (!cortex) {
				await ctx.reply("Friday's brain is not connected to Telegram yet.");
				return;
			}

			const response = await cortex.chat(ctx.message.text);
			await ctx.reply(response, { parse_mode: "Markdown" });

			audit?.log({
				action: "telegram:message-sent",
				source: "telegram",
				detail: "Reply sent",
				success: true,
			});
		});

		// Try webhook first
		if (config.webhookUrl) {
			try {
				const secretToken =
					(await config.memory.get<string>("webhook_secret")) ??
					crypto.randomUUID();
				await config.memory.set("webhook_secret", secretToken);

				await bot.api.setWebhook(config.webhookUrl, {
					secret_token: secretToken,
				});
				this.webhookHandler = webhookCallback(bot, "bun", {
					secretToken,
				});
				this.mode = "webhook";
				audit?.log({
					action: "telegram:webhook-active",
					source: "telegram",
					detail: config.webhookUrl,
					success: true,
				});
				return;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				audit?.log({
					action: "telegram:webhook-fallback",
					source: "telegram",
					detail: msg,
					success: false,
				});
			}
		}

		// Fall back to polling
		await bot.api.deleteWebhook();
		bot.start().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			audit?.log({
				action: "telegram:polling-error",
				source: "telegram",
				detail: msg,
				success: false,
			});
		});
		this.mode = "polling";
		audit?.log({
			action: "telegram:polling-active",
			source: "telegram",
			detail: "Webhook unavailable, using long-polling",
			success: true,
		});
	}

	async stop(client: TelegramClient): Promise<void> {
		if (this.mode === "polling") {
			await client.getBot().stop();
		} else if (this.mode === "webhook") {
			await client.getBot().api.deleteWebhook();
		}
		this.mode = "stopped";
		this.webhookHandler = null;
	}

	getMode(): "webhook" | "polling" | "stopped" {
		return this.mode;
	}

	getWebhookHandler(): ((req: Request) => Response | Promise<Response>) | null {
		return this.webhookHandler;
	}
}
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/telegram-listener.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/telegram/listener.ts tests/unit/telegram-listener.test.ts
git commit -m "feat: add TelegramListener with webhook/polling fallback"
```

---

### Task 5: Create TelegramChannel (NotificationChannel)

**Files:**
- Create: `src/modules/telegram/channel.ts`
- Create: `tests/unit/telegram-channel.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/telegram-channel.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { TelegramChannel } from "../../src/modules/telegram/channel.ts";

describe("TelegramChannel", () => {
	test("has name 'telegram'", () => {
		const mockClient = {
			getOwnerChatId: () => null,
			sendMessage: async () => {},
		};
		const channel = new TelegramChannel(mockClient as any);
		expect(channel.name).toBe("telegram");
	});

	test("skips send when no owner chat ID", async () => {
		let sent = false;
		const mockClient = {
			getOwnerChatId: () => null,
			sendMessage: async () => { sent = true; },
		};
		const channel = new TelegramChannel(mockClient as any);
		await channel.send({ level: "info", title: "Test", body: "Hello", source: "test" });
		expect(sent).toBe(false);
	});

	test("sends formatted notification when owner chat ID is set", async () => {
		let sentText = "";
		const mockClient = {
			getOwnerChatId: () => 12345,
			sendMessage: async (_chatId: number, text: string) => { sentText = text; },
		};
		const channel = new TelegramChannel(mockClient as any);
		await channel.send({ level: "warning", title: "Alert", body: "CPU high", source: "sensorium" });
		expect(sentText).toContain("Alert");
		expect(sentText).toContain("CPU high");
	});
});
```

- [ ] **Step 2: Create TelegramChannel**

Create `src/modules/telegram/channel.ts`:

```typescript
import type {
	NotificationChannel,
	FridayNotification,
} from "../../core/notifications.ts";
import type { TelegramClient } from "./client.ts";

export class TelegramChannel implements NotificationChannel {
	name = "telegram";

	constructor(private client: TelegramClient) {}

	async send(notification: FridayNotification): Promise<void> {
		const chatId = this.client.getOwnerChatId();
		if (!chatId) return;

		const text = `**${notification.title}**\n${notification.body}`;
		await this.client.sendMessage(chatId, text);
	}
}
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/telegram-channel.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/modules/telegram/channel.ts tests/unit/telegram-channel.test.ts
git commit -m "feat: add TelegramChannel implementing NotificationChannel"
```

---

## Chunk 3: Tools, Protocol, Module Manifest

### Task 6: Create telegram.send tool

**Files:**
- Create: `src/modules/telegram/tools/send.ts`
- Create: `tests/unit/telegram-tools.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/telegram-tools.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { telegramSend } from "../../src/modules/telegram/tools/send.ts";
import { setTelegramClient } from "../../src/modules/telegram/state.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const stubContext: ToolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as unknown as ToolContext["audit"],
	signal: { emit: async () => {} } as unknown as ToolContext["signal"],
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
};

describe("telegram.send tool", () => {
	test("has correct name and clearance", () => {
		expect(telegramSend.name).toBe("telegram.send");
		expect(telegramSend.clearance).toEqual(["network"]);
	});

	test("fails without message parameter", async () => {
		const result = await telegramSend.execute({}, stubContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("message");
	});

	test("fails when client not initialized", async () => {
		setTelegramClient(null);
		const result = await telegramSend.execute({ message: "Hello" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("not active");
	});

	test("fails when owner chat ID not known", async () => {
		const mockClient = { getOwnerChatId: () => null, sendMessage: async () => {} } as any;
		setTelegramClient(mockClient);
		const result = await telegramSend.execute({ message: "Hello" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("owner");
		setTelegramClient(null);
	});

	test("sends message when owner chat ID is set", async () => {
		let sentMsg = "";
		const mockClient = {
			getOwnerChatId: () => 12345,
			sendMessage: async (_chatId: number, text: string) => { sentMsg = text; },
		} as any;
		setTelegramClient(mockClient);
		const result = await telegramSend.execute({ message: "Hello Boss" }, stubContext);
		expect(result.success).toBe(true);
		expect(sentMsg).toBe("Hello Boss");
		setTelegramClient(null);
	});
});
```

- [ ] **Step 2: Create telegram.send tool**

Create `src/modules/telegram/tools/send.ts`:

```typescript
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getTelegramClient } from "../state.ts";

/** Uses state getter — tool is registered at module definition time,
 *  but the client only exists after onLoad(). Fails gracefully if not initialized. */
export const telegramSend: FridayTool = {
	name: "telegram.send",
	description:
		"Send a message to the Boss via Telegram. Use this to proactively share information, alerts, or updates.",
	parameters: [
		{
			name: "message",
			type: "string",
			description: "The message to send (supports Markdown formatting)",
			required: true,
		},
	],
	clearance: ["network"],
	async execute(
		args: Record<string, unknown>,
		_context: ToolContext,
	): Promise<ToolResult> {
		const message = args.message as string;
		if (!message) {
			return { success: false, output: "Missing required parameter: message" };
		}

		const client = getTelegramClient();
		if (!client) {
			return { success: false, output: "Telegram module not active. Set TELEGRAM_BOT_TOKEN." };
		}

		const chatId = client.getOwnerChatId();
		if (!chatId) {
			return {
				success: false,
				output: "Telegram owner chat ID not known yet. The Boss needs to message the bot first.",
			};
		}

		try {
			await client.sendMessage(chatId, message);
			return { success: true, output: "Message sent to Boss via Telegram" };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Telegram send failed: ${msg}` };
		}
	},
};
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/telegram-tools.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 4: Commit**

```bash
git add src/modules/telegram/tools/send.ts tests/unit/telegram-tools.test.ts
git commit -m "feat: add telegram.send tool for proactive messaging"
```

---

### Task 7: Create /telegram protocol

**Files:**
- Create: `src/modules/telegram/protocol.ts`
- Create: `tests/unit/telegram-protocol.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/telegram-protocol.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { telegramProtocol } from "../../src/modules/telegram/protocol.ts";
import { setTelegramClient, setTelegramListener } from "../../src/modules/telegram/state.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";

const stubContext: ProtocolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as any,
	signal: { emit: async () => {} } as any,
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
	tools: new Map(),
};

describe("/telegram protocol", () => {
	test("has correct name and aliases", () => {
		expect(telegramProtocol.name).toBe("telegram");
		expect(telegramProtocol.aliases).toContain("tg");
	});

	test("returns inactive when client not set", async () => {
		setTelegramClient(null);
		setTelegramListener(null);
		const result = await telegramProtocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("not active");
	});

	test("status shows mode and connection info", async () => {
		const mockClient = { getOwnerChatId: () => 12345, getMe: async () => ({ id: 1, username: "friday_bot" }) } as any;
		const mockListener = { getMode: () => "polling" as const } as any;
		setTelegramClient(mockClient);
		setTelegramListener(mockListener);
		const result = await telegramProtocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("polling");
		setTelegramClient(null);
		setTelegramListener(null);
	});

	test("unknown subcommand returns error", async () => {
		const mockClient = { getOwnerChatId: () => null } as any;
		const mockListener = { getMode: () => "stopped" as const } as any;
		setTelegramClient(mockClient);
		setTelegramListener(mockListener);
		const result = await telegramProtocol.execute({ rawArgs: "bogus" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown subcommand");
		setTelegramClient(null);
		setTelegramListener(null);
	});
});
```

- [ ] **Step 2: Create /telegram protocol**

Create `src/modules/telegram/protocol.ts`:

```typescript
import type {
	FridayProtocol,
	ProtocolContext,
	ProtocolResult,
} from "../types.ts";
import type { TelegramClient } from "./client.ts";
import type { TelegramListener } from "./listener.ts";

import { getTelegramClient, getTelegramListener } from "./state.ts";

/** Uses state getters — registered at module definition time,
 *  client/listener only exist after onLoad(). */
export const telegramProtocol: FridayProtocol = {
	name: "telegram",
	description: "Manage Friday's Telegram bot — status, send messages, switch modes.",
	aliases: ["tg"],
	parameters: [
		{
			name: "subcommand",
			type: "string",
			description: "Subcommand: status, send, webhook, polling",
			required: true,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		_context: ProtocolContext,
	): Promise<ProtocolResult> {
		const rawArgs = (args.rawArgs as string) ?? "";
		const parts = rawArgs.trim().split(/\s+/);
		const subcommand = parts[0] ?? "status";
		const rest = parts.slice(1).join(" ");

		const client = getTelegramClient();
		const listener = getTelegramListener();

		if (!client || !listener) {
			return { success: false, summary: "Telegram module not active. Set TELEGRAM_BOT_TOKEN." };
		}

		switch (subcommand) {
			case "status": {
				const mode = listener.getMode();
				const ownerId = client.getOwnerChatId();
				let botInfo = "unknown";
				try {
					const me = await client.getMe();
					botInfo = `@${me.username}`;
				} catch { /* bot not initialized */ }
				return {
					success: true,
					summary: `Telegram: ${botInfo} — ${mode} mode${ownerId ? ` — owner chat: ${ownerId}` : " — owner not yet identified"}`,
				};
			}

			case "send": {
				if (!rest) {
					return { success: false, summary: "Usage: /telegram send <message>" };
				}
				const chatId = client.getOwnerChatId();
				if (!chatId) {
					return { success: false, summary: "Owner chat ID not known. Message the bot first." };
				}
				await client.sendMessage(chatId, rest);
				return { success: true, summary: `Sent to Telegram: "${rest.substring(0, 50)}..."` };
			}

			case "webhook":
				return { success: false, summary: "Runtime mode switching not yet implemented. Restart server with TELEGRAM_WEBHOOK_URL set." };

			case "polling":
				return { success: false, summary: "Runtime mode switching not yet implemented. Restart server without TELEGRAM_WEBHOOK_URL." };

			default:
				return {
					success: false,
					summary: `Unknown subcommand: ${subcommand}. Available: status, send, webhook, polling`,
				};
		}
	},
};
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/telegram-protocol.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/modules/telegram/protocol.ts tests/unit/telegram-protocol.test.ts
git commit -m "feat: add /telegram protocol with status and send subcommands"
```

---

### Task 8: Create module manifest and state

**Files:**
- Create: `src/modules/telegram/state.ts`
- Create: `src/modules/telegram/index.ts`
- Create: `tests/unit/telegram-module.test.ts`

- [ ] **Step 1: Create state module**

Create `src/modules/telegram/state.ts`:

```typescript
import type { TelegramClient } from "./client.ts";
import type { TelegramListener } from "./listener.ts";

let client: TelegramClient | null = null;
let listener: TelegramListener | null = null;

export function getTelegramClient(): TelegramClient | null { return client; }
export function setTelegramClient(c: TelegramClient | null): void { client = c; }
export function getTelegramListener(): TelegramListener | null { return listener; }
export function setTelegramListener(l: TelegramListener | null): void { listener = l; }
```

- [ ] **Step 2: Create module manifest**

Create `src/modules/telegram/index.ts`:

```typescript
import type { FridayModule, ModuleContext } from "../types.ts";
import { TelegramClient } from "./client.ts";
import { TelegramListener } from "./listener.ts";
import { TelegramChannel } from "./channel.ts";
import { telegramSend } from "./tools/send.ts";
import { telegramProtocol } from "./protocol.ts";
import {
	setTelegramClient,
	setTelegramListener,
	getTelegramClient,
	getTelegramListener,
} from "./state.ts";

const telegramModule = {
	name: "telegram",
	description:
		"Telegram bot — chat with Friday from your phone, receive notifications and alerts.",
	version: "1.0.0",
	tools: [telegramSend],
	protocols: [telegramProtocol],
	knowledge: [],
	triggers: [],
	clearance: ["network"],

	async onLoad(context: ModuleContext) {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) {
			console.warn(
				"[Telegram] TELEGRAM_BOT_TOKEN not set — Telegram module inactive.",
			);
			return;
		}

		const client = new TelegramClient(token);
		const listener = new TelegramListener();
		setTelegramClient(client);
		setTelegramListener(listener);

		// Restore owner chat ID from persistent storage
		const savedChatId = await context.memory.get<number>("owner_chat_id");
		if (savedChatId) client.setOwnerChatId(savedChatId);

		const ownerId = process.env.TELEGRAM_OWNER_ID
			? Number(process.env.TELEGRAM_OWNER_ID)
			: undefined;
		const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

		await listener.start(client, context.cortex, {
			ownerId,
			webhookUrl,
			memory: context.memory,
			audit: context.audit,
		});

		// Register as notification channel so Friday can proactively message
		if (context.notifications) {
			context.notifications.addChannel(new TelegramChannel(client));
		}

		const mode = listener.getMode();
		console.log(`[Telegram] Bot active — ${mode} mode`);
	},

	async onUnload() {
		const client = getTelegramClient();
		const listener = getTelegramListener();
		if (listener && client) {
			await listener.stop(client);
		}
		setTelegramClient(null);
		setTelegramListener(null);
	},
} satisfies FridayModule;

export default telegramModule;
```

- [ ] **Step 3: Write module test**

Create `tests/unit/telegram-module.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import telegramModule from "../../src/modules/telegram/index.ts";
import type { ModuleContext } from "../../src/modules/types.ts";

describe("telegram module", () => {
	test("exports valid module manifest", () => {
		expect(telegramModule.name).toBe("telegram");
		expect(telegramModule.version).toBe("1.0.0");
		expect(telegramModule.description).toContain("Telegram");
	});

	test("declares network clearance", () => {
		expect(telegramModule.clearance).toContain("network");
	});

	test("has onLoad lifecycle hook", () => {
		expect(typeof telegramModule.onLoad).toBe("function");
	});

	test("onLoad without TELEGRAM_BOT_TOKEN does not throw", async () => {
		const saved = process.env.TELEGRAM_BOT_TOKEN;
		delete process.env.TELEGRAM_BOT_TOKEN;
		const context: ModuleContext = {
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
		await telegramModule.onLoad(context); // should not throw
		process.env.TELEGRAM_BOT_TOKEN = saved;
	});
});
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/telegram-module.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/telegram/state.ts src/modules/telegram/index.ts tests/unit/telegram-module.test.ts
git commit -m "feat: add Telegram FridayModule manifest with onLoad lifecycle"
```

---

## Chunk 4: Server Integration + Documentation

### Task 9: Add webhook route to server

**Files:**
- Modify: `src/server/index.ts:70-71`

- [ ] **Step 1: Add webhook route**

In `src/server/index.ts`, after the WebSocket upgrade block (after line 69 `return new Response("WebSocket upgrade failed", { status: 400 });`), add before the static file serving:

```typescript
			// Telegram webhook handler
			if (req.method === "POST" && url.pathname === "/hooks/telegram") {
				const { getTelegramListener } = await import("../modules/telegram/state.ts");
				const listener = getTelegramListener();
				const handler = listener?.getWebhookHandler();
				if (handler) {
					return await handler(req);
				}
				return new Response("Telegram webhook not active", { status: 503 });
			}
```

Uses dynamic import to avoid hard dependency — if the Telegram module isn't loaded, the route returns 503.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add /hooks/telegram webhook route to server"
```

---

### Task 10: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Add Telegram to the architecture tree, module list, env vars, and patterns:

- Architecture tree: add `│   ├── telegram/          # Telegram bot — mobile chat + notifications` before the `(reserved for future)` line
- Module count: change `7 modules` to `8 modules` and add `telegram` to the list
- Add `ModuleContext` expansion note: `onLoad(context: ModuleContext)` now has optional `cortex` and `audit` fields
- Add env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_URL`

- [ ] **Step 2: Update README.md**

- Add Telegram row to module table
- Add `/telegram` protocol commands to the commands table
- Add Telegram env vars to the environment section
- Add `telegram/` to the architecture tree

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: add Telegram module to CLAUDE.md and README.md"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new Telegram tests)

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Manual smoke test**

1. Add `TELEGRAM_BOT_TOKEN` to `.env` (already done)
2. Run `friday serve`
3. Open Telegram, send a message to your bot
4. Verify Friday receives it, routes through Cortex, and replies with formatted text
5. Check audit logs for `telegram:message-received` and `telegram:message-sent` entries
