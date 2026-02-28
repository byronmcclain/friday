import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained, isProtectedPath } from "./containment.ts";

export const fsWrite: FridayTool = {
  name: "fs.write",
  description:
    "Write content to a file. Creates parent directories if needed. Can append or overwrite.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "File path to write to",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "Content to write",
      required: true,
    },
    {
      name: "append",
      type: "boolean",
      description: "Append to file instead of overwriting (default: false)",
      required: false,
      default: false,
    },
  ],
  clearance: ["write-fs"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = args.path as string;
    const content = args.content as string;
    const append = (args.append as boolean) ?? false;

    if (!filePath) {
      return { success: false, output: "Missing required parameter: path" };
    }
    if (content === undefined || content === null) {
      return {
        success: false,
        output: "Missing required parameter: content",
      };
    }

    const resolved = resolve(context.workingDirectory, filePath);
    const containment = await assertContained(resolved, context.workingDirectory);
    if (!containment.ok) {
      return { success: false, output: containment.reason };
    }

    if (isProtectedPath(resolved)) {
      await context.audit.log({
        action: "genesis:write-denied",
        source: "fs.write",
        detail: `Blocked write to protected path: ${resolved}`,
        success: false,
      });
      return { success: false, output: "Access denied: path is protected" };
    }

    try {
      await mkdir(dirname(resolved), { recursive: true });

      if (append) {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(resolved, content);
      } else {
        await Bun.write(resolved, content);
      }

      const bytes = Buffer.byteLength(content, "utf-8");
      const action = append ? "Appended to" : "Wrote";

      await context.audit.log({
        action: "tool:fs.write",
        source: "fs.write",
        detail: `${action} ${resolved} (${bytes} bytes)`,
        success: true,
      });

      return {
        success: true,
        output: `${action} ${resolved} (${bytes} bytes)`,
        artifacts: { path: resolved, bytes, append },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to write ${resolved}: ${msg}`,
      };
    }
  },
};
