import type {
	NotificationChannel,
	FridayNotification,
} from "../../../core/notifications.ts";

export type ToastCallback = (
	level: FridayNotification["level"],
	text: string,
) => void;

export class TuiChannel implements NotificationChannel {
	name = "tui";

	constructor(private onNotify: ToastCallback) {}

	async send(notification: FridayNotification): Promise<void> {
		this.onNotify(
			notification.level,
			`${notification.title}: ${notification.body}`,
		);
	}
}
