import { useState, useEffect } from "react";
import { PALETTE, BOLD } from "../theme.ts";

const BRAILLE_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

interface ThinkingProps {
	currentTool?: { name: string; args: Record<string, unknown> } | null;
}

function formatToolSummary(name: string, args: Record<string, unknown>): string {
	for (const v of Object.values(args)) {
		if (typeof v === "string" && v.length > 0) {
			const display = v.length > 50 ? v.slice(0, 47) + "..." : v;
			return `${name} ${display}`;
		}
	}
	return name;
}

export function ThinkingIndicator({ currentTool }: ThinkingProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame((f: number) => (f + 1) % BRAILLE_FRAMES.length);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	const label = currentTool
		? formatToolSummary(currentTool.name, currentTool.args)
		: "thinking...";

	return (
		<box flexDirection="column" paddingLeft={1} gap={0}>
			<text fg={PALETTE.amberPrimary} bg={PALETTE.surfaceLight} attributes={BOLD}>
				{" Friday "}
			</text>
			<box paddingLeft={1}>
				<text fg={PALETTE.amberDim}>
					{`${BRAILLE_FRAMES[frame]} ${label}`}
				</text>
			</box>
		</box>
	);
}

export { formatToolSummary };
