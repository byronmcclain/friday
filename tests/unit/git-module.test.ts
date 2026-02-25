import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AuditLogger } from "../../src/audit/logger.ts";
import gitModule from "../../src/modules/git/index.ts";
import { gitStatus } from "../../src/modules/git/status.ts";
import { gitDiff } from "../../src/modules/git/diff.ts";
import { gitLog } from "../../src/modules/git/log.ts";
import { gitCommit } from "../../src/modules/git/commit.ts";
import { gitBranch } from "../../src/modules/git/branch.ts";
import { gitStash } from "../../src/modules/git/stash.ts";
import { gitPush } from "../../src/modules/git/push.ts";
import { gitPull } from "../../src/modules/git/pull.ts";
import type { ToolContext } from "../../src/modules/types.ts";

let testDir: string;
let ctx: ToolContext;

beforeEach(async () => {
	const rawDir = resolve(tmpdir(), `friday-git-test-${Date.now()}`);
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

	// Initialize a git repo in the test dir (disable signing for test isolation)
	await Bun.$`git init ${testDir}`.quiet().nothrow();
	await Bun.$`git -C ${testDir} config user.email "test@friday.ai"`.quiet().nothrow();
	await Bun.$`git -C ${testDir} config user.name "Friday Test"`.quiet().nothrow();
	await Bun.$`git -C ${testDir} config commit.gpgsign false`.quiet().nothrow();
	await Bun.$`git -C ${testDir} config tag.gpgsign false`.quiet().nothrow();

	// Create an initial commit so we have a HEAD
	writeFileSync(resolve(testDir, "README.md"), "# Test\n");
	await Bun.$`git -C ${testDir} add .`.quiet().nothrow();
	await Bun.$`git -C ${testDir} commit -m "initial commit"`.quiet().nothrow();
});

afterEach(() => {
	rmSync(testDir, { recursive: true, force: true });
});

// ─── Module manifest ────────────────────────────────────────────────
describe("git module", () => {
	test("exports valid module manifest", () => {
		expect(gitModule.name).toBe("git");
		expect(gitModule.version).toBe("1.0.0");
		expect(gitModule.tools).toHaveLength(8);
	});

	test("includes all expected tools", () => {
		const names = gitModule.tools.map((t) => t.name);
		expect(names).toContain("git.status");
		expect(names).toContain("git.diff");
		expect(names).toContain("git.log");
		expect(names).toContain("git.commit");
		expect(names).toContain("git.push");
		expect(names).toContain("git.pull");
		expect(names).toContain("git.branch");
		expect(names).toContain("git.stash");
	});

	test("declares required clearances", () => {
		expect(gitModule.clearance).toContain("git-read");
		expect(gitModule.clearance).toContain("git-write");
		expect(gitModule.clearance).toContain("network");
	});
});

// ─── git.status ─────────────────────────────────────────────────────
describe("git.status", () => {
	test("shows clean working tree", async () => {
		const result = await gitStatus.execute({}, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("nothing to commit");
	});

	test("shows modified files", async () => {
		writeFileSync(resolve(testDir, "README.md"), "# Modified\n");
		const result = await gitStatus.execute({}, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("README.md");
	});

	test("supports short format", async () => {
		writeFileSync(resolve(testDir, "new.txt"), "new file\n");
		const result = await gitStatus.execute({ short: true }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("new.txt");
	});

	test("declares git-read clearance", () => {
		expect(gitStatus.clearance).toEqual(["git-read"]);
	});
});

// ─── git.diff ───────────────────────────────────────────────────────
describe("git.diff", () => {
	test("shows no differences on clean tree", async () => {
		const result = await gitDiff.execute({}, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("no differences");
	});

	test("shows unstaged changes", async () => {
		writeFileSync(resolve(testDir, "README.md"), "# Changed\n");
		const result = await gitDiff.execute({}, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Changed");
	});

	test("shows staged changes with --cached", async () => {
		writeFileSync(resolve(testDir, "README.md"), "# Staged\n");
		await Bun.$`git -C ${testDir} add .`.quiet().nothrow();
		const result = await gitDiff.execute({ staged: true }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Staged");
	});

	test("supports stat mode", async () => {
		writeFileSync(resolve(testDir, "README.md"), "# Stat\n");
		const result = await gitDiff.execute({ stat: true }, ctx);
		expect(result.success).toBe(true);
	});

	test("rejects ref starting with dash (flag injection)", async () => {
		const result = await gitDiff.execute({ ref: "--upload-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares git-read clearance", () => {
		expect(gitDiff.clearance).toEqual(["git-read"]);
	});
});

// ─── git.log ────────────────────────────────────────────────────────
describe("git.log", () => {
	test("shows commit history", async () => {
		const result = await gitLog.execute({}, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("initial commit");
	});

	test("respects count parameter", async () => {
		// Add a second commit
		writeFileSync(resolve(testDir, "second.txt"), "two\n");
		await Bun.$`git -C ${testDir} add .`.quiet().nothrow();
		await Bun.$`git -C ${testDir} commit -m "second commit"`.quiet().nothrow();

		const result = await gitLog.execute({ count: 1 }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("second commit");
		expect(result.output).not.toContain("initial commit");
	});

	test("supports verbose format", async () => {
		const result = await gitLog.execute({ oneline: false }, ctx);
		expect(result.success).toBe(true);
		expect(result.output).toContain("initial commit");
	});

	test("rejects ref starting with dash (flag injection)", async () => {
		const result = await gitLog.execute({ ref: "--exec=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares git-read clearance", () => {
		expect(gitLog.clearance).toEqual(["git-read"]);
	});
});

// ─── git.commit ─────────────────────────────────────────────────────
describe("git.commit", () => {
	test("commits staged files", async () => {
		writeFileSync(resolve(testDir, "new.txt"), "content\n");
		const result = await gitCommit.execute(
			{ message: "add new file", files: ["."] },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("add new file");
	});

	test("fails without message", async () => {
		const result = await gitCommit.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("fails when nothing to commit", async () => {
		const result = await gitCommit.execute(
			{ message: "empty" },
			ctx,
		);
		expect(result.success).toBe(false);
	});

	test("rejects files outside working directory", async () => {
		const result = await gitCommit.execute(
			{ message: "test", files: ["../../etc/passwd"] },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("outside working directory");
	});

	test("declares git-write clearance", () => {
		expect(gitCommit.clearance).toEqual(["git-write"]);
	});
});

// ─── git.branch ─────────────────────────────────────────────────────
describe("git.branch", () => {
	test("lists branches", async () => {
		const result = await gitBranch.execute({ action: "list" }, ctx);
		expect(result.success).toBe(true);
		// Branch name depends on git config — could be "main" or "master"
		expect(
			result.output.includes("main") || result.output.includes("master"),
		).toBe(true);
	});

	test("creates and switches to new branch", async () => {
		const result = await gitBranch.execute(
			{ action: "create", name: "feature-test" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("feature-test");

		// Verify we're on the new branch
		const statusResult =
			await Bun.$`git -C ${testDir} rev-parse --abbrev-ref HEAD`.quiet().nothrow();
		expect(statusResult.stdout.toString().trim()).toBe("feature-test");
	});

	test("switches branches", async () => {
		// Create a temp branch and switch back to original
		await Bun.$`git -C ${testDir} branch temp-branch`.quiet().nothrow();

		const result = await gitBranch.execute(
			{ action: "switch", name: "temp-branch" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("temp-branch");
	});

	test("fails create without name", async () => {
		const result = await gitBranch.execute({ action: "create" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("rejects branch name starting with dash (flag injection)", async () => {
		const result = await gitBranch.execute(
			{ action: "create", name: "--option=evil" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares clearances", () => {
		expect(gitBranch.clearance).toContain("git-read");
		expect(gitBranch.clearance).toContain("git-write");
	});
});

// ─── git.stash ──────────────────────────────────────────────────────
describe("git.stash", () => {
	test("stashes changes", async () => {
		writeFileSync(resolve(testDir, "README.md"), "# Stashed\n");
		const result = await gitStash.execute({}, ctx);
		expect(result.success).toBe(true);
	});

	test("lists stashes", async () => {
		const result = await gitStash.execute({ action: "list" }, ctx);
		expect(result.success).toBe(true);
	});

	test("rejects non-numeric stash index", async () => {
		const result = await gitStash.execute(
			{ action: "pop", index: "not-a-number" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares git-write clearance", () => {
		expect(gitStash.clearance).toEqual(["git-write"]);
	});
});

// ─── git.push ───────────────────────────────────────────────────────
describe("git.push", () => {
	test("rejects remote starting with dash", async () => {
		const result = await gitPush.execute({ remote: "--receive-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("rejects branch starting with dash", async () => {
		const result = await gitPush.execute({ branch: "--force" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("fails on detached HEAD without explicit branch", async () => {
		const hash = await Bun.$`git -C ${testDir} rev-parse HEAD`.quiet();
		await Bun.$`git -C ${testDir} checkout ${hash.stdout.toString().trim()}`.quiet().nothrow();

		const result = await gitPush.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Could not determine current branch");
	});

	test("declares clearances", () => {
		expect(gitPush.clearance).toContain("git-write");
		expect(gitPush.clearance).toContain("network");
	});
});

// ─── git.pull ───────────────────────────────────────────────────────
describe("git.pull", () => {
	test("rejects remote starting with dash", async () => {
		const result = await gitPull.execute({ remote: "--upload-pack=evil" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("rejects branch starting with dash", async () => {
		const result = await gitPull.execute({ branch: "--recurse-submodules" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("declares clearances", () => {
		expect(gitPull.clearance).toContain("git-write");
		expect(gitPull.clearance).toContain("network");
	});
});
