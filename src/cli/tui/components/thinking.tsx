import { useState, useEffect, useRef } from "react";
import { PALETTE, BOLD } from "../theme.ts";
import type { ToolInfo } from "../state.ts";

const BRAILLE_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const MAX_TRAIL = 5;
const TRAIL_AGE_MS = 5000;

let nextTrailId = 0;

interface ThinkingProps {
	currentTool?: ToolInfo | null;
}

interface TrailEntry extends ToolInfo {
	id: number;
	status: "running" | "done";
	completedAt?: number;
}

export function formatToolSummary(name: string, args: Record<string, unknown>): string {
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
	const [trail, setTrail] = useState<TrailEntry[]>([]);
	const startRef = useRef(Date.now());

	// Spinner animation (80ms tick also drives elapsed display via re-render)
	useEffect(() => {
		startRef.current = Date.now();
		const interval = setInterval(() => {
			setFrame((f: number) => (f + 1) % BRAILLE_FRAMES.length);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	// Trail management — accumulate tool calls, mark completions
	useEffect(() => {
		if (currentTool) {
			const entry: TrailEntry = {
				id: nextTrailId++,
				name: currentTool.name,
				args: currentTool.args,
				status: "running",
			};
			setTrail((prev) => [...prev, entry].slice(-MAX_TRAIL));
		} else {
			setTrail((prev) => {
				const updated = [...prev];
				for (let i = updated.length - 1; i >= 0; i--) {
					const e = updated[i];
					if (e && e.status === "running") {
						updated[i] = { ...e, status: "done", completedAt: Date.now() };
						break;
					}
				}
				return updated;
			});
		}
	}, [currentTool]);

	// Compute elapsed inline — spinner re-renders at 80ms so this stays fresh
	const now = Date.now();
	const elapsed = Math.floor((now - startRef.current) / 1000);
	const visibleTrail = trail.filter(
		(e) => e.status === "running" || (e.completedAt && now - e.completedAt < TRAIL_AGE_MS),
	);

	const timeStr = elapsed > 0 ? ` (${elapsed}s)` : "";
	const hasActiveEntry = visibleTrail.some((e) => e.status === "running");

	return (
		<box flexDirection="column" paddingLeft={1} gap={0}>
			<text fg={PALETTE.amberPrimary} bg={PALETTE.surfaceLight} attributes={BOLD}>
				{" Friday "}
			</text>
			{visibleTrail.map((entry) => (
				<box key={entry.id} paddingLeft={1}>
					{entry.status === "running" ? (
						<text fg={PALETTE.amberDim}>
							{`${BRAILLE_FRAMES[frame]} ${formatToolSummary(entry.name, entry.args)}${timeStr}`}
						</text>
					) : (
						<text fg={PALETTE.textMuted}>
							{`✓ ${formatToolSummary(entry.name, entry.args)}`}
						</text>
					)}
				</box>
			))}
			{!hasActiveEntry && (
				<box paddingLeft={1}>
					<text fg={PALETTE.amberDim}>
						{`${BRAILLE_FRAMES[frame]} thinking...${timeStr}`}
					</text>
				</box>
			)}
		</box>
	);
}
