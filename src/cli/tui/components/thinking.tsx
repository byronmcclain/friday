import { useState, useEffect } from "react";
import { PALETTE, BOLD } from "../theme.ts";

const BRAILLE_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function ThinkingIndicator() {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame((f: number) => (f + 1) % BRAILLE_FRAMES.length);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	return (
		<box flexDirection="column" paddingLeft={1} gap={0}>
			<text fg={PALETTE.amberPrimary} bg={PALETTE.surfaceLight} attributes={BOLD}>
				{" Friday "}
			</text>
			<box paddingLeft={1}>
				<text fg={PALETTE.amberDim}>
					{`${BRAILLE_FRAMES[frame]} thinking...`}
				</text>
			</box>
		</box>
	);
}
