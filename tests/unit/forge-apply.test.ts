import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, realpath } from "node:fs/promises";
import { forgeApply } from "../../src/modules/forge/apply.ts";
import type { ForgeProposal } from "../../src/modules/forge/types.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { setProtectedPaths } from "../../src/modules/filesystem/containment.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-apply";

function makeMemory(proposals: Record<string, ForgeProposal>) {
  return {
    get: async <T>(key: string): Promise<T | undefined> => proposals[key] as T | undefined,
    set: async <T>(key: string, value: T): Promise<void> => {
      (proposals as Record<string, unknown>)[key] = value;
    },
    delete: async (key: string): Promise<void> => {
      delete proposals[key];
    },
    list: async (): Promise<string[]> => Object.keys(proposals),
  };
}

function makeContext(opts: { proposal: Omit<ForgeProposal, "id" | "createdAt"> & { moduleName: string } }): ToolContext {
  const proposalId = opts.proposal.moduleName === "../etc" ? "test-escape" : "test-file-escape";
  const proposal: ForgeProposal = {
    id: proposalId,
    action: opts.proposal.action as "create" | "patch",
    moduleName: opts.proposal.moduleName,
    description: opts.proposal.description,
    files: opts.proposal.files,
    createdAt: new Date().toISOString(),
  };
  const proposals: Record<string, ForgeProposal> = { [`proposal:${proposalId}`]: proposal };
  return {
    workingDirectory: TEST_FORGE_DIR,
    audit: new AuditLogger(),
    signal: new SignalBus(),
    memory: makeMemory(proposals),
  };
}

describe("forge_apply tool", () => {
  let context: ToolContext;
  let proposals: Record<string, ForgeProposal>;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    proposals = {};
    context = {
      workingDirectory: TEST_FORGE_DIR,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: makeMemory(proposals),
    };
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("has correct name and clearance", () => {
    expect(forgeApply.name).toBe("forge_apply");
    expect(forgeApply.clearance).toContain("write-fs");
    expect(forgeApply.clearance).toContain("forge-modify");
  });

  test("requires proposalId parameter", async () => {
    const result = await forgeApply.execute({}, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("proposalId");
  });

  test("rejects unknown proposalId", async () => {
    const result = await forgeApply.execute(
      { proposalId: "nonexistent", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  test("writes files for a create proposal", async () => {
    const proposal: ForgeProposal = {
      id: "test-id",
      action: "create",
      moduleName: "weather",
      description: "Weather module",
      files: [
        { path: "index.ts", content: "export default { name: 'weather' };" },
      ],
      createdAt: new Date().toISOString(),
    };
    proposals["proposal:test-id"] = proposal;

    const result = await forgeApply.execute(
      { proposalId: "test-id", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(true);

    const written = Bun.file(`${TEST_FORGE_DIR}/weather/index.ts`);
    expect(await written.exists()).toBe(true);
    expect(await written.text()).toBe("export default { name: 'weather' };");
  });

  test("rejects module names that escape forge directory via prefix collision", async () => {
    const result = await forgeApply.execute(
      { proposalId: "test-escape", forgeDir: "/tmp/forge" },
      makeContext({ proposal: { moduleName: "../etc", files: [], action: "create", description: "x" } }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("escapes forge directory");
  });

  test("rejects file paths that escape module directory via prefix collision", async () => {
    const result = await forgeApply.execute(
      { proposalId: "test-file-escape", forgeDir: "/tmp/forge" },
      makeContext({ proposal: { moduleName: "test-mod", files: [{ path: "../../etc/passwd", content: "x" }], action: "create", description: "x" } }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("escapes module directory");
  });

  test("creates backup for patch action", async () => {
    // Create existing module on disk and in manifest
    await mkdir(`${TEST_FORGE_DIR}/weather`, { recursive: true });
    await Bun.write(`${TEST_FORGE_DIR}/weather/index.ts`, "old content");
    const { ForgeManifestManager } = await import("../../src/modules/forge/manifest.ts");
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const proposal: ForgeProposal = {
      id: "patch-id",
      action: "patch",
      moduleName: "weather",
      description: "Fix weather",
      files: [{ path: "index.ts", content: "new content" }],
      createdAt: new Date().toISOString(),
    };
    proposals["proposal:patch-id"] = proposal;

    const result = await forgeApply.execute(
      { proposalId: "patch-id", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(true);

    // Check backup was created
    const backupDir = `${TEST_FORGE_DIR}/.backups`;
    const backupFile = Bun.file(`${TEST_FORGE_DIR}/weather/index.ts`);
    expect(await backupFile.text()).toBe("new content");

    // Verify backup directory exists
    const backups = new Bun.Glob("weather-*/**").scan({ cwd: backupDir });
    let backupCount = 0;
    for await (const _ of backups) backupCount++;
    expect(backupCount).toBeGreaterThan(0);
  });
});

describe("forge_apply — Genesis protection", () => {
  let context: ToolContext;
  let proposals: Record<string, ForgeProposal>;
  let resolvedForgeDir: string;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    // Resolve symlinks so protected path matches realpath resolution (macOS /tmp -> /private/tmp)
    resolvedForgeDir = await realpath(TEST_FORGE_DIR);
    proposals = {};
    context = {
      workingDirectory: resolvedForgeDir,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: makeMemory(proposals),
    };
    setProtectedPaths([`${resolvedForgeDir}/evil-module/GENESIS.md`]);
  });

  afterEach(async () => {
    setProtectedPaths([]);
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("rejects proposal containing file that matches a protected path", async () => {
    const proposalId = "genesis-attack";
    proposals[`proposal:${proposalId}`] = {
      id: proposalId,
      action: "create",
      moduleName: "evil-module",
      description: "Targets genesis",
      files: [
        { path: "index.ts", content: "export default { name: 'evil', tools: [], protocols: [], knowledge: [], triggers: [], clearance: [], version: '1.0.0', description: 'evil' };" },
        { path: "GENESIS.md", content: "Hacked identity" },
      ],
      createdAt: new Date().toISOString(),
    };

    const result = await forgeApply.execute(
      { proposalId, forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("protected path");
  });
});
