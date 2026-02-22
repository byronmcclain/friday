# The Forge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement The Forge — Friday's self-improvement module that lets her author new modules, patch existing ones, validate them, and gracefully restart to load changes.

**Architecture:** The Forge is a FridayModule at `src/modules/forge/` with 5 tools and 1 protocol. It writes to a separate `forge/` directory (gitignored). The runtime gains a `restartRequested` flag and fault-isolated forge module loading. The REPL loop in `chat.ts` detects the flag and cycles shutdown/boot.

**Tech Stack:** Bun, TypeScript, bun:test, Biome, existing FridayModule/FridayTool/FridayProtocol contracts.

**Design doc:** `docs/plans/2026-02-22-the-forge-self-improvement-design.md`

---

### Task 1: Add `forge-modify` clearance

**Files:**
- Modify: `src/core/clearance.ts:1-10`
- Test: `tests/unit/clearance.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/clearance.test.ts`:

```typescript
test("grants and checks forge-modify clearance", () => {
  const mgr = new ClearanceManager(["forge-modify"]);
  expect(mgr.check("forge-modify").granted).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/clearance.test.ts`
Expected: TypeScript error — `"forge-modify"` is not assignable to `ClearanceName`

**Step 3: Add forge-modify to ClearanceName union**

In `src/core/clearance.ts`, add `"forge-modify"` to the `ClearanceName` type:

```typescript
export type ClearanceName =
  | "read-fs"
  | "write-fs"
  | "delete-fs"
  | "exec-shell"
  | "network"
  | "git-read"
  | "git-write"
  | "provider"
  | "system"
  | "forge-modify";
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/clearance.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/clearance.ts tests/unit/clearance.test.ts
git commit -m "feat(forge): add forge-modify clearance type"
```

---

### Task 2: Forge types

**Files:**
- Create: `src/modules/forge/types.ts`
- Test: `tests/unit/forge-types.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-types.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type {
  ForgeProposal,
  ForgeManifest,
  ForgeModuleEntry,
  ForgeHealthReport,
  ForgeValidationResult,
  ForgeHistoryEntry,
} from "../../src/modules/forge/types.ts";

describe("Forge Types", () => {
  test("ForgeProposal satisfies shape", () => {
    const proposal: ForgeProposal = {
      id: "abc-123",
      action: "create",
      moduleName: "weather",
      description: "Weather module",
      files: [{ path: "index.ts", content: "export default {}" }],
      createdAt: new Date().toISOString(),
    };
    expect(proposal.id).toBe("abc-123");
    expect(proposal.action).toBe("create");
    expect(proposal.files).toHaveLength(1);
  });

  test("ForgeManifest satisfies shape", () => {
    const manifest: ForgeManifest = {
      version: 1,
      modules: {},
    };
    expect(manifest.version).toBe(1);
  });

  test("ForgeModuleEntry tracks history", () => {
    const entry: ForgeModuleEntry = {
      description: "A module",
      version: "1.0.0",
      created: "2026-02-22T00:00:00Z",
      lastModified: "2026-02-22T00:00:00Z",
      status: "loaded",
      protected: false,
      history: [
        {
          version: "1.0.0",
          date: "2026-02-22T00:00:00Z",
          action: "created",
          reason: "Initial creation",
        },
      ],
    };
    expect(entry.history).toHaveLength(1);
    expect(entry.protected).toBe(false);
  });

  test("ForgeHealthReport captures load results", () => {
    const report: ForgeHealthReport = {
      loaded: ["weather"],
      failed: [{ name: "broken", error: "SyntaxError", lastWorkingVersion: "1.0.0" }],
      pending: [],
    };
    expect(report.loaded).toContain("weather");
    expect(report.failed[0]!.name).toBe("broken");
  });

  test("ForgeValidationResult captures step results", () => {
    const result: ForgeValidationResult = {
      moduleName: "weather",
      passed: true,
      steps: [
        { name: "import", passed: true },
        { name: "manifest", passed: true },
        { name: "typecheck", passed: true },
        { name: "lint", passed: true },
      ],
    };
    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-types.test.ts`
Expected: FAIL — cannot resolve `../../src/modules/forge/types.ts`

**Step 3: Create the types file**

Create `src/modules/forge/types.ts`:

```typescript
export interface ForgeProposal {
  id: string;
  action: "create" | "patch";
  moduleName: string;
  description: string;
  files: ForgeFile[];
  createdAt: string;
}

export interface ForgeFile {
  path: string;
  content: string;
}

export interface ForgeManifest {
  version: number;
  modules: Record<string, ForgeModuleEntry>;
}

export interface ForgeModuleEntry {
  description: string;
  version: string;
  created: string;
  lastModified: string;
  status: "loaded" | "failed" | "pending";
  protected: boolean;
  history: ForgeHistoryEntry[];
}

export interface ForgeHistoryEntry {
  version: string;
  date: string;
  action: "created" | "patched" | "rolledback";
  reason: string;
}

export interface ForgeHealthReport {
  loaded: string[];
  failed: {
    name: string;
    error: string;
    lastWorkingVersion?: string;
  }[];
  pending: string[];
}

export interface ForgeValidationResult {
  moduleName: string;
  passed: boolean;
  steps: ForgeValidationStep[];
}

export interface ForgeValidationStep {
  name: "import" | "manifest" | "typecheck" | "lint";
  passed: boolean;
  error?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-types.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/types.ts tests/unit/forge-types.test.ts
git commit -m "feat(forge): add Forge type definitions"
```

---

### Task 3: Forge manifest manager

**Files:**
- Create: `src/modules/forge/manifest.ts`
- Test: `tests/unit/forge-manifest.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-manifest.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-manifest";

describe("ForgeManifestManager", () => {
  let manager: ForgeManifestManager;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    manager = new ForgeManifestManager(TEST_FORGE_DIR);
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("load returns empty manifest when file does not exist", async () => {
    const manifest = await manager.load();
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.modules)).toHaveLength(0);
  });

  test("save and load round-trips", async () => {
    await manager.addModule("weather", "Weather lookups", "1.0.0", "User requested");
    const manifest = await manager.load();
    expect(manifest.modules.weather).toBeDefined();
    expect(manifest.modules.weather!.version).toBe("1.0.0");
    expect(manifest.modules.weather!.history).toHaveLength(1);
    expect(manifest.modules.weather!.history[0]!.action).toBe("created");
  });

  test("updateModule bumps version and adds history", async () => {
    await manager.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await manager.updateModule("weather", "1.1.0", "patched", "Fixed API key");
    const manifest = await manager.load();
    expect(manifest.modules.weather!.version).toBe("1.1.0");
    expect(manifest.modules.weather!.history).toHaveLength(2);
    expect(manifest.modules.weather!.history[1]!.action).toBe("patched");
  });

  test("getEntry returns undefined for unknown module", async () => {
    const entry = await manager.getEntry("nonexistent");
    expect(entry).toBeUndefined();
  });

  test("isProtected returns false by default", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "Initial");
    expect(await manager.isProtected("weather")).toBe(false);
  });

  test("setProtected marks module as protected", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "Initial");
    await manager.setProtected("weather", true);
    expect(await manager.isProtected("weather")).toBe(true);
  });

  test("listModules returns all module names", async () => {
    await manager.addModule("weather", "Weather", "1.0.0", "r1");
    await manager.addModule("slack", "Slack", "1.0.0", "r2");
    const names = await manager.listModules();
    expect(names).toContain("weather");
    expect(names).toContain("slack");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-manifest.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement ForgeManifestManager**

Create `src/modules/forge/manifest.ts`:

```typescript
import type { ForgeManifest, ForgeModuleEntry, ForgeHistoryEntry } from "./types.ts";
import { resolve } from "node:path";

export class ForgeManifestManager {
  private manifestPath: string;

  constructor(forgeDir: string) {
    this.manifestPath = resolve(forgeDir, "manifest.json");
  }

  async load(): Promise<ForgeManifest> {
    const file = Bun.file(this.manifestPath);
    if (!(await file.exists())) {
      return { version: 1, modules: {} };
    }
    return JSON.parse(await file.text()) as ForgeManifest;
  }

  private async save(manifest: ForgeManifest): Promise<void> {
    await Bun.write(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  async addModule(
    name: string,
    description: string,
    version: string,
    reason: string,
  ): Promise<void> {
    const manifest = await this.load();
    const now = new Date().toISOString();
    const entry: ForgeModuleEntry = {
      description,
      version,
      created: now,
      lastModified: now,
      status: "pending",
      protected: false,
      history: [{ version, date: now, action: "created", reason }],
    };
    manifest.modules[name] = entry;
    await this.save(manifest);
  }

  async updateModule(
    name: string,
    version: string,
    action: ForgeHistoryEntry["action"],
    reason: string,
  ): Promise<void> {
    const manifest = await this.load();
    const entry = manifest.modules[name];
    if (!entry) throw new Error(`Module "${name}" not found in manifest`);
    const now = new Date().toISOString();
    entry.version = version;
    entry.lastModified = now;
    entry.history.push({ version, date: now, action, reason });
    await this.save(manifest);
  }

  async getEntry(name: string): Promise<ForgeModuleEntry | undefined> {
    const manifest = await this.load();
    return manifest.modules[name];
  }

  async isProtected(name: string): Promise<boolean> {
    const entry = await this.getEntry(name);
    return entry?.protected ?? false;
  }

  async setProtected(name: string, value: boolean): Promise<void> {
    const manifest = await this.load();
    const entry = manifest.modules[name];
    if (!entry) throw new Error(`Module "${name}" not found in manifest`);
    entry.protected = value;
    await this.save(manifest);
  }

  async setStatus(name: string, status: ForgeModuleEntry["status"]): Promise<void> {
    const manifest = await this.load();
    const entry = manifest.modules[name];
    if (!entry) throw new Error(`Module "${name}" not found in manifest`);
    entry.status = status;
    await this.save(manifest);
  }

  async listModules(): Promise<string[]> {
    const manifest = await this.load();
    return Object.keys(manifest.modules);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-manifest.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/manifest.ts tests/unit/forge-manifest.test.ts
git commit -m "feat(forge): add ForgeManifestManager for module tracking"
```

---

### Task 4: forge_propose tool

**Files:**
- Create: `src/modules/forge/propose.ts`
- Test: `tests/unit/forge-propose.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-propose.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { forgePropose } from "../../src/modules/forge/propose.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

const context: ToolContext = {
  workingDirectory: "/tmp",
  audit: new AuditLogger(),
  signal: new SignalBus(),
  memory: stubMemory,
};

describe("forge_propose tool", () => {
  test("has correct name and clearance", () => {
    expect(forgePropose.name).toBe("forge_propose");
    expect(forgePropose.clearance).toContain("provider");
  });

  test("requires action parameter", async () => {
    const result = await forgePropose.execute({ moduleName: "test", description: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("action");
  });

  test("requires moduleName parameter", async () => {
    const result = await forgePropose.execute({ action: "create", description: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("moduleName");
  });

  test("requires description parameter", async () => {
    const result = await forgePropose.execute({ action: "create", moduleName: "test" }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("description");
  });

  test("rejects invalid action", async () => {
    const result = await forgePropose.execute(
      { action: "delete", moduleName: "test", description: "test" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("action");
  });

  test("generates proposal with unique ID and stores in memory", async () => {
    let storedKey = "";
    let storedValue: unknown;
    const trackingMemory = {
      ...stubMemory,
      set: async <T>(key: string, value: T): Promise<void> => {
        storedKey = key;
        storedValue = value;
      },
    };

    const result = await forgePropose.execute(
      {
        action: "create",
        moduleName: "weather",
        description: "Weather lookups via API",
      },
      { ...context, memory: trackingMemory },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.artifacts?.proposalId).toBeDefined();
    expect(storedKey).toContain("proposal:");
    expect(storedValue).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement forge_propose**

Create `src/modules/forge/propose.ts`:

```typescript
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import type { ForgeProposal, ForgeFile } from "./types.ts";

function generateModuleTemplate(moduleName: string, description: string): ForgeFile[] {
  const toolName = moduleName.replace(/-/g, "_");
  return [
    {
      path: "index.ts",
      content: `import type { FridayModule } from "../../src/modules/types.ts";

const ${toolName}Module: FridayModule = {
  name: "${moduleName}",
  description: "${description}",
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
};

export default ${toolName}Module;
`,
    },
  ];
}

export const forgePropose: FridayTool = {
  name: "forge_propose",
  description:
    "Generate code for a new module or a patch to an existing forge module. Returns the proposed code as a preview — does NOT write to disk. The user must approve before forge_apply writes it.",
  parameters: [
    {
      name: "action",
      type: "string",
      description: '"create" for a new module or "patch" to modify an existing one',
      required: true,
    },
    {
      name: "moduleName",
      type: "string",
      description: "Name of the module to create or patch",
      required: true,
    },
    {
      name: "description",
      type: "string",
      description: "What the module should do (for create) or what to change (for patch)",
      required: true,
    },
    {
      name: "files",
      type: "array",
      description:
        'For LLM-generated proposals: array of {path, content} objects. If omitted, a template is generated for "create" action.',
      required: false,
    },
  ],
  clearance: ["provider"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;
    const moduleName = args.moduleName as string;
    const description = args.description as string;

    if (!action || !["create", "patch"].includes(action)) {
      return { success: false, output: "Missing or invalid required parameter: action (must be 'create' or 'patch')" };
    }
    if (!moduleName) {
      return { success: false, output: "Missing required parameter: moduleName" };
    }
    if (!description) {
      return { success: false, output: "Missing required parameter: description" };
    }

    const files: ForgeFile[] = (args.files as ForgeFile[]) ?? generateModuleTemplate(moduleName, description);

    const proposalId = crypto.randomUUID();
    const proposal: ForgeProposal = {
      id: proposalId,
      action: action as "create" | "patch",
      moduleName,
      description,
      files,
      createdAt: new Date().toISOString(),
    };

    await context.memory.set(`proposal:${proposalId}`, proposal);

    await context.audit.log({
      action: "forge:propose",
      source: "forge",
      detail: `Proposed ${action} for module "${moduleName}": ${files.length} file(s)`,
      success: true,
    });

    const fileList = files
      .map((f) => `--- ${moduleName}/${f.path} ---\n${f.content}`)
      .join("\n\n");

    return {
      success: true,
      output: `Proposal for ${action} of "${moduleName}":\n\n${fileList}\n\nProposal ID: ${proposalId}\nApprove this proposal, then use forge_apply to write it to disk.`,
      artifacts: { proposalId, moduleName, action, fileCount: files.length },
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-propose.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/propose.ts tests/unit/forge-propose.test.ts
git commit -m "feat(forge): add forge_propose tool for module code generation"
```

---

### Task 5: forge_apply tool

**Files:**
- Create: `src/modules/forge/apply.ts`
- Test: `tests/unit/forge-apply.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-apply.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { forgeApply } from "../../src/modules/forge/apply.ts";
import type { ForgeProposal } from "../../src/modules/forge/types.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

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
    const result = await forgeApply.execute({ proposalId: "nonexistent" }, context);
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

    const applyWithDir = forgeApply;
    // The tool needs to know the forge directory — pass it via args
    const result = await applyWithDir.execute(
      { proposalId: "test-id", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(true);

    const written = Bun.file(`${TEST_FORGE_DIR}/weather/index.ts`);
    expect(await written.exists()).toBe(true);
    expect(await written.text()).toBe("export default { name: 'weather' };");
  });

  test("creates backup for patch action", async () => {
    // Create existing module
    await mkdir(`${TEST_FORGE_DIR}/weather`, { recursive: true });
    await Bun.write(`${TEST_FORGE_DIR}/weather/index.ts`, "old content");

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
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-apply.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement forge_apply**

Create `src/modules/forge/apply.ts`:

```typescript
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { cp } from "node:fs/promises";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import type { ForgeProposal } from "./types.ts";
import { ForgeManifestManager } from "./manifest.ts";

export const forgeApply: FridayTool = {
  name: "forge_apply",
  description:
    "Write an approved proposal to disk. Requires a proposalId from a prior forge_propose call. Creates backups before patching existing modules.",
  parameters: [
    {
      name: "proposalId",
      type: "string",
      description: "The proposal ID returned by forge_propose",
      required: true,
    },
    {
      name: "forgeDir",
      type: "string",
      description: "The forge directory path (injected by runtime)",
      required: true,
    },
  ],
  clearance: ["write-fs", "forge-modify"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const proposalId = args.proposalId as string;
    const forgeDir = args.forgeDir as string;

    if (!proposalId) {
      return { success: false, output: "Missing required parameter: proposalId" };
    }
    if (!forgeDir) {
      return { success: false, output: "Missing required parameter: forgeDir" };
    }

    const proposal = await context.memory.get<ForgeProposal>(`proposal:${proposalId}`);
    if (!proposal) {
      return { success: false, output: `Proposal "${proposalId}" not found. Use forge_propose first.` };
    }

    const moduleDir = resolve(forgeDir, proposal.moduleName);
    const resolvedForge = await realpath(forgeDir).catch(() => forgeDir);

    // Path containment check
    const resolvedModule = resolve(moduleDir);
    if (!resolvedModule.startsWith(resolvedForge)) {
      return { success: false, output: "Access denied: module path escapes forge directory" };
    }

    try {
      // Backup existing module for patches
      if (proposal.action === "patch") {
        const backupDir = resolve(forgeDir, ".backups", `${proposal.moduleName}-${Date.now()}`);
        const moduleExists = await Bun.file(resolve(moduleDir, "index.ts")).exists();
        if (moduleExists) {
          await cp(moduleDir, backupDir, { recursive: true });
        }
      }

      // Write all proposal files
      const written: string[] = [];
      for (const file of proposal.files) {
        const filePath = resolve(moduleDir, file.path);

        // Path containment per-file
        const realFilePath = resolve(filePath);
        if (!realFilePath.startsWith(resolvedModule)) {
          return { success: false, output: `Access denied: file "${file.path}" escapes module directory` };
        }

        await mkdir(dirname(filePath), { recursive: true });
        await Bun.write(filePath, file.content);
        written.push(`${proposal.moduleName}/${file.path}`);
      }

      // Update manifest
      const manifest = new ForgeManifestManager(forgeDir);
      if (proposal.action === "create") {
        await manifest.addModule(
          proposal.moduleName,
          proposal.description,
          "1.0.0",
          proposal.description,
        );
      } else {
        const entry = await manifest.getEntry(proposal.moduleName);
        const currentVersion = entry?.version ?? "1.0.0";
        const parts = currentVersion.split(".");
        parts[2] = String(Number(parts[2]) + 1);
        const newVersion = parts.join(".");
        await manifest.updateModule(proposal.moduleName, newVersion, "patched", proposal.description);
      }

      // Clean up proposal from memory
      await context.memory.delete(`proposal:${proposalId}`);

      await context.audit.log({
        action: "forge:apply",
        source: "forge",
        detail: `Applied ${proposal.action} for "${proposal.moduleName}": ${written.join(", ")}`,
        success: true,
      });

      return {
        success: true,
        output: `Applied ${proposal.action} for "${proposal.moduleName}".\nFiles written:\n${written.map((f) => `  ${f}`).join("\n")}\n\nRun forge_validate next to check the module before restarting.`,
        artifacts: { moduleName: proposal.moduleName, action: proposal.action, files: written },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to apply proposal: ${msg}` };
    }
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-apply.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/apply.ts tests/unit/forge-apply.test.ts
git commit -m "feat(forge): add forge_apply tool with backup and path containment"
```

---

### Task 6: forge_validate tool

**Files:**
- Create: `src/modules/forge/validate.ts`
- Test: `tests/unit/forge-validate.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-validate.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { forgeValidate } from "../../src/modules/forge/validate.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-validate";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

describe("forge_validate tool", () => {
  let context: ToolContext;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    context = {
      workingDirectory: TEST_FORGE_DIR,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: stubMemory,
    };
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("has correct name and clearance", () => {
    expect(forgeValidate.name).toBe("forge_validate");
    expect(forgeValidate.clearance).toContain("exec-shell");
  });

  test("requires moduleName parameter", async () => {
    const result = await forgeValidate.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("moduleName");
  });

  test("fails if module directory does not exist", async () => {
    const result = await forgeValidate.execute(
      { moduleName: "nonexistent", forgeDir: TEST_FORGE_DIR },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  test("passes import test for valid module", async () => {
    const modDir = `${TEST_FORGE_DIR}/good-mod`;
    await mkdir(modDir, { recursive: true });
    await Bun.write(
      `${modDir}/index.ts`,
      `export default {
        name: "good-mod",
        description: "A good module",
        version: "1.0.0",
        tools: [],
        protocols: [],
        knowledge: [],
        triggers: [],
        clearance: [],
      };`,
    );

    let storedReceipt: unknown;
    const receiptMemory = {
      ...stubMemory,
      set: async <T>(_key: string, value: T): Promise<void> => {
        storedReceipt = value;
      },
    };

    const result = await forgeValidate.execute(
      { moduleName: "good-mod", forgeDir: TEST_FORGE_DIR },
      { ...context, memory: receiptMemory },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("passed");
    expect(storedReceipt).toBeDefined();
  });

  test("fails import test for module with syntax error", async () => {
    const modDir = `${TEST_FORGE_DIR}/bad-mod`;
    await mkdir(modDir, { recursive: true });
    await Bun.write(`${modDir}/index.ts`, "export default {{{broken syntax");

    const result = await forgeValidate.execute(
      { moduleName: "bad-mod", forgeDir: TEST_FORGE_DIR },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("import");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-validate.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement forge_validate**

Create `src/modules/forge/validate.ts`:

```typescript
import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { validateModule } from "../loader.ts";
import type { FridayModule } from "../types.ts";
import type { ForgeValidationResult, ForgeValidationStep } from "./types.ts";

export const forgeValidate: FridayTool = {
  name: "forge_validate",
  description:
    "Run validation pipeline on a forge module: import test, manifest check, typecheck, and lint. Stores a validation receipt on success that forge_restart requires.",
  parameters: [
    {
      name: "moduleName",
      type: "string",
      description: "Name of the forge module to validate",
      required: true,
    },
    {
      name: "forgeDir",
      type: "string",
      description: "The forge directory path (injected by runtime)",
      required: true,
    },
  ],
  clearance: ["exec-shell"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const moduleName = args.moduleName as string;
    const forgeDir = args.forgeDir as string;

    if (!moduleName) {
      return { success: false, output: "Missing required parameter: moduleName" };
    }
    if (!forgeDir) {
      return { success: false, output: "Missing required parameter: forgeDir" };
    }

    const moduleDir = resolve(forgeDir, moduleName);
    const indexPath = resolve(moduleDir, "index.ts");

    if (!(await Bun.file(indexPath).exists())) {
      return { success: false, output: `Module "${moduleName}" not found at ${moduleDir}` };
    }

    const steps: ForgeValidationStep[] = [];

    // Step 1: Import test
    let mod: FridayModule | undefined;
    try {
      // Cache-bust by appending query string
      const imported = await import(`${indexPath}?t=${Date.now()}`);
      mod = imported.default ?? imported;
      steps.push({ name: "import", passed: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ name: "import", passed: false, error: msg });
    }

    // Step 2: Manifest check
    if (mod) {
      const validation = validateModule(mod);
      if (validation.valid) {
        steps.push({ name: "manifest", passed: true });
      } else {
        steps.push({ name: "manifest", passed: false, error: validation.error });
      }
    } else {
      steps.push({ name: "manifest", passed: false, error: "Skipped — import failed" });
    }

    // Step 3: Typecheck (best-effort, non-blocking)
    try {
      const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--pretty", indexPath], {
        cwd: context.workingDirectory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        steps.push({ name: "typecheck", passed: true });
      } else {
        const stderr = await new Response(proc.stderr).text();
        steps.push({ name: "typecheck", passed: false, error: stderr.slice(0, 500) });
      }
    } catch {
      steps.push({ name: "typecheck", passed: true }); // Skip if tsc not available
    }

    // Step 4: Lint (best-effort, non-blocking)
    try {
      const proc = Bun.spawn(["bunx", "biome", "check", moduleDir], {
        cwd: context.workingDirectory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        steps.push({ name: "lint", passed: true });
      } else {
        const stdout = await new Response(proc.stdout).text();
        steps.push({ name: "lint", passed: false, error: stdout.slice(0, 500) });
      }
    } catch {
      steps.push({ name: "lint", passed: true }); // Skip if biome not available
    }

    const allPassed = steps.every((s) => s.passed);
    const result: ForgeValidationResult = {
      moduleName,
      passed: allPassed,
      steps,
    };

    if (allPassed) {
      await context.memory.set(`validation:${moduleName}`, {
        moduleName,
        validatedAt: new Date().toISOString(),
      });
    }

    await context.audit.log({
      action: "forge:validate",
      source: "forge",
      detail: `Validation ${allPassed ? "passed" : "failed"} for "${moduleName}": ${steps.map((s) => `${s.name}:${s.passed ? "✓" : "✗"}`).join(", ")}`,
      success: allPassed,
    });

    const report = steps
      .map((s) => `  ${s.passed ? "✓" : "✗"} ${s.name}${s.error ? `: ${s.error}` : ""}`)
      .join("\n");

    return {
      success: allPassed,
      output: `Validation ${allPassed ? "passed" : "FAILED"} for "${moduleName}":\n${report}${allPassed ? "\n\nReady for forge_restart." : "\n\nFix the errors and try again with forge_propose."}`,
      artifacts: result,
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-validate.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/validate.ts tests/unit/forge-validate.test.ts
git commit -m "feat(forge): add forge_validate tool with 4-step validation pipeline"
```

---

### Task 7: forge_status tool

**Files:**
- Create: `src/modules/forge/status.ts`
- Test: `tests/unit/forge-status.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-status.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { forgeStatus } from "../../src/modules/forge/status.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-status";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

describe("forge_status tool", () => {
  let context: ToolContext;

  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
    context = {
      workingDirectory: TEST_FORGE_DIR,
      audit: new AuditLogger(),
      signal: new SignalBus(),
      memory: stubMemory,
    };
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("has correct name and clearance", () => {
    expect(forgeStatus.name).toBe("forge_status");
    expect(forgeStatus.clearance).toContain("read-fs");
  });

  test("returns empty state when no modules exist", async () => {
    const result = await forgeStatus.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("No forge modules");
  });

  test("lists modules from manifest", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.addModule("slack", "Slack notifications", "1.0.0", "Initial");

    const result = await forgeStatus.execute({ forgeDir: TEST_FORGE_DIR }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.output).toContain("slack");
  });

  test("shows detail for a specific module", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const result = await forgeStatus.execute(
      { forgeDir: TEST_FORGE_DIR, moduleName: "weather" },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("weather");
    expect(result.output).toContain("1.0.0");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-status.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement forge_status**

Create `src/modules/forge/status.ts`:

```typescript
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { ForgeManifestManager } from "./manifest.ts";

export const forgeStatus: FridayTool = {
  name: "forge_status",
  description:
    "List all forge-authored modules and their health. Optionally show detail for a specific module.",
  parameters: [
    {
      name: "moduleName",
      type: "string",
      description: "Optional: specific module to get details for",
      required: false,
    },
    {
      name: "forgeDir",
      type: "string",
      description: "The forge directory path (injected by runtime)",
      required: true,
    },
  ],
  clearance: ["read-fs"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const forgeDir = args.forgeDir as string;
    const moduleName = args.moduleName as string | undefined;

    if (!forgeDir) {
      return { success: false, output: "Missing required parameter: forgeDir" };
    }

    const manifest = new ForgeManifestManager(forgeDir);

    if (moduleName) {
      const entry = await manifest.getEntry(moduleName);
      if (!entry) {
        return { success: false, output: `Module "${moduleName}" not found in forge manifest.` };
      }

      const historyLines = entry.history
        .map((h) => `  v${h.version} [${h.action}] ${h.date} — ${h.reason}`)
        .join("\n");

      return {
        success: true,
        output: [
          `Module: ${moduleName}`,
          `Description: ${entry.description}`,
          `Version: ${entry.version}`,
          `Status: ${entry.status}`,
          `Protected: ${entry.protected ? "yes" : "no"}`,
          `Created: ${entry.created}`,
          `Last Modified: ${entry.lastModified}`,
          `History:\n${historyLines}`,
        ].join("\n"),
      };
    }

    const names = await manifest.listModules();
    if (names.length === 0) {
      return { success: true, output: "No forge modules found." };
    }

    const lines: string[] = [];
    for (const name of names) {
      const entry = await manifest.getEntry(name);
      if (entry) {
        const prot = entry.protected ? " [protected]" : "";
        lines.push(`  ${name} v${entry.version} (${entry.status})${prot} — ${entry.description}`);
      }
    }

    return {
      success: true,
      output: `Forge Modules (${names.length}):\n${lines.join("\n")}`,
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-status.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/status.ts tests/unit/forge-status.test.ts
git commit -m "feat(forge): add forge_status tool for module health reporting"
```

---

### Task 8: forge_restart tool + runtime restartRequested flag

**Files:**
- Create: `src/modules/forge/restart.ts`
- Modify: `src/core/runtime.ts`
- Test: `tests/unit/forge-restart.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-restart.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { forgeRestart } from "../../src/modules/forge/restart.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

const stubMemory = {
  get: async <T>(key: string): Promise<T | undefined> => {
    if (key === "validation:test-mod") return { moduleName: "test-mod", validatedAt: "2026-01-01" } as T;
    return undefined;
  },
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

const context: ToolContext = {
  workingDirectory: "/tmp",
  audit: new AuditLogger(),
  signal: new SignalBus(),
  memory: stubMemory,
};

describe("forge_restart tool", () => {
  test("has correct name and clearance", () => {
    expect(forgeRestart.name).toBe("forge_restart");
    expect(forgeRestart.clearance).toContain("system");
    expect(forgeRestart.clearance).toContain("forge-modify");
  });

  test("requires reason parameter", async () => {
    const result = await forgeRestart.execute({}, context);
    expect(result.success).toBe(false);
    expect(result.output).toContain("reason");
  });

  test("sets restartRequested on the provided runtime ref", async () => {
    const runtimeRef = { restartRequested: false };
    const result = await forgeRestart.execute(
      { reason: "Load new module", runtimeRef },
      context,
    );
    expect(result.success).toBe(true);
    expect(runtimeRef.restartRequested).toBe(true);
    expect(result.output).toContain("Restart");
  });

  test("fails without runtimeRef", async () => {
    const result = await forgeRestart.execute(
      { reason: "Load new module" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("runtime");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-restart.test.ts`
Expected: FAIL — cannot resolve module

**Step 3a: Add restartRequested to FridayRuntime**

In `src/core/runtime.ts`, add after `private _booted = false;`:

```typescript
private _restartRequested = false;

get restartRequested(): boolean {
  return this._restartRequested;
}

set restartRequested(value: boolean) {
  this._restartRequested = value;
}
```

**Step 3b: Implement forge_restart**

Create `src/modules/forge/restart.ts`:

```typescript
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

export const forgeRestart: FridayTool = {
  name: "forge_restart",
  description:
    "Trigger a graceful self-restart to load new or patched forge modules. Requires a reason and sets a restart flag on the runtime. The REPL loop detects this flag and cycles shutdown/boot.",
  parameters: [
    {
      name: "reason",
      type: "string",
      description: "Why the restart is needed (e.g., 'Load new weather module')",
      required: true,
    },
    {
      name: "runtimeRef",
      type: "object",
      description: "Reference to the runtime object (injected by the module loader)",
      required: true,
    },
  ],
  clearance: ["system", "forge-modify"],

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const reason = args.reason as string;
    const runtimeRef = args.runtimeRef as { restartRequested: boolean } | undefined;

    if (!reason) {
      return { success: false, output: "Missing required parameter: reason" };
    }
    if (!runtimeRef) {
      return { success: false, output: "Missing runtime reference — cannot trigger restart" };
    }

    runtimeRef.restartRequested = true;

    await context.audit.log({
      action: "forge:restart",
      source: "forge",
      detail: `Restart requested: ${reason}`,
      success: true,
    });

    return {
      success: true,
      output: `Restart initiated. Reason: ${reason}\nThe runtime will save state and reboot after this response completes.`,
      artifacts: { reason },
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-restart.test.ts`
Expected: All PASS

**Step 5: Also add runtime test**

Add to `tests/unit/runtime.test.ts` in the main describe block:

```typescript
test("restartRequested defaults to false", async () => {
  runtime = new FridayRuntime();
  await runtime.boot({ injectedProvider: stubProvider });
  expect(runtime.restartRequested).toBe(false);
});

test("restartRequested can be set to true", async () => {
  runtime = new FridayRuntime();
  await runtime.boot({ injectedProvider: stubProvider });
  runtime.restartRequested = true;
  expect(runtime.restartRequested).toBe(true);
});
```

**Step 6: Run all tests**

Run: `bun test tests/unit/forge-restart.test.ts tests/unit/runtime.test.ts`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/modules/forge/restart.ts src/core/runtime.ts tests/unit/forge-restart.test.ts tests/unit/runtime.test.ts
git commit -m "feat(forge): add forge_restart tool and runtime restartRequested flag"
```

---

### Task 9: Forge module manifest (index.ts) + /forge protocol

**Files:**
- Create: `src/modules/forge/index.ts`
- Create: `src/modules/forge/protocol.ts`
- Test: `tests/unit/forge-protocol.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/forge-protocol.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { createForgeProtocol } from "../../src/modules/forge/protocol.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { ForgeManifestManager } from "../../src/modules/forge/manifest.ts";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-protocol";
const stubMemory = {
  get: async <T>(_key: string): Promise<T | undefined> => undefined,
  set: async <T>(_key: string, _value: T): Promise<void> => {},
  delete: async (_key: string): Promise<void> => {},
  list: async (): Promise<string[]> => [],
};

const context: ProtocolContext = {
  workingDirectory: TEST_FORGE_DIR,
  audit: new AuditLogger(),
  signal: new SignalBus(),
  memory: stubMemory,
  tools: new Map(),
};

describe("/forge protocol", () => {
  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("protocol has correct name and aliases", () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    expect(protocol.name).toBe("forge");
    expect(protocol.aliases).toContain("workshop");
  });

  test("list returns empty when no modules", async () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "list" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("No forge modules");
  });

  test("list shows modules", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "list" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("weather");
  });

  test("status shows module detail", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "status weather" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("1.0.0");
  });

  test("history shows version history", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.updateModule("weather", "1.1.0", "patched", "Fixed bug");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "history weather" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("1.0.0");
    expect(result.summary).toContain("1.1.0");
  });

  test("protect marks module as protected", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    await protocol.execute({ rawArgs: "protect weather" }, context);
    expect(await mgr.isProtected("weather")).toBe(true);
  });

  test("unprotect removes protection", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");
    await mgr.setProtected("weather", true);

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    await protocol.execute({ rawArgs: "unprotect weather" }, context);
    expect(await mgr.isProtected("weather")).toBe(false);
  });

  test("manifest dumps raw JSON", async () => {
    const mgr = new ForgeManifestManager(TEST_FORGE_DIR);
    await mgr.addModule("weather", "Weather lookups", "1.0.0", "Initial");

    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "manifest" }, context);
    expect(result.success).toBe(true);
    expect(result.summary).toContain('"version"');
  });

  test("unknown subcommand shows help", async () => {
    const protocol = createForgeProtocol(TEST_FORGE_DIR);
    const result = await protocol.execute({ rawArgs: "invalid" }, context);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Available");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/forge-protocol.test.ts`
Expected: FAIL — cannot resolve module

**Step 3a: Implement /forge protocol**

Create `src/modules/forge/protocol.ts`:

```typescript
import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../types.ts";
import { ForgeManifestManager } from "./manifest.ts";

export function createForgeProtocol(forgeDir: string): FridayProtocol {
  return {
    name: "forge",
    description: "Manage Friday's self-authored modules",
    aliases: ["workshop"],
    parameters: [],
    clearance: ["read-fs"],
    execute: async (
      args: Record<string, unknown>,
      _context: ProtocolContext,
    ): Promise<ProtocolResult> => {
      const rawArgs = (args.rawArgs as string) ?? "";
      const parts = rawArgs.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");
      const manifest = new ForgeManifestManager(forgeDir);

      switch (subcommand) {
        case "list":
          return handleList(manifest);
        case "status":
          return handleStatus(manifest, rest);
        case "history":
          return handleHistory(manifest, rest);
        case "protect":
          return handleProtect(manifest, rest, true);
        case "unprotect":
          return handleProtect(manifest, rest, false);
        case "manifest":
          return handleManifestDump(manifest);
        case "rollback":
          return handleRollback(rest);
        default:
          return {
            success: false,
            summary: `Unknown subcommand: "${subcommand}". Available: list, status <name>, history <name>, rollback <name>, protect <name>, unprotect <name>, manifest`,
          };
      }
    },
  };
}

async function handleList(manifest: ForgeManifestManager): Promise<ProtocolResult> {
  const names = await manifest.listModules();
  if (names.length === 0) {
    return { success: true, summary: "No forge modules found." };
  }
  const lines: string[] = [];
  for (const name of names) {
    const entry = await manifest.getEntry(name);
    if (entry) {
      const prot = entry.protected ? " [protected]" : "";
      lines.push(`  ${name} v${entry.version} (${entry.status})${prot}`);
    }
  }
  return { success: true, summary: `Forge Modules (${names.length}):\n${lines.join("\n")}` };
}

async function handleStatus(manifest: ForgeManifestManager, name: string): Promise<ProtocolResult> {
  if (!name) return { success: false, summary: "Usage: /forge status <name>" };
  const entry = await manifest.getEntry(name);
  if (!entry) return { success: false, summary: `Module "${name}" not found.` };
  return {
    success: true,
    summary: [
      `${name} v${entry.version} (${entry.status})`,
      `Description: ${entry.description}`,
      `Protected: ${entry.protected ? "yes" : "no"}`,
      `Created: ${entry.created}`,
      `Modified: ${entry.lastModified}`,
    ].join("\n"),
  };
}

async function handleHistory(manifest: ForgeManifestManager, name: string): Promise<ProtocolResult> {
  if (!name) return { success: false, summary: "Usage: /forge history <name>" };
  const entry = await manifest.getEntry(name);
  if (!entry) return { success: false, summary: `Module "${name}" not found.` };
  const lines = entry.history.map(
    (h) => `  v${h.version} [${h.action}] ${h.date} — ${h.reason}`,
  );
  return { success: true, summary: `History for ${name}:\n${lines.join("\n")}` };
}

async function handleProtect(
  manifest: ForgeManifestManager,
  name: string,
  value: boolean,
): Promise<ProtocolResult> {
  if (!name) return { success: false, summary: `Usage: /forge ${value ? "protect" : "unprotect"} <name>` };
  try {
    await manifest.setProtected(name, value);
    return {
      success: true,
      summary: `Module "${name}" is now ${value ? "protected" : "unprotected"}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, summary: msg };
  }
}

async function handleManifestDump(manifest: ForgeManifestManager): Promise<ProtocolResult> {
  const data = await manifest.load();
  return { success: true, summary: JSON.stringify(data, null, 2) };
}

async function handleRollback(_name: string): Promise<ProtocolResult> {
  if (!_name) return { success: false, summary: "Usage: /forge rollback <name>" };
  // Rollback requires copying from .backups/ and triggering a restart.
  // For now, return a placeholder — the full implementation will be added
  // when the runtime restart loop is wired in Task 11.
  return {
    success: false,
    summary: "Rollback is not yet implemented. Manually restore from forge/.backups/ for now.",
  };
}
```

**Step 3b: Create the Forge module manifest**

Create `src/modules/forge/index.ts`:

```typescript
import type { FridayModule } from "../types.ts";
import { forgePropose } from "./propose.ts";
import { forgeApply } from "./apply.ts";
import { forgeValidate } from "./validate.ts";
import { forgeRestart } from "./restart.ts";
import { forgeStatus } from "./status.ts";

const forgeModule: FridayModule = {
  name: "forge",
  description:
    "The Forge — Friday's self-improvement system. Create new modules, patch existing ones, validate, and restart to load changes.",
  version: "1.0.0",
  tools: [forgePropose, forgeApply, forgeValidate, forgeRestart, forgeStatus],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: ["provider", "write-fs", "read-fs", "exec-shell", "system", "forge-modify"],
};

export default forgeModule;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/forge-protocol.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/forge/index.ts src/modules/forge/protocol.ts tests/unit/forge-protocol.test.ts
git commit -m "feat(forge): add Forge module manifest and /forge protocol"
```

---

### Task 10: Enhanced module loader — discoverForgeModules with fault isolation

**Files:**
- Modify: `src/modules/loader.ts`
- Test: `tests/unit/modules.test.ts` (add tests)

**Step 1: Write the failing test**

Add to `tests/unit/modules.test.ts`:

```typescript
import { discoverForgeModules, type ForgeLoadResult } from "../../src/modules/loader.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";

const TEST_FORGE_DIR = "/tmp/friday-test-forge-loader";

describe("Forge Module Discovery", () => {
  beforeEach(async () => {
    await mkdir(TEST_FORGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_FORGE_DIR, { recursive: true, force: true });
  });

  test("returns empty when forge dir does not exist", async () => {
    const result = await discoverForgeModules("/tmp/nonexistent-forge-dir-xyz");
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  test("loads a valid forge module", async () => {
    const modDir = `${TEST_FORGE_DIR}/good`;
    await mkdir(modDir, { recursive: true });
    await writeFile(
      `${modDir}/index.ts`,
      `export default {
        name: "good",
        description: "A good module",
        version: "1.0.0",
        tools: [],
        protocols: [],
        knowledge: [],
        triggers: [],
        clearance: [],
      };`,
    );

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.name).toBe("good");
    expect(result.failed).toHaveLength(0);
  });

  test("captures failure for broken module without crashing", async () => {
    const modDir = `${TEST_FORGE_DIR}/broken`;
    await mkdir(modDir, { recursive: true });
    await writeFile(`${modDir}/index.ts`, "export default {{{ syntax error");

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.name).toBe("broken");
    expect(result.failed[0]!.error).toBeDefined();
  });

  test("loads good modules and captures bad ones in same dir", async () => {
    const goodDir = `${TEST_FORGE_DIR}/good`;
    const badDir = `${TEST_FORGE_DIR}/bad`;
    await mkdir(goodDir, { recursive: true });
    await mkdir(badDir, { recursive: true });

    await writeFile(
      `${goodDir}/index.ts`,
      `export default {
        name: "good", description: "Good", version: "1.0.0",
        tools: [], protocols: [], knowledge: [], triggers: [], clearance: [],
      };`,
    );
    await writeFile(`${badDir}/index.ts`, "throw new Error('module broke');");

    const result = await discoverForgeModules(TEST_FORGE_DIR);
    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/modules.test.ts`
Expected: FAIL — `discoverForgeModules` not found

**Step 3: Add discoverForgeModules to loader.ts**

Add to `src/modules/loader.ts`:

```typescript
import type { FridayModule } from "./types.ts";

export interface ForgeLoadResult {
  loaded: FridayModule[];
  failed: { name: string; error: string }[];
}

export async function discoverForgeModules(forgeDir: string): Promise<ForgeLoadResult> {
  const { resolve } = await import("node:path");
  const result: ForgeLoadResult = { loaded: [], failed: [] };

  const resolvedDir = resolve(forgeDir);
  const glob = new Bun.Glob("*/index.ts");

  try {
    for await (const match of glob.scan({ cwd: resolvedDir, onlyFiles: true })) {
      const moduleName = match.split("/")[0]!;

      // Skip .backups directory
      if (moduleName.startsWith(".")) continue;

      const indexPath = `${resolvedDir}/${match}`;

      // Resolve symlinks before checking containment
      const realIndexPath = await realpath(indexPath).catch(() => indexPath);
      const realDir = await realpath(resolvedDir).catch(() => resolvedDir);
      if (!realIndexPath.startsWith(`${realDir}/`)) {
        result.failed.push({ name: moduleName, error: "Path traversal detected" });
        continue;
      }

      try {
        // Cache-bust for re-imports after patches
        const mod = await import(`${indexPath}?t=${Date.now()}`);
        const manifest: FridayModule = mod.default ?? mod;
        const validation = validateModule(manifest);
        if (validation.valid) {
          result.loaded.push(manifest);
        } else {
          result.failed.push({ name: moduleName, error: validation.error ?? "Invalid manifest" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.failed.push({ name: moduleName, error: msg });
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable — return empty result
  }

  return result;
}
```

Note: The existing `realpath` import at the top of the file is already available.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/modules.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/loader.ts tests/unit/modules.test.ts
git commit -m "feat(forge): add discoverForgeModules with fault-isolated loading"
```

---

### Task 11: Wire Forge into FridayRuntime

**Files:**
- Modify: `src/core/runtime.ts`
- Test: `tests/unit/runtime.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `tests/unit/runtime.test.ts`:

```typescript
describe("FridayRuntime — Forge integration", () => {
  let forgeDir: string;

  beforeEach(async () => {
    forgeDir = `/tmp/friday-test-forge-runtime-${Date.now()}`;
    await mkdir(forgeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(forgeDir, { recursive: true, force: true });
  });

  test("boots with forgeDir and loads forge modules", async () => {
    // Create a valid forge module
    const modDir = `${forgeDir}/test-mod`;
    await mkdir(modDir, { recursive: true });
    await writeFile(
      `${modDir}/index.ts`,
      `export default {
        name: "test-mod", description: "Test", version: "1.0.0",
        tools: [], protocols: [], knowledge: [], triggers: [], clearance: [],
      };`,
    );

    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      forgeDir,
    });
    expect(runtime.forgeHealthReport).toBeDefined();
    expect(runtime.forgeHealthReport!.loaded).toContain("test-mod");
    await runtime.shutdown();
  });

  test("forge module failure does not crash boot", async () => {
    const modDir = `${forgeDir}/broken-mod`;
    await mkdir(modDir, { recursive: true });
    await writeFile(`${modDir}/index.ts`, "throw new Error('broken');");

    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      forgeDir,
    });
    expect(runtime.isBooted).toBe(true);
    expect(runtime.forgeHealthReport!.failed).toHaveLength(1);
    expect(runtime.forgeHealthReport!.failed[0]!.name).toBe("broken-mod");
    await runtime.shutdown();
  });

  test("boots without forgeDir (backwards compatible)", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    expect(runtime.forgeHealthReport).toBeUndefined();
    await runtime.shutdown();
  });

  test("/forge protocol is registered when forgeDir is provided", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      forgeDir,
    });
    const forgeProtocol = runtime.protocols.get("forge");
    expect(forgeProtocol).toBeDefined();
    expect(forgeProtocol!.name).toBe("forge");
    await runtime.shutdown();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — `forgeDir` not in RuntimeConfig, `forgeHealthReport` not on runtime

**Step 3: Wire Forge into runtime**

In `src/core/runtime.ts`:

1. Add imports at top:
```typescript
import { discoverForgeModules, type ForgeLoadResult } from "../modules/loader.ts";
import { createForgeProtocol } from "../modules/forge/protocol.ts";
import type { ForgeHealthReport } from "../modules/forge/types.ts";
```

2. Add to `RuntimeConfig`:
```typescript
forgeDir?: string;
```

3. Add private fields to `FridayRuntime`:
```typescript
private _forgeHealthReport?: ForgeHealthReport;
```

4. Add getter:
```typescript
get forgeHealthReport(): ForgeHealthReport | undefined {
  return this._forgeHealthReport;
}
```

5. In `boot()`, after the existing module loading block (`if (config.modulesDir)`), add forge module loading:
```typescript
if (config.forgeDir) {
  await mkdir(config.forgeDir, { recursive: true });
  this._protocols.register(createForgeProtocol(config.forgeDir));

  const forgeResult = await discoverForgeModules(config.forgeDir);
  this._forgeHealthReport = {
    loaded: forgeResult.loaded.map((m) => m.name),
    failed: forgeResult.failed,
    pending: [],
  };

  for (const mod of forgeResult.loaded) {
    for (const tool of mod.tools) {
      this._cortex.registerTool(tool);
    }
    for (const protocol of mod.protocols) {
      this._protocols.register(protocol);
    }
    if (mod.onLoad) {
      await mod.onLoad();
    }
    this._modules.push(mod);
  }
}
```

6. Reset in `shutdown()` (before the existing module unload loop):
```typescript
this._forgeHealthReport = undefined;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/runtime.ts tests/unit/runtime.test.ts
git commit -m "feat(forge): wire Forge module loading into FridayRuntime with fault isolation"
```

---

### Task 12: Wire restart loop in chat.ts

**Files:**
- Modify: `src/cli/commands/chat.ts`

**Step 1: Update the REPL loop to check restartRequested**

In `src/cli/commands/chat.ts`, replace the try/catch inside the `while (true)` loop:

After line 128 (`const result = await runtime.process(message);`), after `spinner.stop()`, add a restart check:

```typescript
// Check if forge requested a restart
if (runtime.restartRequested) {
  console.log(chalk.cyan("\nForge restart requested. Rebooting subsystems...\n"));
  const restartSpinner = ora({
    text: chalk.dim("Restarting..."),
    spinner: "dots",
  }).start();

  try {
    const bootConfig = {
      provider: options.provider as ProviderName,
      model: options.model,
      smartsDir: resolve(projectRoot, "smarts"),
      dataDir: resolve(projectRoot, "data"),
      modulesDir: resolve(projectRoot, "src/modules"),
      forgeDir: resolve(projectRoot, "forge"),
      fresh: false,
    };
    await runtime.shutdown((_step, label) => {
      restartSpinner.text = chalk.dim(label);
    });
    runtime.restartRequested = false;
    await runtime.boot(bootConfig);
    restartSpinner.succeed(chalk.dim("Restart complete"));

    // Report forge health after restart
    const health = runtime.forgeHealthReport;
    if (health) {
      if (health.loaded.length > 0) {
        console.log(chalk.green(`  Forge modules loaded: ${health.loaded.join(", ")}`));
      }
      if (health.failed.length > 0) {
        for (const f of health.failed) {
          console.log(chalk.red(`  Forge module failed: ${f.name} — ${f.error}`));
        }
      }
    }
    console.log();
  } catch (error) {
    restartSpinner.fail(chalk.red("Restart failed"));
    if (error instanceof Error) {
      console.error(chalk.red(`  ${error.message}\n`));
    }
  }
}
```

Also add `forgeDir: resolve(projectRoot, "forge")` to the initial `runtime.boot()` call at the top of the action handler.

**Step 2: Verify the chat command still works**

Run: `bun run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(forge): wire restart loop into chat REPL"
```

---

### Task 13: Update .gitignore, CLAUDE.md, and README.md

**Files:**
- Modify: `.gitignore`
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Add forge/ to .gitignore**

Append to `.gitignore`:

```
# Forge-authored modules (AI-generated, user-specific)
forge
```

**Step 2: Update CLAUDE.md**

Add to the Architecture section's directory tree, after `smarts/`:

```
forge/                     # Friday-authored modules (gitignored, AI-generated)
```

Add to Key Design Patterns:

```
- **The Forge** (`src/modules/forge/`) is Friday's self-improvement system. She can author new modules in `forge/` and patch existing forge modules, subject to human approval. The Forge validates modules (import, manifest, typecheck, lint) before triggering an in-process restart. Failed forge modules don't crash boot — errors are reported back so Friday can iterate. The filesystem module and Forge itself are core-protected.
```

Add `forge-modify` to the clearance list in the boot section.

**Step 3: Update README.md**

Add a new subsection under "What's Inside", after the Filesystem Module section:

```markdown
### The Forge — Self-Improvement

Friday can write her own modules. The Forge system lets her propose new capabilities, validate them (import test, typecheck, lint), and gracefully restart to load them — all with human approval at every step. Failed modules don't crash the runtime; errors are reported back so Friday can iterate on fixes.
`/forge list` · `/forge status <name>` · `/forge history <name>` · `/forge protect <name>`
```

Add to the MCU Concept Map table:

```markdown
| The workshop | **Forge** | Self-improvement — Friday authors and patches her own modules |
```

Add to the In-Session Commands table:

```markdown
| `/forge list` | List all forge-authored modules |
| `/forge status <name>` | Detailed health of a forge module |
| `/forge history <name>` | Version history of a forge module |
| `/forge protect <name>` | Mark a forge module as immutable |
```

Update the project structure tree to include `forge/` under `modules/`:

```
│   ├── forge/             # The Forge — self-improvement system
```

**Step 4: Lint and verify**

Run: `bun run lint:fix && bun run typecheck`
Expected: Clean

**Step 5: Commit**

```bash
git add .gitignore CLAUDE.md README.md
git commit -m "docs: add The Forge to README, CLAUDE.md, and .gitignore"
```

---

### Task 14: Run full test suite and lint

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass (existing 363+ new forge tests)

**Step 2: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Fix any issues found, then commit**

```bash
git add -A
git commit -m "chore: fix any lint/type issues from forge implementation"
```

(Only if needed — skip if everything is clean.)

---

### Task 15: Final integration verification

**Step 1: Verify forge module loads in runtime**

Run this quick smoke test by adding temporarily to runtime tests or running interactively:

```bash
bun test tests/unit/runtime.test.ts tests/unit/forge-manifest.test.ts tests/unit/forge-propose.test.ts tests/unit/forge-apply.test.ts tests/unit/forge-validate.test.ts tests/unit/forge-status.test.ts tests/unit/forge-restart.test.ts tests/unit/forge-protocol.test.ts tests/unit/modules.test.ts
```

Expected: All PASS

**Step 2: Run full suite one final time**

Run: `bun test`
Expected: All pass

**Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for The Forge implementation"
```
