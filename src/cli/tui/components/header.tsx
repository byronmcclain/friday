import { PALETTE, BOLD, DIM } from "../theme.ts";

interface HeaderProps {
	provider: string;
	model: string;
}

export function Header({ provider, model }: HeaderProps) {
	return (
		<box
			flexDirection="column"
			width="100%"
			flexShrink={0}
			border={["bottom"]}
			borderStyle="double"
			borderColor={PALETTE.copperAccent}
			backgroundColor={PALETTE.surface}
			paddingLeft={1}
			paddingRight={1}
		>
			<box flexDirection="row" justifyContent="space-between" width="100%">
				<text fg={PALETTE.amberPrimary} attributes={BOLD}>
					{"◆ F.R.I.D.A.Y."}
				</text>
				<text fg={PALETTE.amberDim}>
					{`${provider}: ${model}`}
				</text>
			</box>
			<text fg={PALETTE.textMuted} attributes={DIM}>
				{"Female Replacement Intelligent Digital Assistant Youth"}
			</text>
		</box>
	);
}
