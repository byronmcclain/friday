import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 500_000;

interface LanguageConfig {
	extension: string;
	command: (filePath: string) => string[];
}

const LANGUAGES: Record<string, LanguageConfig> = {
	typescript: {
		extension: ".ts",
		command: (f) => ["bun", "run", f],
	},
	javascript: {
		extension: ".js",
		command: (f) => ["bun", "run", f],
	},
	python: {
		extension: ".py",
		command: (f) => ["python3", f],
	},
	bash: {
		extension: ".sh",
		command: (f) => ["bash", f],
	},
	sh: {
		extension: ".sh",
		command: (f) => ["sh", f],
	},
};

export const codeEval: FridayTool = {
	name: "code.eval",
	description:
		"Execute a code snippet in a sandboxed temporary directory. Supports TypeScript, JavaScript, Python, Bash, and sh. Returns stdout, stderr, and exit code.",
	parameters: [
		{
			name: "code",
			type: "string",
			description: "Source code to execute",
			required: true,
		},
		{
			name: "language",
			type: "string",
			description:
				'Language: "typescript", "javascript", "python", "bash", "sh" (default: "typescript")',
			required: false,
			default: "typescript",
		},
		{
			name: "timeout",
			type: "number",
			description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
			required: false,
			default: DEFAULT_TIMEOUT_MS,
		},
	],
	clearance: ["exec-shell"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const code = args.code as string;
		if (!code) {
			return { success: false, output: "Missing required parameter: code" };
		}

		const language = (args.language as string) ?? "typescript";
		const langConfig = LANGUAGES[language];
		if (!langConfig) {
			return {
				success: false,
				output: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGES).join(", ")}`,
			};
		}

		const timeout = Math.min(
			MAX_TIMEOUT_MS,
			Math.max(1000, (args.timeout as number) ?? DEFAULT_TIMEOUT_MS),
		);

		// Create a temporary sandbox directory under OS tmpdir (not working directory)
		const sandboxDir = resolve(tmpdir(), `.friday-sandbox-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);

		try {
			// Write the code to a temp file (Bun.write creates parent dirs)
			const filePath = resolve(sandboxDir, `script${langConfig.extension}`);
			await Bun.write(filePath, code);

			const cmd = langConfig.command(filePath);

			const proc = Bun.spawn(cmd, {
				cwd: sandboxDir,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, NODE_ENV: "sandbox" },
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

			const output = `[exit ${exitCode}] [${language}]\n${parts.join("\n")}`;

			await context.audit.log({
				action: "tool:code.eval",
				source: "code.eval",
				detail: `Executed ${language} snippet (${code.length} chars, exit ${exitCode})`,
				success: exitCode === 0,
			});

			return {
				success: exitCode === 0,
				output,
				artifacts: { exitCode, language, truncated, codeLength: code.length },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Code execution failed: ${msg}` };
		} finally {
			try {
				await Bun.$`rm -rf ${sandboxDir}`.quiet().nothrow();
			} catch {
				/* best-effort cleanup */
			}
		}
	},
};
