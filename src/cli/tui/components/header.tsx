import { createTextAttributes } from "@opentui/core";
import { PALETTE } from "../theme.ts";

const BOLD = createTextAttributes({ bold: true });

interface HeaderProps {
	provider: string;
	model: string;
}

export function Header({ provider, model }: HeaderProps) {
	return (
		<box
			flexDirection="row"
			justifyContent="space-between"
			width="100%"
			height={1}
			border={["bottom"]}
			borderColor={PALETTE.copperAccent}
		>
			<text fg={PALETTE.amberPrimary} attributes={BOLD}>
				{" F.R.I.D.A.Y."}
			</text>
			<text fg={PALETTE.amberDim}>
				{`${provider}: ${model} `}
			</text>
		</box>
	);
}
