import { PALETTE, BOLD, DIM } from "../theme.ts";

interface WelcomeProps {
	model: string;
}

export function Welcome({ model }: WelcomeProps) {
	return (
		<box
			border
			borderStyle="rounded"
			borderColor={PALETTE.copperAccent}
			backgroundColor={PALETTE.surface}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			marginLeft={2}
			marginRight={2}
		>
			<text fg={PALETTE.amberGlow} attributes={BOLD}>
				{"Welcome back, boss."}
			</text>
			<text fg={PALETTE.textMuted}>
				{`Model: ${model}`}
			</text>
			<text fg={PALETTE.textMuted} attributes={DIM}>
				{"Type a message or /command to get started."}
			</text>
		</box>
	);
}
