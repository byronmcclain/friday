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
