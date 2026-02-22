import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

export const gitPush: FridayTool = {
	name: "git.push",
	description:
		"Push commits to the remote repository. Supports setting upstream and pushing specific branches.",
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
			description:
				"Branch to push (default: current branch)",
			required: false,
		},
		{
			name: "setUpstream",
			type: "boolean",
			description:
				"Set upstream tracking reference with -u (default: false)",
			required: false,
			default: false,
		},
	],
	clearance: ["git-write", "network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			const remote = (args.remote as string) ?? "origin";
			const setUpstream = (args.setUpstream as boolean) ?? false;
			let branch = args.branch as string | undefined;

			const remoteCheck = assertSafeArg(remote, "remote");
			if (remoteCheck) return remoteCheck;
			if (branch) {
				const branchCheck = assertSafeArg(branch, "branch");
				if (branchCheck) return branchCheck;
			}

			// Get current branch if not specified
			if (!branch) {
				const branchResult =
					await Bun.$`git -C ${context.workingDirectory} rev-parse --abbrev-ref HEAD`
						.quiet()
						.nothrow();
				if (branchResult.exitCode !== 0 || branchResult.stdout.toString().trim() === "HEAD") {
					return {
						success: false,
						output: "Could not determine current branch. Specify branch explicitly.",
					};
				}
				branch = branchResult.stdout.toString().trim();
			}

			const cmdParts = [
				"git",
				"-C",
				context.workingDirectory,
				"push",
			];
			if (setUpstream) cmdParts.push("-u");
			cmdParts.push(remote);
			if (branch) cmdParts.push(branch);

			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const stdout = result.stdout.toString().trim();
			const stderr = result.stderr.toString().trim();

			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || stdout || "git push failed",
				};
			}

			await context.audit.log({
				action: "tool:git.push",
				source: "git.push",
				detail: `Pushed to ${remote}/${branch ?? "HEAD"}`,
				success: true,
			});

			// stderr often contains push progress info
			const output = [stdout, stderr].filter(Boolean).join("\n");
			return {
				success: true,
				output: output || `Pushed to ${remote}/${branch ?? "HEAD"}`,
				artifacts: { remote, branch: branch ?? null, setUpstream },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git push failed: ${msg}` };
		}
	},
};
