# Telegram Module — Friday's Mobile Interface

**Date**: 2026-03-15
**Status**: Approved
**Goal**: Give Friday a Telegram bot so you can chat with her from your phone, and she can proactively message you with alerts and notifications.

## Architecture

```
You (Telegram App)
  │
  ├── message ──→ Telegram API ──→ TelegramListener (webhook or polling)
  │                                   │
  │                                   ├── owner check (TELEGRAM_OWNER_ID)
  │                                   ├── audit log
  │                                   └── cortex.chat(message.text)
  │                                         │
  │                                         ▼
  │                                    Cortex reasons, uses tools
  │                                         │
  └── reply ←── Telegram API ←── bot.api.sendMessage(chatId, response)


Notifications (Arc Rhythm, Sensorium, Directives)
  │
  └── NotificationManager ──→ TelegramChannel ──→ bot.api.sendMessage(ownerChatId, alert)
```

## Dependencies

- `grammy` — TypeScript Telegram Bot framework (1.2M weekly downloads, native TypeScript, supports polling + webhooks)
- No other new dependencies

## File Structure

```
src/modules/telegram/
├── index.ts          # FridayModule manifest, onLoad(context) starts listener
├── client.ts         # TelegramClient — wraps grammY Bot, sendMessage, getMe
├── listener.ts       # TelegramListener — webhook primary, polling fallback
├── channel.ts        # TelegramChannel — implements NotificationChannel
├── protocol.ts       # /telegram protocol (status, send, webhook, polling)
└── tools/
    └── send.ts       # telegram.send FridayTool — LLM can proactively message owner
```

## Components

### TelegramClient (`client.ts`)

Wraps grammY's `Bot` class. Responsible for sending messages only — receiving is handled by the listener.

```typescript
import { Bot } from "grammy";

export class TelegramClient {
  private bot: Bot;
  private ownerChatId: number | null = null;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  /** Get the underlying grammY Bot instance (for listener setup) */
  getBot(): Bot { return this.bot; }

  /** Send a text message to the owner */
  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
  }

  /** Get bot info (username, id) */
  async getMe(): Promise<{ id: number; username: string }> { ... }

  /** Store the owner's chat ID (discovered on first message or from env) */
  setOwnerChatId(chatId: number): void { this.ownerChatId = chatId; }
  getOwnerChatId(): number | null { return this.ownerChatId; }
}
```

HTML parse mode by default — Telegram supports `<b>`, `<i>`, `<code>`, `<pre>`, `<a href>`. This lets Friday format responses nicely without Markdown escaping headaches (MarkdownV2 requires escaping `.`, `!`, `-`, `(`, `)`, etc.).

### TelegramListener (`listener.ts`)

Manages how Friday receives messages. Tries webhook first, falls back to polling.

```typescript
export class TelegramListener {
  private mode: "webhook" | "polling" | "stopped" = "stopped";

  async start(client: TelegramClient, cortex: Cortex, config: ListenerConfig): Promise<void> {
    const bot = client.getBot();
    const ownerId = config.ownerId;

    // Register message handler
    bot.on("message:text", async (ctx) => {
      // Owner check
      if (ownerId && ctx.from.id !== ownerId) return;

      // Store chat ID for notifications
      if (!client.getOwnerChatId()) {
        client.setOwnerChatId(ctx.chat.id);
        // Persist to ScopedMemory for restart survival
        await config.memory.set("owner_chat_id", ctx.chat.id);
      }

      // Log first-message discovery if no owner configured
      if (!ownerId) {
        console.log(`[Telegram] Message from user ${ctx.from.id} — set TELEGRAM_OWNER_ID to lock access`);
      }

      // Route to Cortex
      config.audit.log({ action: "telegram:message-received", source: "telegram", detail: `From ${ctx.from.id}`, success: true });
      const response = await cortex.chat(ctx.message.text);
      await ctx.reply(response, { parse_mode: "HTML" });
      config.audit.log({ action: "telegram:message-sent", source: "telegram", detail: `Reply sent`, success: true });
    });

    // Try webhook first
    if (config.webhookUrl) {
      try {
        await bot.api.setWebhook(config.webhookUrl);
        this.mode = "webhook";
        config.audit.log({ action: "telegram:webhook-active", source: "telegram", detail: config.webhookUrl, success: true });
        return;
      } catch (err) {
        config.audit.log({ action: "telegram:webhook-fallback", source: "telegram", detail: err.message, success: false });
      }
    }

    // Fall back to polling
    await bot.api.deleteWebhook();
    bot.start(); // non-blocking — enters polling loop
    this.mode = "polling";
    config.audit.log({ action: "telegram:polling-active", source: "telegram", detail: "Webhook unavailable, using long-polling", success: true });
  }

  async stop(client: TelegramClient): Promise<void> {
    if (this.mode === "polling") {
      await client.getBot().stop();
    } else if (this.mode === "webhook") {
      await client.getBot().api.deleteWebhook();
    }
    this.mode = "stopped";
  }

  getMode(): string { return this.mode; }
}
```

**Webhook integration**: When in webhook mode, Friday's server (`src/server/index.ts`) needs a route to handle incoming Telegram updates. grammY provides `webhookCallback(bot, "std/http")` which returns a `Request → Response` handler — compatible with `Bun.serve()`. The module registers this route during `onLoad()`.

**Polling mode**: `bot.start()` enters grammY's built-in long-polling loop. The returned Promise never resolves until `bot.stop()` is called. This runs in the background — does not block Friday's boot.

### TelegramChannel (`channel.ts`)

Implements `NotificationChannel` so Friday can proactively message you.

```typescript
import type { NotificationChannel, Notification } from "../../core/notifications.ts";

export class TelegramChannel implements NotificationChannel {
  name = "telegram";

  constructor(private client: TelegramClient) {}

  async send(notification: Notification): Promise<void> {
    const chatId = this.client.getOwnerChatId();
    if (!chatId) return; // Can't send if we don't know the owner's chat yet

    const text = `<b>${notification.title}</b>\n${notification.body}`;
    await this.client.sendMessage(chatId, text);
  }
}
```

### Protocol (`protocol.ts`)

`/telegram` slash command (aliases: `/tg`):

| Subcommand | Description |
|-----------|-------------|
| `status` | Show bot username, mode (webhook/polling), owner ID |
| `send <message>` | Manually send a message to the owner via Telegram |
| `webhook` | Force webhook mode |
| `polling` | Force polling mode |

### Tool (`tools/send.ts`)

`telegram.send` FridayTool — lets the LLM proactively message you:

- **Parameters**: `message` (string, required)
- **Clearance**: `["network"]`
- **Behavior**: Sends to `ownerChatId` via `client.sendMessage()`. Fails gracefully if owner chat ID not yet known.

This is how Arc Rhythm prompt results reach you: Cortex processes the rhythm, decides you should know about it, and calls `telegram.send`.

## Module Manifest (`index.ts`)

```typescript
const telegramModule = {
  name: "telegram",
  description: "Telegram bot — chat with Friday from your phone, receive notifications and alerts.",
  version: "1.0.0",
  tools: [telegramSend],
  protocols: [telegramProtocol],
  knowledge: [],
  triggers: [],
  clearance: ["network"],

  async onLoad(context: ModuleContext) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("[Telegram] TELEGRAM_BOT_TOKEN not set — Telegram module inactive.");
      return;
    }

    const client = new TelegramClient(token);
    const listener = new TelegramListener();

    // Restore owner chat ID from persistent storage
    const savedChatId = await context.memory.get<number>("owner_chat_id");
    if (savedChatId) client.setOwnerChatId(savedChatId);

    const ownerId = process.env.TELEGRAM_OWNER_ID ? Number(process.env.TELEGRAM_OWNER_ID) : undefined;
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

    await listener.start(client, cortex, {
      ownerId,
      webhookUrl,
      memory: context.memory,
      audit,
    });

    // Register as notification channel
    // (requires NotificationManager access — wired via runtime)
  },
} satisfies FridayModule;
```

## Cortex Access

The listener needs access to `Cortex` to route messages. Since modules load after Cortex in the boot order, there are two options:

**Option A**: Access Cortex via `FridayRuntime` singleton (if exposed)
**Option B**: Store a reference in module state (getter/setter pattern, same as old Gmail module)

Use **Option B** — module state pattern with `setTelegramCortex()` / `getTelegramCortex()`. The runtime calls `onLoad()` after Cortex is initialized, so we can wire it there. However, the current `ModuleContext` doesn't include `cortex`. We need to either:

1. Expand `ModuleContext` to include a `cortex` reference, or
2. Use the `telegram.send` tool's `ToolContext` for outbound, and register an `onMessage` callback via runtime for inbound

**Recommended**: Expand `ModuleContext` to optionally include `cortex: { chat(msg: string): Promise<string> }` — a minimal interface, not the full Cortex class. This keeps the module decoupled while enabling bidirectional chat. This is a small addition to the interface we just built today.

## Webhook Route in Server

When webhook mode is active, Friday's HTTP server needs to handle `POST /hooks/telegram`. Add a route check in `src/server/index.ts`:

```typescript
if (req.method === "POST" && url.pathname === "/hooks/telegram") {
  return await telegramWebhookHandler(req);
}
```

The `telegramWebhookHandler` is set by the module during `onLoad()` via a shared setter (similar to how the Forge protocol is registered dynamically).

## Env Vars

```
TELEGRAM_BOT_TOKEN=xxx                    # Required — from @BotFather
TELEGRAM_OWNER_ID=123456789              # Optional — restrict to your user ID
TELEGRAM_WEBHOOK_URL=https://friday-hooks.saturday-ai.com/hooks/telegram  # Optional
```

## Owner Chat ID Persistence

The owner's Telegram `chat_id` (needed for proactive notifications) is:
1. Discovered on first message from the owner
2. Persisted to `ScopedMemory` via `context.memory.set("owner_chat_id", chatId)`
3. Restored on boot via `context.memory.get("owner_chat_id")`

This means Friday can send you notifications even after a restart, without you needing to message her first.

## Security

- **Owner-only**: When `TELEGRAM_OWNER_ID` is set, messages from other users are silently dropped
- **First-message discovery**: If not set, Friday logs the user ID so you can configure it
- **Webhook secret**: Use the bot token as the webhook path secret (standard Telegram pattern) — `/hooks/telegram/<token>` prevents unauthorized POSTs
- **No sensitive data in messages**: Cortex clearance system still gates tools

## What Changes in Existing Code

| File | Change |
|------|--------|
| `src/modules/types.ts` | Add optional `cortex` to `ModuleContext` |
| `src/core/runtime.ts` | Pass `cortex` reference in `ModuleContext` at both loading sites |
| `src/server/index.ts` | Add `/hooks/telegram` route for webhook mode |
| `CLAUDE.md` | Add Telegram to module list (7→8), add env vars |
| `README.md` | Add Telegram module docs, protocol commands, env vars |
| `package.json` | Add `grammy` dependency |
| `.env.example` | Already done (TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID) |

## Testing

- Unit test `TelegramClient.sendMessage()` with mocked `bot.api`
- Unit test `TelegramListener` webhook/polling fallback logic
- Unit test `TelegramChannel` notification formatting
- Unit test owner filtering (messages from non-owner dropped)
- Unit test owner chat ID persistence (set/get from ScopedMemory)
- Unit test protocol subcommands (status, send)
- Unit test `telegram.send` tool
- Integration: manually send a message to the bot, verify Cortex response arrives
