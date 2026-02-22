import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
	useWebSocket,
	type ConnectionState,
} from "../hooks/useWebSocket.ts";
import type { ClientMessage, ServerMessage } from "@friday/server/protocol.ts";

interface WebSocketContextValue {
	state: ConnectionState;
	connect: () => void;
	disconnect: () => void;
	send: (msg: ClientMessage) => void;
	subscribe: (
		type: string,
		handler: (msg: ServerMessage) => void,
	) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({
	url,
	children,
}: { url: string; children: ReactNode }) {
	const ws = useWebSocket(url);

	const value = useMemo(
		() => ({
			state: ws.state,
			connect: ws.connect,
			disconnect: ws.disconnect,
			send: ws.send,
			subscribe: ws.subscribe,
		}),
		[ws.state, ws.connect, ws.disconnect, ws.send, ws.subscribe],
	);

	return (
		<WebSocketContext.Provider value={value}>
			{children}
		</WebSocketContext.Provider>
	);
}

export function useWS(): WebSocketContextValue {
	const ctx = useContext(WebSocketContext);
	if (!ctx) throw new Error("useWS must be used within WebSocketProvider");
	return ctx;
}
