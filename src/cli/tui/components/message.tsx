import { PALETTE, FRIDAY_SYNTAX_STYLE, BOLD, DIM } from "../theme.ts";
import type { Message as MessageType } from "../state.ts";

function RoleBadge({ label, fg }: { label: string; fg: string }) {
	return (
		<text fg={fg} bg={PALETTE.surfaceLight} attributes={BOLD}>
			{` ${label} `}
		</text>
	);
}

interface MessageProps {
	message: MessageType;
}

export function Message({ message }: MessageProps) {
	const { role, content } = message;

	if (role === "user") {
		return (
			<box flexDirection="column" paddingLeft={1} gap={0} marginBottom={1}>
				<RoleBadge label="You" fg={PALETTE.amberGlow} />
				<box paddingLeft={1}>
					<text fg={PALETTE.textPrimary}>{content}</text>
				</box>
			</box>
		);
	}

	if (role === "system") {
		const isError =
			content.toLowerCase().startsWith("error") ||
			content.toLowerCase().startsWith("boot failed");
		return (
			<box paddingLeft={1}>
				<text
					fg={isError ? PALETTE.error : PALETTE.amberDim}
					attributes={DIM}
				>
					{`──── ${content} ────`}
				</text>
			</box>
		);
	}

	// Assistant messages — badge + rounded bubble with markdown
	return (
		<box flexDirection="column" paddingLeft={1} gap={0} marginTop={1}>
			<RoleBadge label="Friday" fg={PALETTE.amberPrimary} />
			<box
				border
				borderStyle="rounded"
				borderColor={PALETTE.copperAccent}
				backgroundColor={PALETTE.surface}
				paddingLeft={1}
				paddingRight={1}
				marginLeft={1}
			>
				<markdown content={content} syntaxStyle={FRIDAY_SYNTAX_STYLE} />
			</box>
		</box>
	);
}
