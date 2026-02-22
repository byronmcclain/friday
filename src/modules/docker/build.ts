import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

const MAX_OUTPUT_BYTES = 500_000;
const BUILD_TIMEOUT_MS = 300_000; // 5 minutes

export const dockerBuild: FridayTool = {
	name: "docker.build",
	description:
		"Build a Docker image from a Dockerfile. Supports custom tags, build context, and Dockerfile path.",
	parameters: [
		{
			name: "tag",
			type: "string",
			description: "Tag for the built image (e.g., 'myapp:latest')",
			required: true,
		},
		{
			name: "context",
			type: "string",
			description: "Build context directory (default: working directory)",
			required: false,
			default: ".",
		},
		{
			name: "dockerfile",
			type: "string",
			description: "Path to Dockerfile (default: Dockerfile in context)",
			required: false,
		},
		{
			name: "buildArgs",
			type: "object",
			description: "Build arguments as key-value pairs",
			required: false,
		},
	],
	clearance: ["exec-shell", "network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const tag = args.tag as string;
		if (!tag) {
			return { success: false, output: "Missing required parameter: tag" };
		}

		try {
			const buildContext = resolve(
				context.workingDirectory,
				(args.context as string) ?? ".",
			);
			const dockerfile = args.dockerfile as string | undefined;
			const buildArgs = args.buildArgs as Record<string, string> | undefined;

			const cmdParts = ["docker", "build", "-t", tag];
			if (dockerfile) {
				cmdParts.push("-f", resolve(context.workingDirectory, dockerfile));
			}
			if (buildArgs) {
				for (const [key, value] of Object.entries(buildArgs)) {
					cmdParts.push("--build-arg", `${key}=${value}`);
				}
			}
			cmdParts.push(buildContext);

			const proc = Bun.spawn(cmdParts, {
				cwd: context.workingDirectory,
				stdout: "pipe",
				stderr: "pipe",
			});

			const timeoutId = setTimeout(() => proc.kill(), BUILD_TIMEOUT_MS);

			const [stdoutBuf, stderrBuf] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
			]);

			clearTimeout(timeoutId);
			const exitCode = await proc.exited;

			let stdout = new TextDecoder().decode(stdoutBuf);
			let stderr = new TextDecoder().decode(stderrBuf);

			if (stdout.length > MAX_OUTPUT_BYTES) {
				stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated)`;
			}
			if (stderr.length > MAX_OUTPUT_BYTES) {
				stderr = `${stderr.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated)`;
			}

			const parts: string[] = [];
			if (stdout.trim()) parts.push(stdout.trim());
			if (stderr.trim()) parts.push(stderr.trim());

			if (exitCode !== 0) {
				return {
					success: false,
					output: parts.join("\n") || "docker build failed",
				};
			}

			await context.audit.log({
				action: "tool:docker.build",
				source: "docker.build",
				detail: `Built image: ${tag}`,
				success: true,
			});

			return {
				success: true,
				output: parts.join("\n") || `Successfully built ${tag}`,
				artifacts: { tag, context: buildContext },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `docker build failed: ${msg}` };
		}
	},
};
