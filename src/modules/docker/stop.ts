import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

export const dockerStop: FridayTool = {
	name: "docker.stop",
	description:
		"Stop a running Docker container. Optionally remove it after stopping.",
	parameters: [
		{
			name: "container",
			type: "string",
			description: "Container name or ID to stop",
			required: true,
		},
		{
			name: "remove",
			type: "boolean",
			description: "Remove the container after stopping (default: false)",
			required: false,
			default: false,
		},
		{
			name: "timeout",
			type: "number",
			description:
				"Seconds to wait before force-killing (default: 10)",
			required: false,
			default: 10,
		},
	],
	clearance: ["exec-shell"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const container = args.container as string;
		if (!container) {
			return {
				success: false,
				output: "Missing required parameter: container",
			};
		}

		const containerCheck = assertSafeArg(container, "container");
		if (containerCheck) return containerCheck;

		try {
			const remove = (args.remove as boolean) ?? false;
			const timeout = Math.max(1, (args.timeout as number) ?? 10);

			const stopResult =
				await Bun.$`docker stop -t ${timeout} ${container}`
					.quiet()
					.nothrow();

			if (stopResult.exitCode !== 0) {
				return {
					success: false,
					output:
						stopResult.stderr.toString().trim() ||
						`Failed to stop ${container}`,
				};
			}

			let output = `Stopped container ${container}`;

			if (remove) {
				const rmResult =
					await Bun.$`docker rm ${container}`.quiet().nothrow();
				if (rmResult.exitCode !== 0) {
					return {
						success: false,
						output: `Container stopped but removal failed: ${rmResult.stderr.toString().trim()}`,
					};
				}
				output = `Stopped and removed container ${container}`;
			}

			await context.audit.log({
				action: "tool:docker.stop",
				source: "docker.stop",
				detail: `${remove ? "Stopped and removed" : "Stopped"} container: ${container}`,
				success: true,
			});

			return {
				success: true,
				output,
				artifacts: { container, removed: remove },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `docker stop failed: ${msg}` };
		}
	},
};
