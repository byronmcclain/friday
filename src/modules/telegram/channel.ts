import type { FridayNotification, NotificationChannel } from "../../core/notifications.ts";
import type { TelegramClient } from "./client.ts";

const LEVEL_EMOJI: Record<string, string> = {
	info: "\u2139\uFE0F",
	warning: "\u26A0\uFE0F",
	alert: "\uD83D\uDEA8",
};

export class TelegramChannel implements NotificationChannel {
	name = "telegram";

	constructor(private client: TelegramClient) {}

	async send(notification: FridayNotification): Promise<void> {
		const chatId = this.client.getOwnerChatId();
		if (!chatId) return;

		const emoji = LEVEL_EMOJI[notification.level] ?? "";
		const text = `${emoji} **${notification.title}**\n${notification.body}`;
		await this.client.sendMessage(chatId, text);
	}
}
