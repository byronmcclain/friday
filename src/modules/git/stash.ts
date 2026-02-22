import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertInteger } from "../validation.ts";

export const gitStash: FridayTool = {
	name: "git.stash",
	description:
		"Stash or restore uncommitted changes. Supports push, pop, list, and drop operations.",
	parameters: [
		{
			name: "action",
			type: "string",
			description:
				'Action: "push", "pop", "list", "drop" (default: "push")',
			required: false,
			default: "push",
		},
		{
			name: "message",
			type: "string",
			description: "Stash message (only for push action)",
			required: false,
		},
		{
			name: "index",
			type: "number",
			description: "Stash index for pop/drop (default: 0 = latest)",
			required: false,
			default: 0,
		},
	],
	clearance: ["git-write"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const action = (args.action as string) ?? "push";

		try {
			switch (action) {
				case "push": {
					const message = args.message as string | undefined;
					const cmdParts = [
						"git",
						"-C",
						context.workingDirectory,
						"stash",
						"push",
					];
					if (message) {
						cmdParts.push("-m", message);
					}

					const result = await Bun.$`${cmdParts}`.quiet().nothrow();
					const output = result.stdout.toString().trim();
					const stderr = result.stderr.toString().trim();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output: stderr || "git stash push failed",
						};
					}

					await context.audit.log({
						action: "tool:git.stash",
						source: "git.stash",
						detail: `Stashed changes${message ? `: ${message}` : ""}`,
						success: true,
					});

					return {
						success: true,
						output: output || "No local changes to save",
						artifacts: { action, message: message ?? null },
					};
				}

				case "pop": {
					const indexResult = assertInteger(args.index ?? 0, "index");
					if ("success" in indexResult) return indexResult;
					const index = indexResult.value;
					const result =
						await Bun.$`git -C ${context.workingDirectory} stash pop stash@{${index}}`
							.quiet()
							.nothrow();

					const output = result.stdout.toString().trim();
					const stderr = result.stderr.toString().trim();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output: stderr || "git stash pop failed",
						};
					}

					await context.audit.log({
						action: "tool:git.stash",
						source: "git.stash",
						detail: `Popped stash@{${index}}`,
						success: true,
					});

					return {
						success: true,
						output: output || `Applied and dropped stash@{${index}}`,
						artifacts: { action, index },
					};
				}

				case "list": {
					const result =
						await Bun.$`git -C ${context.workingDirectory} stash list`
							.quiet()
							.nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"git stash list failed",
						};
					}

					const output = result.stdout.toString().trim();
					return {
						success: true,
						output: output || "(no stashes)",
					};
				}

				case "drop": {
					const indexResult = assertInteger(args.index ?? 0, "index");
					if ("success" in indexResult) return indexResult;
					const index = indexResult.value;
					const result =
						await Bun.$`git -C ${context.workingDirectory} stash drop stash@{${index}}`
							.quiet()
							.nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"git stash drop failed",
						};
					}

					await context.audit.log({
						action: "tool:git.stash",
						source: "git.stash",
						detail: `Dropped stash@{${index}}`,
						success: true,
					});

					return {
						success: true,
						output: result.stdout.toString().trim() || `Dropped stash@{${index}}`,
						artifacts: { action, index },
					};
				}

				default:
					return {
						success: false,
						output: `Unknown action: ${action}. Use "push", "pop", "list", or "drop".`,
					};
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git stash failed: ${msg}` };
		}
	},
};
