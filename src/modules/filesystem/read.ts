import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained } from "./containment.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const fsRead: FridayTool = {
  name: "fs.read",
  description:
    "Read file contents with paging support. Returns lines with 1-based line numbers. Use offset and limit to page through large files. The first call returns total line count so you know the file size.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Absolute or relative file path to read",
      required: true,
    },
    {
      name: "offset",
      type: "number",
      description: "1-based line number to start reading from (default: 1)",
      required: false,
      default: 1,
    },
    {
      name: "limit",
      type: "number",
      description: `Number of lines to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`,
      required: false,
      default: DEFAULT_LIMIT,
    },
  ],
  clearance: ["read-fs"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = args.path as string;
    if (!filePath) {
      return { success: false, output: "Missing required parameter: path" };
    }

    const resolved = resolve(context.workingDirectory, filePath);
    const containment = await assertContained(resolved, context.workingDirectory);
    if (!containment.ok) {
      return { success: false, output: containment.reason };
    }
    const offset = Math.max(1, (args.offset as number) ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, (args.limit as number) ?? DEFAULT_LIMIT));

    try {
      const file = Bun.file(resolved);
      const exists = await file.exists();
      if (!exists) {
        return { success: false, output: `File not found: ${resolved}` };
      }

      if (file.size > MAX_FILE_SIZE) {
        return {
          success: false,
          output: `File too large: ${resolved} is ${(file.size / (1024 * 1024)).toFixed(1)}MB (max ${MAX_FILE_SIZE / (1024 * 1024)}MB). Use bash.exec with head/tail for large files.`,
        };
      }

      const text = await file.text();
      const allLines = text.split("\n");
      const totalLines = allLines.length;

      // offset is 1-based: line 1 = index 0
      const startIndex = offset - 1;
      const slice = allLines.slice(startIndex, startIndex + limit);

      // Format with line numbers like cat -n
      const numbered = slice
        .map((line, i) => {
          const lineNum = String(offset + i).padStart(6, " ");
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      const endLine = Math.min(offset + slice.length - 1, totalLines);
      const header = `[${resolved}] lines ${offset}-${endLine} of ${totalLines}`;
      const hasMore = endLine < totalLines;
      const footer = hasMore
        ? `\n... ${totalLines - endLine} more lines. Use offset=${endLine + 1} to continue.`
        : "";

      await context.audit.log({
        action: "tool:fs.read",
        source: "fs.read",
        detail: `Read ${resolved} lines ${offset}-${endLine}/${totalLines}`,
        success: true,
      });

      return {
        success: true,
        output: `${header}\n${numbered}${footer}`,
        artifacts: { totalLines, offset, limit, hasMore, path: resolved },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to read ${resolved}: ${msg}` };
    }
  },
};
