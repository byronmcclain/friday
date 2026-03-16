import type {
	FridayProtocol,
	ProtocolContext,
	ProtocolResult,
} from "../types.ts";
import { getTelegramClient, getTelegramListener } from "./state.ts";

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
