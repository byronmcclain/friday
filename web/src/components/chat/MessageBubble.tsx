import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../../hooks/useChat.ts";

export function MessageBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const isSystem = message.role === "system";

	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
			<div
				className={`max-w-[80%] rounded-lg px-4 py-3 ${
					isUser
						? "bg-friday-amber/15 border border-friday-amber-dim/40 text-friday-text"
						: isSystem
							? "bg-friday-error/10 border border-friday-error/30 text-friday-text"
							: "bg-friday-surface border border-friday-amber-dim/20 text-friday-text"
				}`}
			>
				<div className="text-xs text-friday-text-dim mb-1">
					{isUser ? "You" : isSystem ? "System" : "Friday"}
					{message.source === "protocol" && (
						<span className="ml-2 text-friday-copper">[protocol]</span>
					)}
				</div>
				{isUser ? (
					<p className="whitespace-pre-wrap">{message.content}</p>
				) : (
					<div className="prose prose-invert prose-sm max-w-none [&_code]:text-friday-amber-light [&_a]:text-friday-amber [&_strong]:text-friday-text">
						<ReactMarkdown>{message.content}</ReactMarkdown>
					</div>
				)}
			</div>
		</div>
	);
}
