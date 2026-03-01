import type { ReactNode } from "react";
import { PALETTE } from "../theme.ts";
import { Message } from "./message.tsx";
import { ThinkingIndicator } from "./thinking.tsx";
import { Welcome } from "./welcome.tsx";
import type { Message as MessageType, WelcomeInfo, ToolInfo } from "../state.ts";

function TurnSeparator() {
	return (
		<box paddingLeft={1} paddingRight={1}>
			<text fg={PALETTE.borderDim}>
				{"─".repeat(60)}
			</text>
		</box>
	);
}

interface ChatAreaProps {
	messages: MessageType[];
	isThinking: boolean;
	isStreaming: boolean;
	welcomeInfo?: WelcomeInfo;
	currentTool?: ToolInfo | null;
}

export function ChatArea({ messages, isThinking, isStreaming, welcomeInfo, currentTool }: ChatAreaProps) {
	const hasUserMessage = messages.some((m) => m.role === "user");

	// Build elements with turn separators between conversation turns
	const elements: ReactNode[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		// Insert separator when transitioning from assistant/system back to user
		if (i > 0 && msg.role === "user") {
			const prev = messages[i - 1]!;
			if (prev.role === "assistant" || prev.role === "system") {
				elements.push(<TurnSeparator key={`sep-${msg.id}`} />);
			}
		}
		// Only the last assistant message can be actively streaming
		const streaming = isStreaming && msg.role === "assistant" && i === messages.length - 1;
		elements.push(<Message key={msg.id} message={msg} streaming={streaming} />);
	}

	return (
		<scrollbox
			flexGrow={1}
			backgroundColor={PALETTE.background}
			border
			borderColor={PALETTE.background}
			focusedBorderColor={PALETTE.background}
			stickyScroll
			stickyStart="bottom"
			wrapperOptions={{ backgroundColor: PALETTE.background }}
			viewportOptions={{ backgroundColor: PALETTE.background }}
			contentOptions={{
				backgroundColor: PALETTE.background,
				flexDirection: "column",
				justifyContent: "flex-end",
				paddingBottom: 1,
			}}
			verticalScrollbarOptions={{
				trackOptions: {
					foregroundColor: PALETTE.amberDim,
					backgroundColor: PALETTE.surface,
				},
				arrowOptions: {
					foregroundColor: PALETTE.copperAccent,
					backgroundColor: PALETTE.surface,
				},
			}}
		>
			{!hasUserMessage && welcomeInfo && (
				<Welcome model={welcomeInfo.model} />
			)}
			{elements}
			{isThinking && <ThinkingIndicator currentTool={currentTool} />}
		</scrollbox>
	);
}
