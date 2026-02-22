import { useCallback, useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";
import type { ProviderName } from "@friday/core/types.ts";

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
	const { send, subscribe, state: wsState } = useWS();
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

		const unsub3 = subscribe("error", (msg) => {
			const m = msg as Extract<ServerMessage, { type: "error" }>;
			if (m.code === "ALREADY_BOOTED") {
				setSessionState("active");
			}
		});

		return () => {
			unsub1();
			unsub2();
			unsub3();
		};
	}, [subscribe]);

	const boot = useCallback(
		(options?: {
			provider?: ProviderName;
			model?: string;
			fresh?: boolean;
		}) => {
			if (wsState !== "connected") {
				console.warn("Cannot boot: WebSocket not connected");
				return;
			}
			setSessionState("booting");
			send({
				type: "session:boot",
				id: crypto.randomUUID(),
				provider: options?.provider,
				model: options?.model,
				fresh: options?.fresh,
			});
		},
		[send, wsState],
	);

	const shutdown = useCallback(() => {
		setSessionState("shutting-down");
		send({ type: "session:shutdown", id: crypto.randomUUID() });
	}, [send]);

	return { sessionState, sessionInfo, boot, shutdown, wsState };
}
