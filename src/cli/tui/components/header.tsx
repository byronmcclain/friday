import { useState, useEffect } from "react";
import { PALETTE, BOLD, DIM } from "../theme.ts";
import { lerpColor } from "../lib/color-utils.ts";

const TITLE_TEXT =
	process.env.FRIDAY_CONTEXT === "browser" ? "F.R.I.D.A.Y." : "◆ F.R.I.D.A.Y.";
const SHIMMER_TICK_MS = 60;
const SHIMMER_RADIUS = 3;
const PAUSE_MS = 4000;

const SWEEP_STEPS = TITLE_TEXT.length + 2 * SHIMMER_RADIUS;
const PAUSE_STEPS = Math.ceil(PAUSE_MS / SHIMMER_TICK_MS);
const CYCLE_STEPS = SWEEP_STEPS + PAUSE_STEPS;

function ShimmerTitle() {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const id = setInterval(() => {
			setTick((t) => (t + 1) % CYCLE_STEPS);
		}, SHIMMER_TICK_MS);
		return () => clearInterval(id);
	}, []);

	// During sweep phase the hot-spot moves left→right; during pause it's offscreen
	const sweepPos = tick < SWEEP_STEPS ? tick - SHIMMER_RADIUS : -999;

	return (
		<text attributes={BOLD}>
			{[...TITLE_TEXT].map((char, i) => {
				const dist = Math.abs(i - sweepPos);
				const t = Math.max(0, 1 - dist / SHIMMER_RADIUS);
				const color = lerpColor(PALETTE.amberPrimary, PALETTE.amberGlow, t);
				return (
					<span key={i} fg={color}>
						{char}
					</span>
				);
			})}
		</text>
	);
}

interface HeaderProps {
	model: string;
}

export function Header({ model }: HeaderProps) {
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
				<ShimmerTitle />
				<text fg={PALETTE.amberDim}>
					{`Grok: ${model}`}
				</text>
			</box>
			<text fg={PALETTE.textMuted} attributes={DIM}>
				{"Female Replacement Intelligent Digital Assistant Youth"}
			</text>
		</box>
	);
}
