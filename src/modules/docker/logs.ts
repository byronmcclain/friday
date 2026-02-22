import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

const MAX_OUTPUT_BYTES = 500_000;

export const dockerLogs: FridayTool = {
	name: "docker.logs",
	description:
		"Fetch logs from a Docker container. Supports tail count and timestamp display.",
	parameters: [
		{
			name: "container",
			type: "string",
			description: "Container name or ID",
			required: true,
		},
		{
			name: "tail",
			type: "number",
			description: "Number of lines from the end to show (default: 100)",
			required: false,
			default: 100,
		},
		{
			name: "timestamps",
			type: "boolean",
			description: "Show timestamps (default: false)",
			required: false,
			default: false,
		},
		{
			name: "since",
			type: "string",
			description:
				'Show logs since a timestamp or relative time (e.g., "1h", "2024-01-01T00:00:00")',
			required: false,
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

		try {
			const tail = Math.max(1, (args.tail as number) ?? 100);
			const timestamps = (args.timestamps as boolean) ?? false;
			const since = args.since as string | undefined;

			const cmdParts = [
				"docker",
				"logs",
				"--tail",
				String(tail),
			];
			if (timestamps) cmdParts.push("--timestamps");
			if (since) cmdParts.push("--since", since);
			cmdParts.push(container);

			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const stderr = result.stderr.toString().trim();
			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || `Failed to get logs for ${container}`,
				};
			}

			// Docker logs may write to both stdout and stderr
			let stdout = result.stdout.toString();
			if (stdout.length > MAX_OUTPUT_BYTES) {
				stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated)`;
			}

			const parts: string[] = [];
			if (stdout.trim()) parts.push(stdout.trim());
			if (stderr) parts.push(stderr);
			const output = parts.join("\n") || "(no logs)";

			await context.audit.log({
				action: "tool:docker.logs",
				source: "docker.logs",
				detail: `Fetched logs for ${container} (tail ${tail})`,
				success: true,
			});

			return {
				success: true,
				output,
				artifacts: { container, tail, timestamps },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `docker logs failed: ${msg}` };
		}
	},
};
