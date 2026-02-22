import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained } from "../filesystem/containment.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 500_000;

const EXTENSION_MAP: Record<string, (f: string) => string[]> = {
	".ts": (f) => ["bun", "run", f],
	".tsx": (f) => ["bun", "run", f],
	".js": (f) => ["bun", "run", f],
	".jsx": (f) => ["bun", "run", f],
	".py": (f) => ["python3", f],
	".sh": (f) => ["bash", f],
	".rb": (f) => ["ruby", f],
	".go": (f) => ["go", "run", f],
};

export const codeRunFile: FridayTool = {
	name: "code.run_file",
	description:
		"Execute an existing source file. Detects runtime from file extension. Supports TypeScript, JavaScript, Python, Bash, Ruby, and Go.",
	parameters: [
		{
			name: "path",
			type: "string",
			description: "Path to the source file to execute",
			required: true,
		},
		{
			name: "args",
			type: "array",
			description: "Command-line arguments to pass to the script",
			required: false,
			default: [],
		},
		{
			name: "timeout",
			type: "number",
			description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
			required: false,
			default: DEFAULT_TIMEOUT_MS,
		},
	],
	clearance: ["exec-shell", "read-fs"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const filePath = args.path as string;
		if (!filePath) {
			return { success: false, output: "Missing required parameter: path" };
		}

		const resolved = resolve(context.workingDirectory, filePath);
		const containment = await assertContained(resolved, context.workingDirectory);
		if (!containment.ok) {
			return { success: false, output: containment.reason };
		}
		const realPath = containment.resolved;

		const lastDot = realPath.lastIndexOf(".");
		if (lastDot === -1) {
			return { success: false, output: "File has no extension; cannot detect runtime." };
		}
		const ext = realPath.substring(lastDot).toLowerCase();
		const cmdFactory = EXTENSION_MAP[ext];
		if (!cmdFactory) {
			return {
				success: false,
				output: `Unsupported file extension: ${ext}. Supported: ${Object.keys(EXTENSION_MAP).join(", ")}`,
			};
		}

		const exists = await Bun.file(realPath).exists();
		if (!exists) {
			return { success: false, output: `File not found: ${realPath}` };
		}

		const timeout = Math.min(
			MAX_TIMEOUT_MS,
			Math.max(1000, (args.timeout as number) ?? DEFAULT_TIMEOUT_MS),
		);
		const scriptArgs = (args.args as string[]) ?? [];

		try {
			const cmd = [...cmdFactory(realPath), ...scriptArgs];

			const proc = Bun.spawn(cmd, {
				cwd: context.workingDirectory,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env },
			});

			const timeoutId = setTimeout(() => proc.kill(), timeout);

			const [stdoutBuf, stderrBuf] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
			]);

			const exitCode = await proc.exited;
			clearTimeout(timeoutId);

			let stdout = new TextDecoder().decode(stdoutBuf);
			let stderr = new TextDecoder().decode(stderrBuf);

			let truncated = false;
			if (stdout.length > MAX_OUTPUT_BYTES) {
				stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated)`;
				truncated = true;
			}
			if (stderr.length > MAX_OUTPUT_BYTES) {
				stderr = `${stderr.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated)`;
				truncated = true;
			}

			const parts: string[] = [];
			if (stdout.trim()) parts.push(stdout.trim());
			if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
			if (parts.length === 0) parts.push("(no output)");

			const output = `[exit ${exitCode}] ${realPath}\n${parts.join("\n")}`;

			await context.audit.log({
				action: "tool:code.run_file",
				source: "code.run_file",
				detail: `Ran ${realPath} (exit ${exitCode})`,
				success: exitCode === 0,
			});

			return {
				success: exitCode === 0,
				output,
				artifacts: { exitCode, path: realPath, ext, truncated },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Code execution failed: ${msg}` };
		}
	},
};
