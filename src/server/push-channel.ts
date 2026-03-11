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
