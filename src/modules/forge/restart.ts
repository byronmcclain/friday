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
			name: "runtimeRef",
			type: "object",
			description:
				"Reference to the runtime object (injected by the module loader)",
			required: true,
		},
	],
	clearance: ["system", "forge-modify"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const reason = args.reason as string;
		const runtimeRef = args.runtimeRef as
			| { restartRequested: boolean }
			| undefined;

		if (!reason) {
			return {
				success: false,
				output: "Missing required parameter: reason",
			};
		}
		if (!runtimeRef) {
			return {
				success: false,
				output: "Missing runtime reference — cannot trigger restart",
			};
		}

		runtimeRef.restartRequested = true;

		await context.audit.log({
			action: "forge:restart",
			source: "forge",
			detail: `Restart requested: ${reason}`,
			success: true,
		});

		return {
			success: true,
			output: `Restart initiated. Reason: ${reason}\nThe runtime will save state and reboot after this response completes.`,
			artifacts: { reason },
		};
	},
};
