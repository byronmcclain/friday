import { useCallback, useEffect, useReducer } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	source?: "cortex" | "protocol";
	timestamp: Date;
}

interface ChatState {
	messages: ChatMessage[];
	isThinking: boolean;
	pendingRequestId: string | null;
}

type ChatAction =
	| { type: "send"; message: ChatMessage }
	| { type: "receive"; message: ChatMessage }
	| { type: "thinking"; requestId: string }
	| { type: "done" }
	| { type: "clear" }
	| { type: "load"; messages: ChatMessage[] };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case "send":
			return {
				...state,
				messages: [...state.messages, action.message],
				isThinking: true,
			};
		case "receive":
			return {
				...state,
				messages: [...state.messages, action.message],
				isThinking: false,
				pendingRequestId: null,
			};
		case "thinking":
			return {
				...state,
				isThinking: true,
				pendingRequestId: action.requestId,
			};
		case "done":
			return { ...state, isThinking: false, pendingRequestId: null };
		case "clear":
			return { messages: [], isThinking: false, pendingRequestId: null };
		case "load":
			return {
				messages: action.messages,
				isThinking: false,
				pendingRequestId: null,
			};
		default:
			return state;
	}
}

export function useChat() {
	const { send, subscribe } = useWS();
	const [state, dispatch] = useReducer(chatReducer, {
		messages: [],
		isThinking: false,
		pendingRequestId: null,
	});

	useEffect(() => {
		const unsub1 = subscribe("chat:response", (msg) => {
			const m = msg as Extract<ServerMessage, { type: "chat:response" }>;
			dispatch({
				type: "receive",
				message: {
					id: m.requestId,
					role: "assistant",
					content: m.content,
					source: m.source,
					timestamp: new Date(),
				},
			});
		});

		const unsub2 = subscribe("error", (msg) => {
			const m = msg as Extract<ServerMessage, { type: "error" }>;
			dispatch({
				type: "receive",
				message: {
					id: m.requestId ?? crypto.randomUUID(),
					role: "system",
					content: `Error: ${m.message}`,
					timestamp: new Date(),
				},
			});
		});

		return () => {
			unsub1();
			unsub2();
		};
	}, [subscribe]);

	const sendMessage = useCallback(
		(content: string) => {
			const id = crypto.randomUUID();
			dispatch({
				type: "send",
				message: { id, role: "user", content, timestamp: new Date() },
			});

			if (content.startsWith("/")) {
				send({ type: "protocol", id, command: content });
			} else {
				send({ type: "chat", id, content });
			}
		},
		[send],
	);

	const clearMessages = useCallback(() => dispatch({ type: "clear" }), []);
	const loadMessages = useCallback(
		(msgs: ChatMessage[]) => dispatch({ type: "load", messages: msgs }),
		[],
	);

	return {
		messages: state.messages,
		isThinking: state.isThinking,
		sendMessage,
		clearMessages,
		loadMessages,
	};
}
