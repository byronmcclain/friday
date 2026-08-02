import { webhookCallback } from "grammy";
import type { AuditLogger } from "../../audit/logger.ts";
import type { ScopedMemory } from "../../core/memory.ts";
import type { TelegramClient } from "./client.ts";

export interface ListenerConfig {
	ownerId?: number;
	webhookUrl?: string;
	memory: ScopedMemory;
	audit?: AuditLogger;
}

export type BroadcastFn = (role: "user" | "assistant", content: string, source: "telegram") => void;

export class TelegramListener {
	private mode: "webhook" | "polling" | "stopped" = "stopped";
	private webhookHandler: ((req: Request) => Response | Promise<Response>) | null = null;
	private pollingDone: Promise<void> | null = null;
	private broadcast: BroadcastFn | null = null;

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
				audit?.log({
					action: "telegram:no-owner-warning",
					source: "telegram",
					detail: `Message from user ${ctx.from.id} — set TELEGRAM_OWNER_ID to lock access`,
					success: true,
				});
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

			// Broadcast user message to other clients (TUI, web)
			this.broadcast?.("user", ctx.message.text, "telegram");

			const response = await cortex.chat(ctx.message.text);
			await ctx.reply(response, { parse_mode: "Markdown" });

			// Broadcast assistant response to other clients
			this.broadcast?.("assistant", response, "telegram");

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
				let secretToken = await config.memory.get<string>("webhook_secret");
				if (!secretToken) {
					secretToken = crypto.randomUUID();
					await config.memory.set("webhook_secret", secretToken);
				}

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
		this.pollingDone = bot.start().catch((err) => {
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
			await this.pollingDone;
			this.pollingDone = null;
		} else if (this.mode === "webhook") {
			await client.getBot().api.deleteWebhook();
		}
		this.mode = "stopped";
		this.webhookHandler = null;
	}

	/** Set the broadcast function — called by the server after boot to wire SessionHub. */
	setBroadcast(fn: BroadcastFn): void {
		this.broadcast = fn;
	}

	getMode(): "webhook" | "polling" | "stopped" {
		return this.mode;
	}

	getWebhookHandler(): ((req: Request) => Response | Promise<Response>) | null {
		return this.webhookHandler;
	}
}
