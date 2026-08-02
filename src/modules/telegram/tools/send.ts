import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getTelegramClient } from "../state.ts";

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
	async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
		const message = args.message as string;
		if (!message) {
			return { success: false, output: "Missing required parameter: message" };
		}

		const client = getTelegramClient();
		if (!client) {
			return {
				success: false,
				output: "Telegram module not active. Set TELEGRAM_BOT_TOKEN.",
			};
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
