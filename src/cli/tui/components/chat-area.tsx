import { PALETTE } from "../theme.ts";
import { Message } from "./message.tsx";
import { ThinkingIndicator } from "./thinking.tsx";
import type { Message as MessageType } from "../state.ts";

interface ChatAreaProps {
	messages: MessageType[];
	isThinking: boolean;
}

export function ChatArea({ messages, isThinking }: ChatAreaProps) {
	return (
		<scrollbox
			flexGrow={1}
			flexDirection="column"
			backgroundColor={PALETTE.background}
			gap={1}
			paddingTop={1}
			paddingBottom={1}
			stickyScroll
			stickyStart="bottom"
			focused
		>
			{messages.map((msg) => (
				<Message key={msg.id} message={msg} />
			))}
			{isThinking && <ThinkingIndicator />}
		</scrollbox>
	);
}
