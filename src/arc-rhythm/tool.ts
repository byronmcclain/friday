import type { FridayTool, ToolContext, ToolResult } from "../modules/types.ts";
import type { RhythmStore } from "./store.ts";
import type { RhythmAction } from "./types.ts";
import { validate, nextOccurrence, describe as describeCron } from "./cron.ts";

export function createManageRhythmTool(store: RhythmStore): FridayTool {
	return {
		name: "manage_rhythm",
		description:
			"Manage Arc Rhythm scheduled tasks. Create, list, update, or delete recurring tasks that Friday executes autonomously on a cron schedule.",
		parameters: [
			{
				name: "operation",
				type: "string",
				description: "Operation: 'create', 'list', 'update', 'delete'",
				required: true,
			},
			{
				name: "rhythm_id",
				type: "string",
				description: "Rhythm ID (required for update/delete)",
				required: false,
			},
			{
				name: "name",
				type: "string",
				description: "Rhythm name (required for create)",
				required: false,
			},
			{
				name: "cron",
				type: "string",
				description: "Cron expression (required for create, optional for update)",
				required: false,
			},
			{
				name: "action_type",
				type: "string",
				description: "Action type: 'prompt', 'tool', 'protocol' (required for create)",
				required: false,
			},
			{
				name: "action_config",
				type: "string",
				description: "JSON config for the action (required for create)",
				required: false,
			},
			{
				name: "enabled",
				type: "boolean",
				description: "Enable or disable the rhythm",
				required: false,
			},
		],
		clearance: ["system"],
		execute: async (
			args: Record<string, unknown>,
			_context: ToolContext,
		): Promise<ToolResult> => {
			const operation = args.operation as string;

			switch (operation) {
				case "create":
					return handleCreate(store, args);
				case "list":
					return handleList(store);
				case "update":
					return handleUpdate(store, args);
				case "delete":
					return handleDelete(store, args);
				default:
					return {
						success: false,
						output: `Unknown operation: ${operation}. Use: create, list, update, delete`,
					};
			}
		},
	};
}

function handleCreate(
	store: RhythmStore,
	args: Record<string, unknown>,
): ToolResult {
	const name = args.name as string | undefined;
	const cron = args.cron as string | undefined;
	const actionType = args.action_type as string | undefined;
	const actionConfig = args.action_config as string | undefined;

	if (!name || !cron || !actionType || !actionConfig) {
		return {
			success: false,
			output: "Missing required fields: name, cron, action_type, action_config",
		};
	}

	const validation = validate(cron);
	if (!validation.valid) {
		return {
			success: false,
			output: `Invalid cron expression: ${validation.error}`,
		};
	}

	let action: RhythmAction;
	try {
		const config = JSON.parse(actionConfig);
		switch (actionType) {
			case "prompt":
				action = { type: "prompt", prompt: config.prompt };
				break;
			case "tool":
				action = { type: "tool", tool: config.tool, args: config.args };
				break;
			case "protocol":
				action = {
					type: "protocol",
					protocol: config.protocol,
					args: config.args,
				};
				break;
			default:
				return {
					success: false,
					output: `Unknown action type: ${actionType}`,
				};
		}
	} catch {
		return { success: false, output: "Invalid action_config JSON" };
	}

	const next = nextOccurrence(cron);
	const rhythm = store.create({
		name,
		description: name,
		cron,
		enabled: true,
		origin: "friday",
		action,
		nextRun: next,
		clearance: [],
	});

	return {
		success: true,
		output: `Created rhythm "${rhythm.name}" (${rhythm.id}) — schedule: ${describeCron(cron)}, next run: ${rhythm.nextRun.toISOString()}`,
	};
}

function handleList(store: RhythmStore): ToolResult {
	const rhythms = store.list();
	if (rhythms.length === 0) {
		return { success: true, output: "No rhythms configured." };
	}

	const lines = rhythms.map((r) => {
		const status = r.enabled ? "ON" : "OFF";
		return `[${status}] ${r.name} — ${r.cron} (${describeCron(r.cron)}) — ${r.runCount} runs — ${r.id}`;
	});

	return { success: true, output: lines.join("\n") };
}

function handleUpdate(
	store: RhythmStore,
	args: Record<string, unknown>,
): ToolResult {
	const rhythmId = args.rhythm_id as string | undefined;
	if (!rhythmId) {
		return { success: false, output: "Missing required field: rhythm_id" };
	}

	const existing = store.get(rhythmId);
	if (!existing) {
		return { success: false, output: `Rhythm not found: ${rhythmId}` };
	}

	const updates: Record<string, unknown> = {};
	if (args.name !== undefined) updates.name = args.name;
	if (args.enabled !== undefined) updates.enabled = args.enabled;
	if (args.cron !== undefined) {
		const validation = validate(args.cron as string);
		if (!validation.valid) {
			return {
				success: false,
				output: `Invalid cron expression: ${validation.error}`,
			};
		}
		updates.cron = args.cron;
		updates.nextRun = nextOccurrence(args.cron as string);
	}

	store.update(rhythmId, updates);
	return {
		success: true,
		output: `Updated rhythm "${existing.name}" (${rhythmId})`,
	};
}

function handleDelete(
	store: RhythmStore,
	args: Record<string, unknown>,
): ToolResult {
	const rhythmId = args.rhythm_id as string | undefined;
	if (!rhythmId) {
		return { success: false, output: "Missing required field: rhythm_id" };
	}

	const existing = store.get(rhythmId);
	if (!existing) {
		return { success: false, output: `Rhythm not found: ${rhythmId}` };
	}

	store.remove(rhythmId);
	return { success: true, output: `Deleted rhythm "${existing.name}"` };
}
