import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SmartEntry {
	name: string;
	domain: string;
	tags: string[];
	confidence: number;
	source: string;
}

export function useSmarts() {
	const { send, subscribe } = useWS();
	const [entries, setEntries] = useState<SmartEntry[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const unsub1 = subscribe("smarts:result", (msg) => {
			const m = msg as Extract<
				ServerMessage,
				{ type: "smarts:result" }
			>;
			if (Array.isArray(m.data)) {
				setEntries(
					m.data.map((e: any) => ({
						name: e.name,
						domain: e.domain,
						tags: e.tags ?? [],
						confidence: e.confidence,
						source: e.source,
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

	const fetchList = useCallback(() => {
		setLoading(true);
		send({ type: "smarts:list", id: crypto.randomUUID() });
	}, [send]);

	const search = useCallback(
		(query: string) => {
			setLoading(true);
			send({ type: "smarts:search", id: crypto.randomUUID(), query });
		},
		[send],
	);

	return { entries, loading, fetchList, search };
}
