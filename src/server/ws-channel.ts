import type {
	NotificationChannel,
	FridayNotification,
} from "../core/notifications.ts";
import type { ServerMessage } from "./protocol.ts";

export type WSSendFn = (msg: ServerMessage) => void;

export class WebSocketNotificationChannel implements NotificationChannel {
	name = "websocket";
	private sendFn: WSSendFn;

	constructor(sendFn: WSSendFn) {
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
