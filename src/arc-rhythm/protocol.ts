import type { FridayProtocol, ProtocolContext, ProtocolResult } from "../modules/types.ts";
import type { RhythmStore } from "./store.ts";
import type { RhythmScheduler } from "./scheduler.ts";
import { validate, describe as describeCron, nextOccurrence } from "./cron.ts";

export function createArcProtocol(
	store: RhythmStore,
	scheduler: RhythmScheduler,
): FridayProtocol {
	return {
		name: "arc",
		description: "Manage Arc Rhythm scheduled tasks: list, show, create, pause, resume, delete, history, run",
		aliases: ["rhythm"],
		parameters: [],
		clearance: [],
		execute: async (
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> => {
			const rawArgs = (args.rawArgs as string) ?? "";
			const parts = rawArgs.trim().split(/\s+/);
			const subcommand = parts[0] || "list";
			const rest = parts.slice(1).join(" ");

			switch (subcommand) {
				case "list":
					return handleList(store);
				case "show":
					return handleShow(store, rest);
				case "create":
					return handleCreate(store, rest);
				case "pause":
					return handlePause(store, rest);
				case "resume":
					return handleResume(store, rest);
				case "delete":
					return handleDelete(store, rest);
				case "history":
					return handleHistory(store, rest);
				case "run":
					return handleRun(store, scheduler, rest);
				default:
					return { success: false, summary: `Unknown subcommand: ${subcommand}. Use: list, show, create, pause, resume, delete, history, run` };
			}
		},
	};
}

function handleList(store: RhythmStore): ProtocolResult {
	const rhythms = store.list();
	if (rhythms.length === 0) {
		return { success: true, summary: "No rhythms configured." };
	}

	const lines = rhythms.map((r) => {
		const status = r.enabled ? "ON " : "OFF";
		const runs = `${r.runCount} runs`;
		return `[${status}] ${r.name} — ${r.cron} (${describeCron(r.cron)}) — ${runs} — ${r.id.slice(0, 8)}`;
	});

	return { success: true, summary: lines.join("\n") };
}

function handleShow(store: RhythmStore, id: string): ProtocolResult {
	const rhythm = store.get(id.trim());
	if (!rhythm) return { success: false, summary: `Rhythm not found: ${id}` };

	const lines = [
		`Name: ${rhythm.name}`,
		`Description: ${rhythm.description || "(none)"}`,
		`Cron: ${rhythm.cron} (${describeCron(rhythm.cron)})`,
		`Enabled: ${rhythm.enabled ? "yes" : "no"}`,
		`Origin: ${rhythm.origin}`,
		`Action: ${rhythm.action.type}`,
		`Next run: ${rhythm.nextRun.toISOString()}`,
		`Run count: ${rhythm.runCount}`,
		`Last result: ${rhythm.lastResult ?? "(never run)"}`,
		`Consecutive failures: ${rhythm.consecutiveFailures}`,
		`ID: ${rhythm.id}`,
	];

	return { success: true, summary: lines.join("\n") };
}

// Protocol-created rhythms are always prompt-type actions (description becomes the prompt).
// For tool or protocol action types, use the manage_rhythm LLM tool instead.
function handleCreate(store: RhythmStore, input: string): ProtocolResult {
	// Parse: "cron expression" description text
	const cronMatch = input.match(/^"([^"]+)"\s+(.+)$/);
	if (!cronMatch) {
		return { success: false, summary: 'Usage: /arc create "cron expression" description' };
	}

	const cron = cronMatch[1]!;
	const description = cronMatch[2]!;
	const validation = validate(cron);
	if (!validation.valid) {
		return { success: false, summary: `Invalid cron expression: ${validation.error}` };
	}

	const next = nextOccurrence(cron);
	const rhythm = store.create({
		name: description,
		description,
		cron,
		enabled: true,
		origin: "user",
		action: { type: "prompt", prompt: description },
		nextRun: next,
		clearance: [],
	});

	return {
		success: true,
		summary: `Created rhythm "${rhythm.name}" (${rhythm.id.slice(0, 8)}) — next run: ${rhythm.nextRun.toISOString()}`,
	};
}

function handlePause(store: RhythmStore, id: string): ProtocolResult {
	const rhythm = store.get(id.trim());
	if (!rhythm) return { success: false, summary: `Rhythm not found: ${id}` };

	store.update(rhythm.id, { enabled: false });
	return { success: true, summary: `Paused rhythm "${rhythm.name}"` };
}

function handleResume(store: RhythmStore, id: string): ProtocolResult {
	const rhythm = store.get(id.trim());
	if (!rhythm) return { success: false, summary: `Rhythm not found: ${id}` };

	const next = nextOccurrence(rhythm.cron);
	store.update(rhythm.id, { enabled: true, nextRun: next });
	return { success: true, summary: `Resumed rhythm "${rhythm.name}" — next run: ${next.toISOString()}` };
}

function handleDelete(store: RhythmStore, id: string): ProtocolResult {
	const rhythm = store.get(id.trim());
	if (!rhythm) return { success: false, summary: `Rhythm not found: ${id}` };

	store.remove(rhythm.id);
	return { success: true, summary: `Deleted rhythm "${rhythm.name}"` };
}

function handleHistory(store: RhythmStore, rest: string): ProtocolResult {
	const rhythmId = rest.trim() || undefined;
	const limit = 20;
	const history = store.getHistory(rhythmId, limit);

	if (history.length === 0) {
		return { success: true, summary: "No execution history." };
	}

	const lines = history.map((h) => {
		const dur = h.completedAt
			? `${((h.completedAt.getTime() - h.startedAt.getTime()) / 1000).toFixed(1)}s`
			: "running";
		return `[${h.status}] ${h.startedAt.toISOString()} (${dur}) — ${h.rhythmId.slice(0, 8)}${h.error ? ` — ${h.error}` : ""}`;
	});

	return { success: true, summary: lines.join("\n") };
}

async function handleRun(
	store: RhythmStore,
	scheduler: RhythmScheduler,
	id: string,
): Promise<ProtocolResult> {
	const rhythmId = id.trim();
	if (!rhythmId) return { success: false, summary: "Usage: /arc run <id>" };
	const rhythm = store.get(rhythmId);
	if (!rhythm) return { success: false, summary: `Rhythm not found: ${rhythmId}` };
	try {
		await scheduler.executeById(rhythm.id);
		return { success: true, summary: `Ran rhythm "${rhythm.name}"` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { success: false, summary: `Failed to run rhythm: ${msg}` };
	}
}
