import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@friday/server/protocol.ts";

export type ConnectionState =
	| "connecting"
	| "connected"
	| "disconnected"
	| "reconnecting";

type MessageHandler = (msg: ServerMessage) => void;

export function useWebSocket(url: string) {
	const wsRef = useRef<WebSocket | null>(null);
	const [state, setState] = useState<ConnectionState>("disconnected");
	const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
	const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const reconnectDelay = useRef(1000);

	const connect = useCallback(() => {
		if (
			wsRef.current?.readyState === WebSocket.OPEN ||
			wsRef.current?.readyState === WebSocket.CONNECTING
		)
			return;

		setState("connecting");
		const ws = new WebSocket(url);

		ws.onopen = () => {
			setState("connected");
			reconnectDelay.current = 1000;
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data as string) as ServerMessage;
				const typeHandlers = handlersRef.current.get(msg.type);
				if (typeHandlers) {
					for (const handler of typeHandlers) handler(msg);
				}
				const allHandlers = handlersRef.current.get("*");
				if (allHandlers) {
					for (const handler of allHandlers) handler(msg);
				}
			} catch {
				// Ignore non-JSON messages
			}
		};

		ws.onclose = () => {
			setState("reconnecting");
			reconnectRef.current = setTimeout(() => {
				reconnectDelay.current = Math.min(
					reconnectDelay.current * 2,
					30000,
				);
				connect();
			}, reconnectDelay.current);
		};

		ws.onerror = () => {
			ws.close();
		};

		wsRef.current = ws;
	}, [url]);

	const disconnect = useCallback(() => {
		if (reconnectRef.current) clearTimeout(reconnectRef.current);
		wsRef.current?.close();
		wsRef.current = null;
		setState("disconnected");
	}, []);

	const send = useCallback((msg: ClientMessage): boolean => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(msg));
			return true;
		}
		console.warn("WebSocket not open, dropping message:", msg.type);
		return false;
	}, []);

	const subscribe = useCallback(
		(type: string, handler: MessageHandler) => {
			if (!handlersRef.current.has(type)) {
				handlersRef.current.set(type, new Set());
			}
			handlersRef.current.get(type)!.add(handler);
			return () => {
				handlersRef.current.get(type)?.delete(handler);
			};
		},
		[],
	);

	useEffect(() => {
		return () => {
			if (reconnectRef.current) clearTimeout(reconnectRef.current);
			if (wsRef.current) {
				wsRef.current.onclose = null;
				wsRef.current.onerror = null;
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, []);

	return { state, connect, disconnect, send, subscribe };
}
