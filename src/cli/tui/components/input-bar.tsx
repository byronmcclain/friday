import { useState, useEffect } from "react";
import { PALETTE, DIM } from "../theme.ts";
import { CommandTypeahead } from "./command-typeahead.tsx";
import type { TypeaheadEntry } from "../filter-commands.ts";
import { usePulse } from "../lib/use-pulse.ts";
import { lerpColor } from "../lib/color-utils.ts";
import { freemem, totalmem, platform } from "node:os";
import {
	parseVmStatMemory,
	getCpuTimes,
	type CpuTimes,
} from "../../../sensorium/sensors.ts";

interface InputBarProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	isThinking: boolean;
	isStreaming: boolean;
}

const STATS_INTERVAL_MS = 5000;
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour12: false,
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
};

interface SystemStats {
	memUsed: number;
	memTotal: number;
	cpuPercent: number;
}

// Module-level previous CPU sample for tick-delta calculation
let prevCpuTimes: CpuTimes | undefined;

function readStatsSync(): SystemStats {
	// Capture initial CPU sample — first reading always shows 0%
	prevCpuTimes = getCpuTimes();
	return {
		memUsed: totalmem() - freemem(),
		memTotal: totalmem(),
		cpuPercent: 0,
	};
}

async function readStatsAsync(): Promise<SystemStats> {
	// CPU: tick delta between samples (same method as Sensorium)
	const currentTimes = getCpuTimes();
	let cpuPercent = 0;
	if (prevCpuTimes) {
		const idleDelta = currentTimes.idle - prevCpuTimes.idle;
		const totalDelta = currentTimes.total - prevCpuTimes.total;
		if (totalDelta > 0) {
			cpuPercent = Math.round((1 - idleDelta / totalDelta) * 100);
		}
	}
	prevCpuTimes = currentTimes;

	// Memory: vm_stat on macOS, os.freemem() elsewhere
	const total = totalmem();
	let memUsed = total - freemem();
	if (platform() === "darwin") {
		try {
			const result = await Bun.$`vm_stat`.quiet().nothrow();
			if (result.exitCode === 0) {
				const parsed = parseVmStatMemory(result.stdout.toString(), total);
				if (parsed) {
					memUsed = parsed.used;
				}
			}
		} catch {
			// vm_stat failed — keep naive value
		}
	}

	return { memUsed, memTotal: total, cpuPercent };
}

function StatusRow() {
	const [now, setNow] = useState(() => new Date());
	const [stats, setStats] = useState<SystemStats>(readStatsSync);

	useEffect(() => {
		const clock = setInterval(() => setNow(new Date()), 1000);
		// Immediately replace naive initial stats with accurate values
		void readStatsAsync().then(setStats);
		const sysStats = setInterval(
			() => void readStatsAsync().then(setStats),
			STATS_INTERVAL_MS,
		);
		return () => {
			clearInterval(clock);
			clearInterval(sysStats);
		};
	}, []);

	const time = now.toLocaleTimeString("en-US", TIME_FORMAT);
	const memUsedGB = (stats.memUsed / 1073741824).toFixed(1);
	const memTotalGB = (stats.memTotal / 1073741824).toFixed(1);
	const memPercent = Math.round((stats.memUsed / stats.memTotal) * 100);

	const cpuColor =
		stats.cpuPercent > 80
			? PALETTE.error
			: stats.cpuPercent > 50
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
					{`CPU ${stats.cpuPercent}%`}
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
