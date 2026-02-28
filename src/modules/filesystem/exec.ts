import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained, getProtectedPaths } from "./containment.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1MB output cap

export const bashExec: FridayTool = {
  name: "bash.exec",
  description:
    "Execute a shell command via bash. Returns stdout, stderr, and exit code. Use for git, build tools, test runners, and other CLI operations that don't have dedicated tools.",
  parameters: [
    {
      name: "command",
      type: "string",
      description: "Shell command to execute",
      required: true,
    },
    {
      name: "cwd",
      type: "string",
      description: "Working directory for the command (default: tool context working directory)",
      required: false,
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

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = args.command as string;
    if (!command) {
      return {
        success: false,
        output: "Missing required parameter: command",
      };
    }

    const cwd = args.cwd
      ? resolve(context.workingDirectory, args.cwd as string)
      : context.workingDirectory;

    // Validate cwd is contained within working directory
    const cwdCheck = await assertContained(cwd, context.workingDirectory);
    if (!cwdCheck.ok) {
      return { success: false, output: `Access denied: cwd escapes working directory` };
    }

    // Best-effort heuristic: reject commands that reference protected paths.
    // NOTE: This string-match check is easily bypassed (e.g. via variables, symlinks,
    // or path encoding). The real security boundary is the `exec-shell` clearance gate
    // which requires explicit user permission before any shell command runs.
    for (const pp of getProtectedPaths()) {
      if (command.includes(pp)) {
        await context.audit.log({
          action: "genesis:write-denied",
          source: "bash.exec",
          detail: `Blocked command referencing protected path: ${command.slice(0, 200)}`,
          success: false,
        });
        return { success: false, output: "Access denied: command references a protected path (GENESIS.md is BOSS-only)" };
      }
    }

    const timeout = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1000, (args.timeout as number) ?? DEFAULT_TIMEOUT_MS),
    );

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd,
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

      // Truncate oversized output
      let truncated = false;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated, ${stdout.length} total bytes)`;
        truncated = true;
      }
      if (stderr.length > MAX_OUTPUT_BYTES) {
        stderr = `${stderr.slice(0, MAX_OUTPUT_BYTES)}\n... (truncated, ${stderr.length} total bytes)`;
        truncated = true;
      }

      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`[stderr]\n${stderr}`);
      if (parts.length === 0) parts.push("(no output)");

      const output = `[exit ${exitCode}]\n${parts.join("\n")}`;

      await context.audit.log({
        action: "tool:bash.exec",
        source: "bash.exec",
        detail: `Executed: ${command.slice(0, 200)}${command.length > 200 ? "..." : ""} (exit ${exitCode})`,
        success: exitCode === 0,
      });

      return {
        success: exitCode === 0,
        output,
        artifacts: { exitCode, cwd, truncated },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to execute command: ${msg}`,
      };
    }
  },
};
