import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained, isProtectedPath } from "./containment.ts";

export const fsDelete: FridayTool = {
  name: "fs.delete",
  description: "Delete a file or directory. Directories require the recursive flag.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path to delete",
      required: true,
    },
    {
      name: "recursive",
      type: "boolean",
      description: "Required for deleting non-empty directories (default: false)",
      required: false,
      default: false,
    },
  ],
  clearance: ["delete-fs"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = args.path as string;
    const recursive = (args.recursive as boolean) ?? false;

    if (!filePath) {
      return { success: false, output: "Missing required parameter: path" };
    }

    const resolved = resolve(context.workingDirectory, filePath);
    const containment = await assertContained(resolved, context.workingDirectory);
    if (!containment.ok) {
      return { success: false, output: containment.reason };
    }

    if (isProtectedPath(resolved)) {
      await context.audit.log({
        action: "genesis:write-denied",
        source: "fs.delete",
        detail: `Blocked deletion of protected path: ${resolved}`,
        success: false,
      });
      return { success: false, output: "Access denied: path is protected" };
    }

    try {
      await rm(resolved, { recursive, force: false });

      await context.audit.log({
        action: "tool:fs.delete",
        source: "fs.delete",
        detail: `Deleted: ${resolved}`,
        success: true,
      });

      return {
        success: true,
        output: `Deleted: ${resolved}`,
        artifacts: { path: resolved },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // If rm failed on a directory without recursive, provide a helpful hint
      // Error varies by platform: EISDIR, EPERM, ENOTEMPTY, EFAULT (Bun), or "is a directory"
      if (!recursive && (msg.includes("is a directory") || msg.includes("EISDIR") || msg.includes("EPERM") || msg.includes("ENOTEMPTY") || msg.includes("EFAULT"))) {
        return {
          success: false,
          output: `${resolved} is a directory. Set recursive=true to delete.`,
        };
      }

      return {
        success: false,
        output: `Failed to delete ${resolved}: ${msg}`,
      };
    }
  },
};
