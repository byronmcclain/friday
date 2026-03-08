import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

export const forgeRestart: FridayTool = {
	name: "forge_restart",
	description:
		"Trigger a graceful self-restart to load new or patched forge modules. Requires a reason and sets a restart flag on the runtime. The REPL loop detects this flag and cycles shutdown/boot.",
	parameters: [
		{
			name: "reason",
			type: "string",
			description:
				"Why the restart is needed (e.g., 'Load new weather module')",
			required: true,
		},
		{
			name: "moduleName",
			type: "string",
			description: "Name of the forge module that was validated",
			required: true,
		},
	],
	clearance: ["system", "forge-modify"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const reason = args.reason as string;
		const moduleName = args.moduleName as string;

		if (!reason) {
			return {
				success: false,
				output: "Missing required parameter: reason",
			};
		}
		if (!moduleName) {
			return {
				success: false,
				output: "Missing required parameter: moduleName",
			};
		}

		// Verify validation receipt exists
		const receipt = await context.memory.get(`validation:${moduleName}`);
		if (!receipt) {
			return {
				success: false,
				output: `No validation receipt found for "${moduleName}". Run forge_validate first.`,
			};
		}

		// Signal the runtime to restart — the signal bus bridges the gap
		// between the LLM tool boundary and the runtime instance
		await context.signal.emit("custom:forge-restart-requested", "forge", {
			reason,
			moduleName,
		});

		await context.audit.log({
			action: "forge:restart",
			source: "forge",
			detail: `Restart requested: ${reason}`,
			success: true,
		});

		return {
			success: true,
			output: `Restart initiated. Reason: ${reason}\nThe runtime will save state and reboot after this response completes.`,
			artifacts: { reason, moduleName },
		};
	},
};
