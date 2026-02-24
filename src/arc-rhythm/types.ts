import type { ClearanceName } from "../core/clearance.ts";

export interface Rhythm {
	id: string;
	name: string;
	description: string;
	cron: string;
	enabled: boolean;
	origin: "user" | "friday";
	action: RhythmAction;
	lastRun?: Date;
	lastResult?: "success" | "failure";
	nextRun: Date;
	runCount: number;
	consecutiveFailures: number;
	clearance: ClearanceName[];
	createdAt: Date;
	updatedAt: Date;
}

export type RhythmAction =
	| { type: "prompt"; prompt: string }
	| { type: "tool"; tool: string; args?: Record<string, unknown> }
	| { type: "protocol"; protocol: string; args?: Record<string, unknown> };

export interface RhythmExecution {
	id: string;
	rhythmId: string;
	startedAt: Date;
	completedAt?: Date;
	status: "running" | "success" | "failure";
	result?: string;
	error?: string;
}

export const MAX_CONSECUTIVE_FAILURES = 5;

export const ACTION_TIMEOUTS = {
	prompt: 5 * 60 * 1000,
	tool: 30 * 1000,
	protocol: 30 * 1000,
} as const;

export const DEFAULT_TICK_INTERVAL = 60_000;
