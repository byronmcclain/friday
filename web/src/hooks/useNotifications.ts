import { useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface NotificationItem {
	id: string;
	level: "info" | "warning" | "alert";
	title: string;
	body: string;
	source: string;
	timestamp: Date;
}

export function useNotifications() {
	const { subscribe } = useWS();
	const [notifications, setNotifications] = useState<NotificationItem[]>([]);

	useEffect(() => {
		const unsub = subscribe("notification", (msg) => {
			const m = msg as Extract<
				ServerMessage,
				{ type: "notification" }
			>;
			setNotifications((prev) =>
				[
					{
						id: crypto.randomUUID(),
						level: m.level,
						title: m.title,
						body: m.body,
						source: m.source,
						timestamp: new Date(),
					},
					...prev,
				].slice(0, 100),
			);
		});
		return unsub;
	}, [subscribe]);

	return { notifications };
}
