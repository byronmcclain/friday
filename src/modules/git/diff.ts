import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

const MAX_OUTPUT_BYTES = 500_000;

export const gitDiff: FridayTool = {
	name: "git.diff",
	description:
		"Show changes between commits, commit and working tree, etc. Can diff staged changes, specific files, or between refs.",
	parameters: [
		{
			name: "staged",
			type: "boolean",
			description: "Show only staged (cached) changes (default: false)",
			required: false,
			default: false,
		},
		{
			name: "path",
			type: "string",
			description: "Limit diff to a specific file or directory path",
			required: false,
		},
		{
			name: "ref",
			type: "string",
			description:
				"Diff against a specific ref (branch, tag, commit). E.g., 'HEAD~3', 'main'",
			required: false,
		},
		{
			name: "stat",
			type: "boolean",
			description: "Show diffstat summary only (default: false)",
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
			const staged = (args.staged as boolean) ?? false;
			const path = args.path as string | undefined;
			const ref = args.ref as string | undefined;
			const stat = (args.stat as boolean) ?? false;

			if (ref) {
				const refCheck = assertSafeArg(ref, "ref");
				if (refCheck) return refCheck;
			}

			const cmdParts = ["git", "-C", context.workingDirectory, "diff"];
			if (staged) cmdParts.push("--cached");
			if (stat) cmdParts.push("--stat");
			if (ref) cmdParts.push(ref);
			if (path) {
				const pathCheck = assertSafeArg(path, "path");
				if (pathCheck) return pathCheck;
				cmdParts.push("--");
				cmdParts.push(path);
			}

			const result = await Bun.$`${cmdParts}`.quiet().nothrow();

			const stderr = result.stderr.toString().trim();
			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || "git diff failed",
				};
			}

			let output = result.stdout.toString();
			let truncated = false;
			if (output.length > MAX_OUTPUT_BYTES) {
				const totalBytes = output.length;
				output = `${output.slice(0, MAX_OUTPUT_BYTES).trim()}\n... (truncated, ${totalBytes} total bytes)`;
				truncated = true;
			} else {
				output = output.trim();
			}

			await context.audit.log({
				action: "tool:git.diff",
				source: "git.diff",
				detail: `Git diff${staged ? " --cached" : ""}${ref ? ` ${ref}` : ""}${path ? ` -- ${path}` : ""}`,
				success: true,
			});

			return {
				success: true,
				output: output || "(no differences)",
				artifacts: { staged, ref: ref ?? null, path: path ?? null, truncated },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git diff failed: ${msg}` };
		}
	},
};
