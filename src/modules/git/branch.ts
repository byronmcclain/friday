import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

export const gitBranch: FridayTool = {
	name: "git.branch",
	description:
		"List, create, delete, or switch branches. Multipurpose branch management tool.",
	parameters: [
		{
			name: "action",
			type: "string",
			description:
				'Action to perform: "list", "create", "delete", "switch" (default: "list")',
			required: false,
			default: "list",
		},
		{
			name: "name",
			type: "string",
			description:
				'Branch name (required for create, delete, switch)',
			required: false,
		},
		{
			name: "from",
			type: "string",
			description:
				"Base ref to create branch from (only for create action)",
			required: false,
		},
	],
	clearance: ["git-read", "git-write"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const action = (args.action as string) ?? "list";
		const name = args.name as string | undefined;
		const from = args.from as string | undefined;

		if (name) {
			const nameCheck = assertSafeArg(name, "name");
			if (nameCheck) return nameCheck;
		}
		if (from) {
			const fromCheck = assertSafeArg(from, "from");
			if (fromCheck) return fromCheck;
		}

		try {
			switch (action) {
				case "list": {
					const result =
						await Bun.$`git -C ${context.workingDirectory} branch -vv`
							.quiet()
							.nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"git branch list failed",
						};
					}

					const output = result.stdout.toString().trim();
					return {
						success: true,
						output: output || "(no branches)",
					};
				}

				case "create": {
					if (!name) {
						return {
							success: false,
							output: 'Missing required parameter: name (for action "create")',
						};
					}

					const cmdParts = [
						"git",
						"-C",
						context.workingDirectory,
						"switch",
						"-c",
						name,
					];
					if (from) cmdParts.push(from);

					const result = await Bun.$`${cmdParts}`.quiet().nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"branch creation failed",
						};
					}

					await context.audit.log({
						action: "tool:git.branch",
						source: "git.branch",
						detail: `Created and switched to branch: ${name}${from ? ` from ${from}` : ""}`,
						success: true,
					});

					return {
						success: true,
						output: `Created and switched to branch '${name}'${from ? ` from ${from}` : ""}`,
						artifacts: { action, name, from: from ?? null },
					};
				}

				case "delete": {
					if (!name) {
						return {
							success: false,
							output: 'Missing required parameter: name (for action "delete")',
						};
					}

					const result =
						await Bun.$`git -C ${context.workingDirectory} branch -d ${name}`
							.quiet()
							.nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"branch deletion failed",
						};
					}

					await context.audit.log({
						action: "tool:git.branch",
						source: "git.branch",
						detail: `Deleted branch: ${name}`,
						success: true,
					});

					return {
						success: true,
						output: result.stdout.toString().trim(),
						artifacts: { action, name },
					};
				}

				case "switch": {
					if (!name) {
						return {
							success: false,
							output: 'Missing required parameter: name (for action "switch")',
						};
					}

					const result =
						await Bun.$`git -C ${context.workingDirectory} switch ${name}`
							.quiet()
							.nothrow();

					if (result.exitCode !== 0) {
						return {
							success: false,
							output:
								result.stderr.toString().trim() ||
								"branch switch failed",
						};
					}

					await context.audit.log({
						action: "tool:git.branch",
						source: "git.branch",
						detail: `Switched to branch: ${name}`,
						success: true,
					});

					return {
						success: true,
						output: `Switched to branch '${name}'`,
						artifacts: { action, name },
					};
				}

				default:
					return {
						success: false,
						output: `Unknown action: ${action}. Use "list", "create", "delete", or "switch".`,
					};
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git branch failed: ${msg}` };
		}
	},
};
