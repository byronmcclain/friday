import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

export const gitPull: FridayTool = {
	name: "git.pull",
	description:
		"Pull changes from a remote repository. Supports rebase mode and auto-stash for dirty working trees.",
	parameters: [
		{
			name: "remote",
			type: "string",
			description: "Remote name (default: origin)",
			required: false,
			default: "origin",
		},
		{
			name: "branch",
			type: "string",
			description: "Branch to pull (default: current tracking branch)",
			required: false,
		},
		{
			name: "rebase",
			type: "boolean",
			description:
				"Rebase instead of merge (default: false)",
			required: false,
			default: false,
		},
		{
			name: "autostash",
			type: "boolean",
			description:
				"Auto-stash dirty changes before pull, reapply after (default: true)",
			required: false,
			default: true,
		},
	],
	clearance: ["git-write", "network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			const remote = (args.remote as string) ?? "origin";
			const branch = args.branch as string | undefined;
			const rebase = (args.rebase as boolean) ?? false;
			const autostash = (args.autostash as boolean) ?? true;

			const remoteCheck = assertSafeArg(remote, "remote");
			if (remoteCheck) return remoteCheck;
			if (branch) {
				const branchCheck = assertSafeArg(branch, "branch");
				if (branchCheck) return branchCheck;
			}

			const cmdParts = [
				"git",
				"-C",
				context.workingDirectory,
				"pull",
			];
			if (rebase) cmdParts.push("--rebase");
			if (autostash) cmdParts.push("--autostash");
			cmdParts.push(remote);
			if (branch) cmdParts.push(branch);

			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const stdout = result.stdout.toString().trim();
			const stderr = result.stderr.toString().trim();

			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || stdout || "git pull failed",
				};
			}

			await context.audit.log({
				action: "tool:git.pull",
				source: "git.pull",
				detail: `Pulled from ${remote}${branch ? `/${branch}` : ""}${rebase ? " (rebase)" : ""}`,
				success: true,
			});

			const output = [stdout, stderr].filter(Boolean).join("\n");
			return {
				success: true,
				output: output || "Already up to date.",
				artifacts: { remote, branch: branch ?? null, rebase, autostash },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git pull failed: ${msg}` };
		}
	},
};
