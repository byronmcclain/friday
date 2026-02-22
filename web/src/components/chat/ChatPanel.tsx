import { useChatContext } from "../../contexts/ChatContext.tsx";
import { useSessionContext } from "../../contexts/SessionContext.tsx";
import { MessageList } from "./MessageList.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";

export function ChatPanel() {
	const { messages, isThinking, sendMessage } = useChatContext();
	const { sessionState } = useSessionContext();

	return (
		<div className="flex-1 flex flex-col min-w-0">
			<MessageList messages={messages} />
			{isThinking && <ThinkingIndicator />}
			<ChatInput
				onSend={sendMessage}
				disabled={sessionState !== "active"}
			/>
		</div>
	);
}
