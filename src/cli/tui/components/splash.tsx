import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { PALETTE } from "../theme.ts";
import { lerpColor } from "../lib/color-utils.ts";
import type { LogoData } from "../lib/logo-processor.ts";
import type { ParsedLine } from "../lib/ansi-parser.ts";
import { version } from "../../../../package.json";

const HOLD_MS = 2000;
const FADE_MS = 1500;
const TICK_MS = 50;

// outQuad easing: decelerating curve
function outQuad(t: number): number {
	return t * (2 - t);
}

interface SplashScreenProps {
	logoData: LogoData;
	onComplete: () => void;
}

function FadedLine({
	spans,
	fadeProgress,
	bg,
}: {
	spans: ParsedLine;
	fadeProgress: number;
	bg: string;
}) {
	return (
		<text>
			{spans.map((s, i) => (
				<span
					key={i}
					fg={s.fg ? lerpColor(s.fg, bg, fadeProgress) : undefined}
					bg={s.bg ? lerpColor(s.bg, bg, fadeProgress) : undefined}
				>
					{s.text}
				</span>
			))}
		</text>
	);
}

export function SplashScreen({ logoData, onComplete }: SplashScreenProps) {
	const [fadeProgress, setFadeProgress] = useState(0);
	const onCompleteRef = useRef(onComplete);
	onCompleteRef.current = onComplete;
	const bg = PALETTE.background;

	// Hold for HOLD_MS, then fade over FADE_MS using setInterval
	useEffect(() => {
		let fadeInterval: ReturnType<typeof setInterval> | null = null;

		const holdTimer = setTimeout(() => {
			const start = Date.now();
			fadeInterval = setInterval(() => {
				const elapsed = Date.now() - start;
				const t = Math.min(1, elapsed / FADE_MS);
				setFadeProgress(outQuad(t));
				if (t >= 1) {
					if (fadeInterval) clearInterval(fadeInterval);
					onCompleteRef.current();
				}
			}, TICK_MS);
		}, HOLD_MS);

		return () => {
			clearTimeout(holdTimer);
			if (fadeInterval) clearInterval(fadeInterval);
		};
	}, []);

	// Any keypress skips to chat
	useKeyboard(() => {
		onCompleteRef.current();
	});

	// Fade the ASCIIFont title color
	const titleColor = lerpColor(PALETTE.amberPrimary, bg, fadeProgress);
	const subtitleColor = lerpColor(PALETTE.amberDim, bg, fadeProgress);
	const versionColor = lerpColor(PALETTE.textMuted, bg, fadeProgress);

	return (
		<box
			style={{
				width: "100%",
				height: "100%",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: bg,
				gap: 1,
			}}
		>
			{/* Logo */}
			<box style={{ flexDirection: "column", alignItems: "center" }}>
				{logoData.parsedLines.map((spans, i) => (
					<FadedLine
						key={`l-${i}`}
						spans={spans}
						fadeProgress={fadeProgress}
						bg={bg}
					/>
				))}
			</box>

			{/* Title */}
			<ascii-font text="F.R.I.D.A.Y." font="block" color={titleColor} />

			{/* Subtitle */}
			<box style={{ flexDirection: "column", alignItems: "center", overflow: "hidden" }}>
				<text fg={subtitleColor} wrapMode="none">
					Female Replacement Intelligent Digital Assistant Youth
				</text>
				<text fg={versionColor} wrapMode="none">{`── v${version} ──`}</text>
			</box>
		</box>
	);
}
