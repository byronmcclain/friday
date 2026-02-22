import { useState, useEffect } from "react";
import { createTextAttributes } from "@opentui/core";
import { PALETTE } from "../theme.ts";

const BOLD = createTextAttributes({ bold: true });

export function ThinkingIndicator() {
	const [dots, setDots] = useState(".");

	useEffect(() => {
		const interval = setInterval(() => {
			setDots((d: string) => (d.length >= 3 ? "." : `${d}.`));
		}, 400);
		return () => clearInterval(interval);
	}, []);

	return (
		<box flexDirection="row" gap={1} paddingLeft={1}>
			<text fg={PALETTE.amberPrimary} attributes={BOLD}>
				Friday:
			</text>
			<text fg={PALETTE.amberDim}>{`thinking${dots}`}</text>
		</box>
	);
}
