import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AuditLogger } from "../../src/audit/logger.ts";
import codeExecModule from "../../src/modules/code-exec/index.ts";
import { codeEval } from "../../src/modules/code-exec/eval.ts";
import { codeRunFile } from "../../src/modules/code-exec/run-file.ts";
import type { ToolContext } from "../../src/modules/types.ts";

let testDir: string;
let ctx: ToolContext;

beforeEach(() => {
	const rawDir = resolve(tmpdir(), `friday-exec-test-${Date.now()}`);
	mkdirSync(rawDir, { recursive: true });
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
describe("code-exec module", () => {
	test("exports valid module manifest", () => {
		expect(codeExecModule.name).toBe("code-exec");
		expect(codeExecModule.version).toBe("1.0.0");
		expect(codeExecModule.tools).toHaveLength(2);
	});

	test("includes all expected tools", () => {
		const names = codeExecModule.tools.map((t) => t.name);
		expect(names).toContain("code.eval");
		expect(names).toContain("code.run_file");
	});

	test("declares required clearances", () => {
		expect(codeExecModule.clearance).toContain("exec-shell");
		expect(codeExecModule.clearance).toContain("read-fs");
	});
});

// ─── code.eval ──────────────────────────────────────────────────────
describe("code.eval", () => {
	test("executes typescript code", async () => {
		const result = await codeEval.execute(
			{ code: 'console.log("hello from ts");' },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello from ts");
		expect(result.output).toContain("[exit 0]");
	});

	test("executes javascript code", async () => {
		const result = await codeEval.execute(
			{
				code: 'console.log(2 + 2);',
				language: "javascript",
			},
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("4");
	});

	test("executes bash code", async () => {
		const result = await codeEval.execute(
			{ code: 'echo "hello bash"', language: "bash" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello bash");
	});

	test("captures non-zero exit code", async () => {
		const result = await codeEval.execute(
			{ code: "process.exit(1);", language: "typescript" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("[exit 1]");
	});

	test("rejects unsupported language", async () => {
		const result = await codeEval.execute(
			{ code: "code", language: "cobol" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Unsupported language");
	});

	test("fails without code parameter", async () => {
		const result = await codeEval.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("sandbox is created under tmpdir, not working directory", async () => {
		const result = await codeEval.execute(
			{ code: 'console.log(process.cwd());' },
			ctx,
		);
		expect(result.success).toBe(true);
		// The CWD printed by the sandbox script should be under OS tmpdir, not the working directory
		const osTmpdir = realpathSync(tmpdir());
		const lines = result.output.split("\n");
		const cwdLine = lines.find((l) => l.includes(osTmpdir));
		expect(cwdLine).toBeDefined();
		// It should NOT be under the working directory
		const { readdirSync } = await import("node:fs");
		const entries = readdirSync(testDir);
		const sandboxDirs = entries.filter((e) => e.startsWith(".friday-sandbox-"));
		expect(sandboxDirs).toHaveLength(0);
	});

	test("cleans up sandbox directory", async () => {
		await codeEval.execute(
			{ code: 'console.log("cleanup test");' },
			ctx,
		);
		// Verify no sandbox dirs remain in working directory
		const { readdirSync } = await import("node:fs");
		const entries = readdirSync(testDir);
		const sandboxDirs = entries.filter((e) => e.startsWith(".friday-sandbox-"));
		expect(sandboxDirs).toHaveLength(0);
	});

	test("declares exec-shell clearance", () => {
		expect(codeEval.clearance).toEqual(["exec-shell"]);
	});
});

// ─── code.run_file ──────────────────────────────────────────────────
describe("code.run_file", () => {
	test("runs a typescript file", async () => {
		writeFileSync(
			resolve(testDir, "hello.ts"),
			'console.log("file runner ts");',
		);
		const result = await codeRunFile.execute({ path: "hello.ts" }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("file runner ts");
	});

	test("runs a bash file", async () => {
		writeFileSync(resolve(testDir, "hello.sh"), 'echo "file runner bash"');
		const result = await codeRunFile.execute({ path: "hello.sh" }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("file runner bash");
	});

	test("passes arguments to script", async () => {
		writeFileSync(
			resolve(testDir, "args.ts"),
			"console.log(Bun.argv.slice(2).join(','));",
		);
		const result = await codeRunFile.execute(
			{ path: "args.ts", args: ["foo", "bar"] },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("foo,bar");
	});

	test("fails for missing file", async () => {
		const result = await codeRunFile.execute({ path: "nope.ts" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("not found");
	});

	test("fails for unsupported extension", async () => {
		writeFileSync(resolve(testDir, "hello.xyz"), "data");
		const result = await codeRunFile.execute({ path: "hello.xyz" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Unsupported");
	});

	test("fails without path parameter", async () => {
		const result = await codeRunFile.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("rejects path traversal outside working directory", async () => {
		const result = await codeRunFile.execute({ path: "../../etc/passwd" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Access denied");
	});

	test("rejects path with no extension", async () => {
		writeFileSync(resolve(testDir, "Makefile"), "all:\n\techo hi\n");
		const result = await codeRunFile.execute({ path: "Makefile" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("no extension");
	});

	test("declares exec-shell and read-fs clearance", () => {
		expect(codeRunFile.clearance).toContain("exec-shell");
		expect(codeRunFile.clearance).toContain("read-fs");
	});
});
