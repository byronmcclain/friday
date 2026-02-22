import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface ConversationSummary {
	id: string;
	startedAt: string;
	provider: string;
	model: string;
	messageCount: number;
}

export function useHistory() {
	const { send, subscribe } = useWS();
	const [sessions, setSessions] = useState<ConversationSummary[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const unsub1 = subscribe("history:result", (msg) => {
			const m = msg as Extract<
				ServerMessage,
				{ type: "history:result" }
			>;
			if (Array.isArray(m.data)) {
				setSessions(
					m.data.map((s: any) => ({
						id: s.id,
						startedAt:
							s.startedAt instanceof Date
								? s.startedAt.toISOString()
								: String(s.startedAt),
						provider: s.provider,
						model: s.model,
						messageCount: s.messages?.length ?? 0,
					})),
				);
			}
			setLoading(false);
		});

		const unsub2 = subscribe("error", () => {
			setLoading(false);
		});

		return () => {
			unsub1();
			unsub2();
		};
	}, [subscribe]);

	const fetchHistory = useCallback(
		(count = 20) => {
			setLoading(true);
			send({ type: "history:list", id: crypto.randomUUID(), count });
		},
		[send],
	);

	const loadSession = useCallback(
		(sessionId: string) => {
			send({
				type: "history:load",
				id: crypto.randomUUID(),
				sessionId,
			});
		},
		[send],
	);

	return { sessions, loading, fetchHistory, loadSession };
}
