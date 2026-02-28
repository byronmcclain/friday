import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

const DEFAULT_COUNT = 10;
const MAX_COUNT = 100;

export const gitLog: FridayTool = {
	name: "git.log",
	description:
		"Show commit log history. Returns recent commits with hash, author, date, and message.",
	parameters: [
		{
			name: "count",
			type: "number",
			description: `Number of commits to show (default: ${DEFAULT_COUNT}, max: ${MAX_COUNT})`,
			required: false,
			default: DEFAULT_COUNT,
		},
		{
			name: "oneline",
			type: "boolean",
			description: "Use compact one-line format (default: true)",
			required: false,
			default: true,
		},
		{
			name: "ref",
			type: "string",
			description: "Branch or ref to show log for (default: HEAD)",
			required: false,
		},
		{
			name: "path",
			type: "string",
			description: "Show only commits affecting this file/directory",
			required: false,
		},
	],
	clearance: ["git-read"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			const count = Math.min(
				MAX_COUNT,
				Math.max(1, (args.count as number) ?? DEFAULT_COUNT),
			);
			const oneline = (args.oneline as boolean) ?? true;
			const ref = args.ref as string | undefined;
			const path = args.path as string | undefined;

			if (ref) {
				const refCheck = assertSafeArg(ref, "ref");
				if (refCheck) return refCheck;
			}

			const cmdParts = [
				"git",
				"-C",
				context.workingDirectory,
				"log",
				`-${count}`,
			];
			if (oneline) {
				cmdParts.push("--oneline", "--decorate");
			} else {
				cmdParts.push(
					"--format=%H %an <%ae> %ai%n  %s%n",
				);
			}
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
					output: stderr || "git log failed",
				};
			}

			const output = result.stdout.toString().trim();

			await context.audit.log({
				action: "tool:git.log",
				source: "git.log",
				detail: `Git log -${count}${ref ? ` ${ref}` : ""}${path ? ` -- ${path}` : ""}`,
				success: true,
			});

			return {
				success: true,
				output: output || "(no commits)",
				artifacts: { count, oneline, ref: ref ?? null },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git log failed: ${msg}` };
		}
	},
};
