import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";
import { assertContained } from "../filesystem/containment.ts";

export const gitCommit: FridayTool = {
	name: "git.commit",
	description:
		"Stage files and create a git commit. Can stage specific files or all changes before committing.",
	parameters: [
		{
			name: "message",
			type: "string",
			description: "Commit message",
			required: true,
		},
		{
			name: "files",
			type: "array",
			description:
				'Files to stage before committing. Use ["."] to stage all changes. If empty, commits whatever is already staged.',
			required: false,
			default: [],
		},
		{
			name: "allowEmpty",
			type: "boolean",
			description: "Allow an empty commit (default: false)",
			required: false,
			default: false,
		},
	],
	clearance: ["git-write"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const message = args.message as string;
		if (!message) {
			return {
				success: false,
				output: "Missing required parameter: message",
			};
		}

		try {
			const files = (args.files as string[]) ?? [];
			const allowEmpty = (args.allowEmpty as boolean) ?? false;

			// Validate file paths
			for (const file of files) {
				const argCheck = assertSafeArg(file, "file");
				if (argCheck) return argCheck;
				const resolved = resolve(context.workingDirectory, file);
				const containment = await assertContained(resolved, context.workingDirectory);
				if (!containment.ok) {
					return {
						success: false,
						output: `Access denied: file "${file}" resolves outside working directory`,
					};
				}
			}

			// Stage files if specified
			if (files.length > 0) {
				const addResult =
					await Bun.$`git -C ${context.workingDirectory} add ${files}`
						.quiet()
						.nothrow();

				if (addResult.exitCode !== 0) {
					const stderr = addResult.stderr.toString().trim();
					return {
						success: false,
						output: `git add failed: ${stderr}`,
					};
				}
			}

			// Emit pre-commit signal
			await context.signal.emit(
				"command:pre-commit",
				"git.commit",
				{ message },
			);

			const commitParts = [
				"git",
				"-C",
				context.workingDirectory,
				"commit",
				"-m",
				message,
			];
			if (allowEmpty) commitParts.push("--allow-empty");

			const result = await Bun.$`${commitParts}`.quiet().nothrow();

			const stdout = result.stdout.toString().trim();
			const stderr = result.stderr.toString().trim();

			if (result.exitCode !== 0) {
				return {
					success: false,
					output: stderr || stdout || "git commit failed",
				};
			}

			await context.audit.log({
				action: "tool:git.commit",
				source: "git.commit",
				detail: `Committed: ${message.slice(0, 100)}`,
				success: true,
			});

			return {
				success: true,
				output: stdout,
				artifacts: { message, filesStaged: files },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `git commit failed: ${msg}` };
		}
	},
};
