import { useState, useEffect, useRef } from "react";
import { PALETTE, FRIDAY_SYNTAX_STYLE, BOLD, DIM } from "../theme.ts";
import type { Message as MessageType } from "../state.ts";

const STREAM_THROTTLE_MS = 150;

/**
 * Throttle a string value during streaming so the markdown parser
 * re-renders at most once every STREAM_THROTTLE_MS instead of on every token.
 * Returns the raw value immediately when not throttling.
 */
function useThrottled(value: string, ms: number, active: boolean): string {
	const [display, setDisplay] = useState<string>(value);
	const valueRef = useRef(value);
	valueRef.current = value;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!active) {
			// Not throttling — sync immediately
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = null;
			setDisplay(value);
			return;
		}
		// Schedule an update if none is pending
		if (!timerRef.current) {
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				setDisplay(valueRef.current);
			}, ms);
		}
	}, [value, ms, active]);

	useEffect(() => () => {
		if (timerRef.current) clearTimeout(timerRef.current);
	}, []);

	return display;
}

/**
 * Strip HTML tags that LLMs commonly emit in markdown responses.
 * OpenTUI's <markdown> component doesn't process embedded HTML,
 * so tags like <br> render as literal text.
 */
function fixLineBreaks(text: string): string {
	return text.replace(/<br\s*\/?>/gi, "\n");
}

function RoleBadge({ label, fg }: { label: string; fg: string }) {
	return (
		<text fg={fg} bg={PALETTE.surfaceLight} attributes={BOLD}>
			{` ${label} `}
		</text>
	);
}

interface MessageProps {
	message: MessageType;
	streaming?: boolean;
}

export function Message({ message, streaming }: MessageProps) {
	const { role, content } = message;

	if (role === "user") {
		return (
			<box flexDirection="column" paddingLeft={1} gap={0} marginBottom={1}>
				<RoleBadge label="You" fg={PALETTE.amberGlow} />
				<box paddingLeft={1}>
					<text
						fg={PALETTE.textPrimary}
						selectable
						selectionBg={PALETTE.selectionBg}
						selectionFg={PALETTE.selectionFg}
					>
						{content}
					</text>
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
					selectable
					selectionBg={PALETTE.selectionBg}
					selectionFg={PALETTE.selectionFg}
				>
					{`──── ${content} ────`}
				</text>
			</box>
		);
	}

	// Assistant messages — badge + rounded bubble with progressive markdown.
	// During streaming: throttled markdown re-renders (every 150ms instead of per-token).
	// On completion: key change forces a fresh <markdown> mount so the final render
	// is always clean — no corrupted state from intermediate partial-markup parses.
	const displayContent = useThrottled(content, STREAM_THROTTLE_MS, !!streaming);

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
				<markdown
					key={streaming ? "stream" : "final"}
					content={fixLineBreaks(streaming ? displayContent : content)}
					syntaxStyle={FRIDAY_SYNTAX_STYLE}
				/>
			</box>
		</box>
	);
}
