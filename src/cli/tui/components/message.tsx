import { createTextAttributes } from "@opentui/core";
import { PALETTE, FRIDAY_SYNTAX_STYLE } from "../theme.ts";
import type { Message as MessageType } from "../state.ts";

const BOLD = createTextAttributes({ bold: true });

interface MessageProps {
	message: MessageType;
}

export function Message({ message }: MessageProps) {
	const { role, content } = message;

	if (role === "user") {
		return (
			<box flexDirection="row" gap={1} paddingLeft={1}>
				<text fg={PALETTE.amberGlow} attributes={BOLD}>
					You:
				</text>
				<text fg={PALETTE.textPrimary}>{content}</text>
			</box>
		);
	}

	if (role === "system") {
		const isError =
			content.toLowerCase().startsWith("error") ||
			content.toLowerCase().startsWith("boot failed");
		return (
			<box paddingLeft={1}>
				<text fg={isError ? PALETTE.error : PALETTE.textMuted}>
					{content}
				</text>
			</box>
		);
	}

	// Assistant messages — <markdown> renders full markdown with syntax highlighting
	return (
		<box flexDirection="column" paddingLeft={1} gap={0}>
			<text fg={PALETTE.amberPrimary} attributes={BOLD}>
				Friday:
			</text>
			<box paddingLeft={2}>
				<markdown content={content} syntaxStyle={FRIDAY_SYNTAX_STYLE} />
			</box>
		</box>
	);
}
