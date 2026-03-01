import { useState, useEffect } from "react";
import { PALETTE, DIM } from "../theme.ts";
import { CommandTypeahead } from "./command-typeahead.tsx";
import type { TypeaheadEntry } from "../filter-commands.ts";
import { usePulse } from "../lib/use-pulse.ts";
import { lerpColor } from "../lib/color-utils.ts";
import { freemem, totalmem, loadavg, cpus } from "node:os";

interface InputBarProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	isThinking: boolean;
	isStreaming: boolean;
}

const CORE_COUNT = cpus().length;
const STATS_INTERVAL_MS = 5000;
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour12: false,
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
};

interface SystemStats {
	memFree: number;
	memTotal: number;
	loadAvg: number;
}

function readStats(): SystemStats {
	return {
		memFree: freemem(),
		memTotal: totalmem(),
		loadAvg: loadavg()[0] ?? 0,
	};
}

function StatusRow() {
	const [now, setNow] = useState(() => new Date());
	const [stats, setStats] = useState<SystemStats>(readStats);

	useEffect(() => {
		const clock = setInterval(() => setNow(new Date()), 1000);
		const sysStats = setInterval(() => setStats(readStats()), STATS_INTERVAL_MS);
		return () => {
			clearInterval(clock);
			clearInterval(sysStats);
		};
	}, []);

	const time = now.toLocaleTimeString("en-US", TIME_FORMAT);
	const memUsed = stats.memTotal - stats.memFree;
	const memUsedGB = (memUsed / 1073741824).toFixed(1);
	const memTotalGB = (stats.memTotal / 1073741824).toFixed(1);
	const memPercent = Math.round((memUsed / stats.memTotal) * 100);
	const cpuPercent = Math.min(
		100,
		Math.round((stats.loadAvg / CORE_COUNT) * 100),
	);

	const cpuColor =
		cpuPercent > 80
			? PALETTE.error
			: cpuPercent > 50
				? PALETTE.warning
				: PALETTE.textMuted;
	const memColor =
		memPercent > 85
			? PALETTE.error
			: memPercent > 70
				? PALETTE.warning
				: PALETTE.textMuted;

	return (
		<box
			flexDirection="row"
			paddingLeft={1}
			paddingRight={1}
			justifyContent="space-between"
			width="100%"
		>
			<text fg={PALETTE.textMuted} attributes={DIM}>
				{time}
			</text>
			<box flexDirection="row" gap={1}>
				<text fg={PALETTE.borderDim} attributes={DIM}>
					{"│"}
				</text>
				<text fg={cpuColor} attributes={DIM}>
					{`CPU ${cpuPercent}%`}
				</text>
				<text fg={PALETTE.borderDim} attributes={DIM}>
					{"│"}
				</text>
				<text fg={memColor} attributes={DIM}>
					{`MEM ${memUsedGB}/${memTotalGB} GB`}
				</text>
			</box>
		</box>
	);
}

export function InputBar({
	commands,
	disabled,
	placeholder,
	onSubmit,
	onExit,
	isThinking,
	isStreaming,
}: InputBarProps) {
	const borderPulse = usePulse(isThinking, 2400);

	const borderColor = isThinking
		? lerpColor(PALETTE.amberDim, PALETTE.copperAccent, borderPulse)
		: isStreaming
			? PALETTE.amberGlow
			: PALETTE.copperAccent;

	return (
		<box
			flexShrink={0}
			flexDirection="column"
			border={["top"]}
			borderColor={borderColor}
			backgroundColor={PALETTE.background}
			width="100%"
			paddingBottom={1}
		>
			<StatusRow />
			<box paddingLeft={2} paddingRight={1}>
				<CommandTypeahead
					commands={commands}
					disabled={disabled}
					placeholder={placeholder}
					onSubmit={onSubmit}
					onExit={onExit}
					isThinking={isThinking}
					isStreaming={isStreaming}
				/>
			</box>
		</box>
	);
}
