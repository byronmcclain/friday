import { readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertContained } from "./containment.ts";

export const fsList: FridayTool = {
  name: "fs.list",
  description: "List directory contents with file sizes and types. Non-recursive by default.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Directory path to list (default: working directory)",
      required: false,
      default: ".",
    },
    {
      name: "recursive",
      type: "boolean",
      description: "List contents recursively (default: false)",
      required: false,
      default: false,
    },
    {
      name: "glob",
      type: "string",
      description: 'Glob pattern to filter entries (e.g. "*.ts", "**/*.test.ts")',
      required: false,
    },
  ],
  clearance: ["read-fs"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const dirPath = (args.path as string) ?? ".";
    const recursive = (args.recursive as boolean) ?? false;
    const glob = args.glob as string | undefined;
    const resolved = resolve(context.workingDirectory, dirPath);
    const containment = await assertContained(resolved, context.workingDirectory);
    if (!containment.ok) {
      return { success: false, output: containment.reason };
    }

    try {
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        return {
          success: false,
          output: `Not a directory: ${resolved}`,
        };
      }

      let entries: string[];

      if (glob) {
        const scanner = new Bun.Glob(glob);
        entries = [];
        for await (const match of scanner.scan({
          cwd: resolved,
          onlyFiles: false,
        })) {
          entries.push(match);
        }
        entries.sort();
      } else if (recursive) {
        entries = await collectRecursive(resolved, resolved);
      } else {
        entries = await readdir(resolved);
        entries.sort();
      }

      const lines: string[] = [];
      for (const entry of entries) {
        const fullPath = resolve(resolved, entry);

        // Re-check containment: glob results might escape the allowed directory
        const entryContainment = await assertContained(fullPath, context.workingDirectory);
        if (!entryContainment.ok) continue;

        try {
          const s = await stat(fullPath);
          const type = s.isDirectory() ? "dir " : "file";
          const size = s.isDirectory() ? "-" : formatSize(s.size);
          lines.push(`${type}  ${size.padStart(10)}  ${entry}`);
        } catch {
          lines.push(`????  ${"-".padStart(10)}  ${entry}`);
        }
      }

      const header = `[${resolved}] ${entries.length} entries`;

      await context.audit.log({
        action: "tool:fs.list",
        source: "fs.list",
        detail: `Listed ${resolved} (${entries.length} entries)`,
        success: true,
      });

      return {
        success: true,
        output: lines.length > 0 ? `${header}\n${lines.join("\n")}` : header,
        artifacts: { count: entries.length, path: resolved },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to list ${resolved}: ${msg}` };
    }
  },
};

async function collectRecursive(base: string, dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relative(base, resolve(dir, entry.name));
    results.push(rel);
    if (entry.isDirectory()) {
      results.push(...(await collectRecursive(base, resolve(dir, entry.name))));
    }
  }
  results.sort();
  return results;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
