import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

export const gitStatus: FridayTool = {
	name: "git.status",
	description:
		"Show the working tree status: staged, unstaged, and untracked files. Optionally includes short format.",
	parameters: [
		{
			name: "short",
			type: "boolean",
			description: "Use short format output (default: false)",
			required: false,
			default: false,
		},
	],
	clearance: ["git-read"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			const short = (args.short as boolean) ?? false;
			const cmdParts = ["git", "-C", context.workingDirectory, "status"];
			if (short) cmdParts.push("--short");
			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const output = result.stdout.toString().trim();
			const stderr = result.stderr.toString().trim();

			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || "git status failed",
				};
			}

			await context.audit.log({
				action: "tool:git.status",
				source: "git.status",
				detail: `Git status in ${context.workingDirectory}`,
				success: true,
			});

			return {
				success: true,
				output: output || "(clean working tree)",
				artifacts: { short },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git status failed: ${msg}` };
		}
	},
};
