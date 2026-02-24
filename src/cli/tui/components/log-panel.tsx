import { PALETTE } from "../theme.ts";
import type { LogLevel, LogEntry } from "../log-types.ts";
import { LOG_ICONS } from "../log-types.ts";

export function formatTimestamp(date: Date): string {
	const h = String(date.getHours()).padStart(2, "0");
	const m = String(date.getMinutes()).padStart(2, "0");
	const s = String(date.getSeconds()).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

export function levelIcon(level: LogLevel): string {
	return LOG_ICONS[level];
}

const LEVEL_COLORS: Record<LogLevel, string> = {
	info: PALETTE.amberPrimary,
	success: PALETTE.success,
	warning: PALETTE.warning,
	error: PALETTE.error,
};

export function levelColor(level: LogLevel): string {
	return LEVEL_COLORS[level];
}

interface LogPanelProps {
	entries: LogEntry[];
	width: number;
}

export function LogPanel({ entries, width }: LogPanelProps) {
	return (
		<box
			width={width}
			height="100%"
			flexDirection="column"
			backgroundColor={PALETTE.surface}
			border={["left"]}
			borderColor={PALETTE.borderDim}
		>
			<text fg={PALETTE.amberDim}>{" LOGS " + "─".repeat(Math.max(0, width - 8))}</text>
			<scrollbox
				flexGrow={1}
				backgroundColor={PALETTE.surface}
				border={false}
				stickyScroll
				stickyStart="bottom"
				contentOptions={{
					backgroundColor: PALETTE.surface,
					flexDirection: "column",
				}}
			>
				{entries.map((entry) => (
					<text key={entry.id}>
						<span fg={PALETTE.textMuted}>{formatTimestamp(entry.timestamp)}</span>
						<span>{" "}</span>
						<span fg={PALETTE.amberDim}>{`[${entry.source}]`}</span>
						<span>{" "}</span>
						<span fg={levelColor(entry.level)}>{levelIcon(entry.level)}</span>
						<span>{" "}</span>
						<span fg={PALETTE.textPrimary}>{entry.message}</span>
						{entry.detail ? <span fg={PALETTE.textMuted}>{` — ${entry.detail}`}</span> : null}
					</text>
				))}
			</scrollbox>
		</box>
	);
}
