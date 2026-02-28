import type { NotificationChannel, FridayNotification } from "../notifications.ts";
import type { Vox } from "./vox.ts";

export class VoiceChannel implements NotificationChannel {
	name = "voice";

	constructor(private vox: Vox) {}

	async send(notification: FridayNotification): Promise<void> {
		if (notification.level !== "warning" && notification.level !== "alert") return;
		const spoken = `${notification.title}. ${notification.body}`;
		await this.vox.speak(spoken);
	}
}
