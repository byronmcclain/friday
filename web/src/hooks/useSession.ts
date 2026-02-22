import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SessionInfo {
	provider: string;
	model: string;
}

export type SessionState =
	| "disconnected"
	| "booting"
	| "active"
	| "shutting-down";

export function useSession() {
	const { send, subscribe, state: wsState, connect } = useWS();
	const [sessionState, setSessionState] =
		useState<SessionState>("disconnected");
	const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);

	useEffect(() => {
		const unsub1 = subscribe("session:booted", (msg) => {
			const m = msg as Extract<
				ServerMessage,
				{ type: "session:booted" }
			>;
			setSessionState("active");
			setSessionInfo({ provider: m.provider, model: m.model });
		});

		const unsub2 = subscribe("session:closed", () => {
			setSessionState("disconnected");
			setSessionInfo(null);
		});

		return () => {
			unsub1();
			unsub2();
		};
	}, [subscribe]);

	const boot = useCallback(
		(options?: {
			provider?: string;
			model?: string;
			fresh?: boolean;
		}) => {
			if (wsState !== "connected") {
				connect();
			}
			setSessionState("booting");
			send({
				type: "session:boot",
				id: crypto.randomUUID(),
				provider: options?.provider as any,
				model: options?.model,
				fresh: options?.fresh,
			});
		},
		[send, wsState, connect],
	);

	const shutdown = useCallback(() => {
		setSessionState("shutting-down");
		send({ type: "session:shutdown", id: crypto.randomUUID() });
	}, [send]);

	return { sessionState, sessionInfo, boot, shutdown, wsState };
}
