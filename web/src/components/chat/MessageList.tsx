import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble.tsx";
import type { ChatMessage } from "../../hooks/useChat.ts";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
	const bottomRef = useRef<HTMLDivElement>(null);

	const lastMessageId = messages[messages.length - 1]?.id;
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [lastMessageId]);

	if (messages.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center text-friday-text-muted">
				<p>Hey boss! What can I help you with?</p>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto px-4 py-4">
			{messages.map((msg) => (
				<MessageBubble key={msg.id} message={msg} />
			))}
			<div ref={bottomRef} />
		</div>
	);
}
