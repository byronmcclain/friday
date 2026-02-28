import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

export const dockerPs: FridayTool = {
	name: "docker.ps",
	description:
		"List Docker containers. Shows running containers by default, or all containers with the 'all' flag.",
	parameters: [
		{
			name: "all",
			type: "boolean",
			description: "Show all containers, not just running (default: false)",
			required: false,
			default: false,
		},
		{
			name: "filter",
			type: "string",
			description:
				'Filter containers (e.g., "name=myapp", "status=exited")',
			required: false,
		},
	],
	clearance: ["exec-shell"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			const all = (args.all as boolean) ?? false;
			const filter = args.filter as string | undefined;

			const cmdParts = ["docker", "ps"];
			if (all) cmdParts.push("-a");
			if (filter) {
				const filterCheck = assertSafeArg(filter, "filter");
				if (filterCheck) return filterCheck;
				cmdParts.push("--filter", filter);
			}
			cmdParts.push("--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}");

			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const stderr = result.stderr.toString().trim();
			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || "docker ps failed — is Docker running?",
				};
			}

			const output = result.stdout.toString().trim();

			await context.audit.log({
				action: "tool:docker.ps",
				source: "docker.ps",
				detail: `Listed containers${all ? " (all)" : " (running)"}`,
				success: true,
			});

			return {
				success: true,
				output: output || "(no containers)",
				artifacts: { all, filter: filter ?? null },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `docker ps failed: ${msg}` };
		}
	},
};
