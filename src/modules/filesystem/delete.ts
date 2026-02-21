import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

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

    try {
      const info = await stat(resolved);
      const isDir = info.isDirectory();

      if (isDir && !recursive) {
        return {
          success: false,
          output: `${resolved} is a directory. Set recursive=true to delete.`,
        };
      }

      await rm(resolved, { recursive, force: false });
      const what = isDir ? "directory" : "file";

      await context.audit.log({
        action: "tool:fs.delete",
        source: "fs.delete",
        detail: `Deleted ${what}: ${resolved}`,
        success: true,
      });

      return {
        success: true,
        output: `Deleted ${what}: ${resolved}`,
        artifacts: { path: resolved, type: what },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to delete ${resolved}: ${msg}`,
      };
    }
  },
};
