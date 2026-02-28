import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AuditLogger } from "../../src/audit/logger.ts";
import { fsDelete } from "../../src/modules/filesystem/delete.ts";
import { bashExec } from "../../src/modules/filesystem/exec.ts";
import filesystemModule from "../../src/modules/filesystem/index.ts";
import { fsList } from "../../src/modules/filesystem/list.ts";
import { fsRead } from "../../src/modules/filesystem/read.ts";
import { fsWrite } from "../../src/modules/filesystem/write.ts";
import type { ToolContext } from "../../src/modules/types.ts";

let testDir: string;
let ctx: ToolContext;

beforeEach(() => {
  const rawDir = resolve(tmpdir(), `friday-fs-test-${Date.now()}`);
  mkdirSync(rawDir, { recursive: true });
  // Resolve symlinks so assertContained() matches (e.g., /tmp → /private/tmp on macOS)
  testDir = realpathSync(rawDir);
  ctx = {
    workingDirectory: testDir,
    audit: new AuditLogger(),
    signal: { emit: async () => {} },
    memory: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    },
  };
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Module manifest ────────────────────────────────────────────────
describe("filesystem module", () => {
  test("exports valid module manifest", () => {
    expect(filesystemModule.name).toBe("filesystem");
    expect(filesystemModule.version).toBe("1.0.0");
    expect(filesystemModule.tools).toHaveLength(5);
  });

  test("includes all expected tools", () => {
    const names = filesystemModule.tools.map((t) => t.name);
    expect(names).toContain("fs.read");
    expect(names).toContain("fs.list");
    expect(names).toContain("fs.write");
    expect(names).toContain("fs.delete");
    expect(names).toContain("bash.exec");
  });

  test("declares required clearances", () => {
    expect(filesystemModule.clearance).toContain("read-fs");
    expect(filesystemModule.clearance).toContain("write-fs");
    expect(filesystemModule.clearance).toContain("delete-fs");
    expect(filesystemModule.clearance).toContain("exec-shell");
  });
});

// ─── fs.read ────────────────────────────────────────────────────────
describe("fs.read", () => {
  test("reads entire small file", async () => {
    writeFileSync(resolve(testDir, "hello.txt"), "line1\nline2\nline3\n");
    const result = await fsRead.execute({ path: "hello.txt" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("line1");
    expect(result.output).toContain("line2");
    expect(result.output).toContain("line3");
    expect(result.output).toContain("lines 1-");
  });

  test("returns line numbers", async () => {
    writeFileSync(resolve(testDir, "numbered.txt"), "aaa\nbbb\nccc\n");
    const result = await fsRead.execute({ path: "numbered.txt" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/1\taaa/);
    expect(result.output).toMatch(/2\tbbb/);
    expect(result.output).toMatch(/3\tccc/);
  });

  test("pages with offset and limit", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`);
    writeFileSync(resolve(testDir, "big.txt"), lines.join("\n"));
    const result = await fsRead.execute({ path: "big.txt", offset: 100, limit: 10 }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("lines 100-109 of 500");
    expect(result.output).toContain("line-100");
    expect(result.output).toContain("line-109");
    expect(result.output).not.toContain("line-110");
  });

  test("reports total lines and hasMore", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `L${i + 1}`);
    writeFileSync(resolve(testDir, "paged.txt"), lines.join("\n"));
    const result = await fsRead.execute({ path: "paged.txt", offset: 1, limit: 10 }, ctx);
    expect(result.success).toBe(true);
    expect(result.artifacts?.totalLines).toBe(500);
    expect(result.artifacts?.hasMore).toBe(true);
    expect(result.output).toContain("more lines");
    expect(result.output).toContain("Use offset=11");
  });

  test("handles last page without hasMore", async () => {
    writeFileSync(resolve(testDir, "short.txt"), "a\nb\nc");
    const result = await fsRead.execute({ path: "short.txt", offset: 1, limit: 200 }, ctx);
    expect(result.success).toBe(true);
    expect(result.artifacts?.hasMore).toBe(false);
    expect(result.output).not.toContain("more lines");
  });

  test("clamps limit to max", async () => {
    writeFileSync(resolve(testDir, "clamp.txt"), "x\n");
    const result = await fsRead.execute({ path: "clamp.txt", limit: 99999 }, ctx);
    expect(result.success).toBe(true);
    expect(result.artifacts?.limit).toBe(2000);
  });

  test("fails for missing file", async () => {
    const result = await fsRead.execute({ path: "nope.txt" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  test("fails for missing path parameter", async () => {
    const result = await fsRead.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  test("declares read-fs clearance", () => {
    expect(fsRead.clearance).toEqual(["read-fs"]);
  });
});

// ─── fs.list ────────────────────────────────────────────────────────
describe("fs.list", () => {
  test("lists directory contents", async () => {
    writeFileSync(resolve(testDir, "a.txt"), "a");
    writeFileSync(resolve(testDir, "b.txt"), "b");
    mkdirSync(resolve(testDir, "subdir"));
    const result = await fsList.execute({ path: "." }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("a.txt");
    expect(result.output).toContain("b.txt");
    expect(result.output).toContain("subdir");
    expect(result.output).toContain("dir ");
    expect(result.output).toContain("file");
  });

  test("uses working directory by default", async () => {
    writeFileSync(resolve(testDir, "default.txt"), "x");
    const result = await fsList.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("default.txt");
  });

  test("filters with glob", async () => {
    writeFileSync(resolve(testDir, "app.ts"), "ts");
    writeFileSync(resolve(testDir, "app.js"), "js");
    writeFileSync(resolve(testDir, "readme.md"), "md");
    const result = await fsList.execute({ glob: "*.ts" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("app.ts");
    expect(result.output).not.toContain("app.js");
    expect(result.output).not.toContain("readme.md");
  });

  test("shows file sizes", async () => {
    writeFileSync(resolve(testDir, "sized.txt"), "hello world");
    const result = await fsList.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/\d+\s*B/);
  });

  test("fails for non-directory", async () => {
    writeFileSync(resolve(testDir, "file.txt"), "x");
    const result = await fsList.execute({ path: "file.txt" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Not a directory");
  });

  test("declares read-fs clearance", () => {
    expect(fsList.clearance).toEqual(["read-fs"]);
  });
});

// ─── fs.write ───────────────────────────────────────────────────────
describe("fs.write", () => {
  test("writes a new file", async () => {
    const result = await fsWrite.execute({ path: "new.txt", content: "hello friday" }, ctx);
    expect(result.success).toBe(true);
    const content = await Bun.file(resolve(testDir, "new.txt")).text();
    expect(content).toBe("hello friday");
  });

  test("overwrites existing file", async () => {
    writeFileSync(resolve(testDir, "existing.txt"), "old");
    const result = await fsWrite.execute({ path: "existing.txt", content: "new" }, ctx);
    expect(result.success).toBe(true);
    const content = await Bun.file(resolve(testDir, "existing.txt")).text();
    expect(content).toBe("new");
  });

  test("appends to existing file", async () => {
    writeFileSync(resolve(testDir, "append.txt"), "first");
    const result = await fsWrite.execute(
      { path: "append.txt", content: "-second", append: true },
      ctx,
    );
    expect(result.success).toBe(true);
    const content = await Bun.file(resolve(testDir, "append.txt")).text();
    expect(content).toBe("first-second");
  });

  test("creates parent directories", async () => {
    const result = await fsWrite.execute(
      { path: "deep/nested/dir/file.txt", content: "deep" },
      ctx,
    );
    expect(result.success).toBe(true);
    const content = await Bun.file(resolve(testDir, "deep/nested/dir/file.txt")).text();
    expect(content).toBe("deep");
  });

  test("reports byte count", async () => {
    const result = await fsWrite.execute({ path: "bytes.txt", content: "hello" }, ctx);
    expect(result.success).toBe(true);
    expect(result.artifacts?.bytes).toBe(5);
  });

  test("fails for missing path", async () => {
    const result = await fsWrite.execute({ content: "x" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  test("fails for missing content", async () => {
    const result = await fsWrite.execute({ path: "x.txt" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  test("declares write-fs clearance", () => {
    expect(fsWrite.clearance).toEqual(["write-fs"]);
  });
});

// ─── fs.delete ──────────────────────────────────────────────────────
describe("fs.delete", () => {
  test("deletes a file", async () => {
    const filePath = resolve(testDir, "doomed.txt");
    writeFileSync(filePath, "bye");
    const result = await fsDelete.execute({ path: "doomed.txt" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Deleted:");
    const exists = await Bun.file(filePath).exists();
    expect(exists).toBe(false);
  });

  test("refuses to delete directory without recursive flag", async () => {
    mkdirSync(resolve(testDir, "keep-me"));
    const result = await fsDelete.execute({ path: "keep-me" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("recursive=true");
  });

  test("deletes directory with recursive flag", async () => {
    const dirPath = resolve(testDir, "nuke-me");
    mkdirSync(dirPath);
    writeFileSync(resolve(dirPath, "inner.txt"), "x");
    const result = await fsDelete.execute({ path: "nuke-me", recursive: true }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Deleted:");
  });

  test("fails for nonexistent path", async () => {
    const result = await fsDelete.execute({ path: "ghost.txt" }, ctx);
    expect(result.success).toBe(false);
  });

  test("fails for missing path parameter", async () => {
    const result = await fsDelete.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  test("declares delete-fs clearance", () => {
    expect(fsDelete.clearance).toEqual(["delete-fs"]);
  });
});

// ─── bash.exec ──────────────────────────────────────────────────────
describe("bash.exec", () => {
  test("executes a simple command", async () => {
    const result = await bashExec.execute({ command: "echo hello" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.output).toContain("[exit 0]");
  });

  test("captures stderr", async () => {
    const result = await bashExec.execute({ command: "echo oops >&2" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("[stderr]");
    expect(result.output).toContain("oops");
  });

  test("returns failure for non-zero exit", async () => {
    const result = await bashExec.execute({ command: "exit 42" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("[exit 42]");
    expect(result.artifacts?.exitCode).toBe(42);
  });

  test("runs in specified cwd", async () => {
    const sub = resolve(testDir, "subdir");
    mkdirSync(sub);
    const result = await bashExec.execute({ command: "pwd", cwd: "subdir" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("subdir");
  });

  test("fails for missing command", async () => {
    const result = await bashExec.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  test("handles command with pipes", async () => {
    const result = await bashExec.execute({ command: "echo 'a b c' | tr ' ' '\\n' | wc -l" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("3");
  });

  test("declares exec-shell clearance", () => {
    expect(bashExec.clearance).toEqual(["exec-shell"]);
  });
});
