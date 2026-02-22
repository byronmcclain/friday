import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard, useTimeline } from "@opentui/react";
import { PALETTE } from "../theme.ts";
import { lerpColor } from "../lib/color-utils.ts";
import type { LogoData } from "../lib/logo-processor.ts";
import type { ParsedLine } from "../lib/ansi-parser.ts";

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
	const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fadingRef = useRef(false);
	const bg = PALETTE.background;

	const timeline = useTimeline();

	const startFade = useCallback(() => {
		if (fadingRef.current) return;
		fadingRef.current = true;

		if (holdTimerRef.current) {
			clearTimeout(holdTimerRef.current);
			holdTimerRef.current = null;
		}

		const target = { progress: 0 };
		timeline.add(target, {
			duration: 1500,
			progress: 1,
			ease: "outQuad",
			onUpdate: () => {
				setFadeProgress(target.progress);
			},
			onComplete: () => {
				onComplete();
			},
		});
		timeline.play();
	}, [timeline, onComplete]);

	// Start 2s hold timer on mount
	useEffect(() => {
		holdTimerRef.current = setTimeout(startFade, 2000);
		return () => {
			if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
		};
	}, [startFade]);

	// Any keypress skips to chat
	useKeyboard(() => {
		onComplete();
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
			<box style={{ flexDirection: "column", alignItems: "center" }}>
				<text fg={subtitleColor}>
					Female Replacement Intelligent Digital Assistant Youth
				</text>
				<text fg={versionColor}>── v0.1.0 ──</text>
			</box>
		</box>
	);
}
