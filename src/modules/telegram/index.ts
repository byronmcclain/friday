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

		// Send session separator to owner on Telegram so they know context is fresh
		const chatId = client.getOwnerChatId();
		if (chatId) {
			client.sendMessage(
				chatId,
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 *Friday restarted — new session*\n_My active context is fresh, but I can recall past conversations via memory._\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			).catch(() => {}); // Fire-and-forget — don't block boot if Telegram is unreachable
		}
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
