import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertSafeArg } from "../validation.ts";

const MAX_OUTPUT_BYTES = 500_000;
const RUN_TIMEOUT_MS = 120_000; // 2 minutes

export const dockerRun: FridayTool = {
	name: "docker.run",
	description:
		"Run a Docker container from an image. Supports port mapping, environment variables, volumes, and detached mode.",
	parameters: [
		{
			name: "image",
			type: "string",
			description: "Docker image to run",
			required: true,
		},
		{
			name: "name",
			type: "string",
			description: "Container name",
			required: false,
		},
		{
			name: "ports",
			type: "array",
			description: 'Port mappings (e.g., ["8080:80", "443:443"])',
			required: false,
		},
		{
			name: "env",
			type: "object",
			description: "Environment variables as key-value pairs",
			required: false,
		},
		{
			name: "volumes",
			type: "array",
			description: 'Volume mounts (e.g., ["./data:/app/data"])',
			required: false,
		},
		{
			name: "detach",
			type: "boolean",
			description: "Run in detached mode (default: true)",
			required: false,
			default: true,
		},
		{
			name: "rm",
			type: "boolean",
			description:
				"Automatically remove container when it exits (default: false)",
			required: false,
			default: false,
		},
		{
			name: "command",
			type: "array",
			description: 'Command to run inside the container as array (e.g., ["npm", "start"])',
			required: false,
		},
	],
	clearance: ["exec-shell", "network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const image = args.image as string;
		if (!image) {
			return {
				success: false,
				output: "Missing required parameter: image",
			};
		}

		const imageCheck = assertSafeArg(image, "image");
		if (imageCheck) return imageCheck;

		try {
			const name = args.name as string | undefined;
			if (name) {
				const nameCheck = assertSafeArg(name, "name");
				if (nameCheck) return nameCheck;
			}
			const ports = (args.ports as string[]) ?? [];
			const env = args.env as Record<string, string> | undefined;
			const volumes = (args.volumes as string[]) ?? [];
			const detach = (args.detach as boolean) ?? true;
			const rm = (args.rm as boolean) ?? false;
			const command = args.command as string[] | undefined;

			const cmdParts = ["docker", "run"];
			if (detach) cmdParts.push("-d");
			if (rm) cmdParts.push("--rm");
			if (name) cmdParts.push("--name", name);

			for (const port of ports) {
				cmdParts.push("-p", port);
			}
			if (env) {
				for (const [key, value] of Object.entries(env)) {
					if (key.includes("=")) {
						return { success: false, output: `Invalid env var key "${key}": must not contain "="` };
					}
					if (key.startsWith("-")) {
						return { success: false, output: `Invalid env var key "${key}": must not start with "-"` };
					}
					cmdParts.push("-e", `${key}=${value}`);
				}
			}
			for (const vol of volumes) {
				cmdParts.push("-v", vol);
			}

			cmdParts.push(image);

			if (command && command.length > 0) {
				cmdParts.push(...command);
			}

			const proc = Bun.spawn(cmdParts, {
				cwd: context.workingDirectory,
				stdout: "pipe",
				stderr: "pipe",
			});

			const timeoutId = setTimeout(() => proc.kill(), RUN_TIMEOUT_MS);

			const [stdoutBuf, stderrBuf] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
			]);

			const exitCode = await proc.exited;
			clearTimeout(timeoutId);

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
			if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);

			if (exitCode !== 0) {
				return {
					success: false,
					output:
						parts.join("\n") || "docker run failed",
				};
			}

			await context.audit.log({
				action: "tool:docker.run",
				source: "docker.run",
				detail: `Ran container from ${image}${name ? ` as ${name}` : ""}${detach ? " (detached)" : ""}`,
				success: true,
			});

			return {
				success: true,
				output:
					parts.join("\n") || `Container started from ${image}`,
				artifacts: {
					image,
					name: name ?? null,
					detach,
					ports,
				},
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `docker run failed: ${msg}` };
		}
	},
};
