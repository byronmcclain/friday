# SMARTS Dynamic Knowledge System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dynamic knowledge system (SMARTS) that indexes markdown files into FTS5, injects relevant context into each LLM call, and autonomously generates new knowledge from conversations.

**Architecture:** Standalone `SmartsStore` subsystem booted by FridayRuntime before Cortex. Markdown files with YAML frontmatter in `smarts/` are parsed, indexed into SQLiteMemory FTS5, and queried per-message. A `/smart` protocol provides manual control. A `SmartsCurator` fires on `session:end` to extract knowledge asynchronously.

**Tech Stack:** TypeScript (strict), Bun APIs (`Bun.file`, `Bun.Glob`), `bun:sqlite` via SQLiteMemory, `bun:test`

---

### Task 1: SMARTS Types

**Files:**
- Create: `src/smarts/types.ts`

**Step 1: Create the types file**

```typescript
export type SmartSource = "manual" | "auto" | "conversation";

export interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: SmartSource;
  content: string;
  filePath: string;
}

export interface SmartsConfig {
  smartsDir: string;
  maxPerMessage: number;
  tokenBudget: number;
  minConfidence: number;
}

export const SMARTS_DEFAULTS: SmartsConfig = {
  smartsDir: "./smarts",
  maxPerMessage: 5,
  tokenBudget: 24000,
  minConfidence: 0.5,
};
```

**Step 2: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add src/smarts/types.ts
git commit -m "feat(smarts): add SmartEntry and SmartsConfig types"
```

---

### Task 2: SMARTS Frontmatter Parser

**Files:**
- Create: `src/smarts/parser.ts`
- Create: `tests/unit/smarts-parser.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { parseFrontmatter, serializeSmartFile } from "../../src/smarts/parser.ts";

describe("parseFrontmatter", () => {
  test("parses valid YAML frontmatter and markdown body", () => {
    const raw = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Always validate input.`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("security-basics");
    expect(result!.domain).toBe("security");
    expect(result!.tags).toEqual(["owasp", "xss"]);
    expect(result!.confidence).toBe(0.9);
    expect(result!.source).toBe("manual");
    expect(result!.content).toContain("# Security Basics");
    expect(result!.content).toContain("Always validate input.");
  });

  test("returns null for missing frontmatter delimiters", () => {
    const raw = "# Just Markdown\n\nNo frontmatter here.";
    expect(parseFrontmatter(raw)).toBeNull();
  });

  test("returns null for missing required fields", () => {
    const raw = `---
name: incomplete
---

# Missing domain and tags`;

    expect(parseFrontmatter(raw)).toBeNull();
  });

  test("defaults confidence to 0.7 when missing", () => {
    const raw = `---
name: auto-generated
domain: general
tags: [misc]
source: auto
created: 2026-02-21
updated: 2026-02-21
---

# Auto content`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.7);
  });

  test("defaults source to manual when missing", () => {
    const raw = `---
name: user-authored
domain: general
tags: [misc]
confidence: 1.0
created: 2026-02-21
updated: 2026-02-21
---

# User content`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("manual");
  });

  test("trims whitespace from body", () => {
    const raw = `---
name: trimmed
domain: general
tags: [test]
source: manual
created: 2026-02-21
updated: 2026-02-21
---


  # Content with leading whitespace

Body text.

`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.content).not.toStartWith("\n");
    expect(result!.content).not.toEndWith("\n\n");
  });
});

describe("serializeSmartFile", () => {
  test("produces valid frontmatter + markdown", () => {
    const output = serializeSmartFile({
      name: "test-smart",
      domain: "testing",
      tags: ["unit", "bun"],
      confidence: 0.8,
      source: "auto",
      content: "# Test Knowledge\n\nSome content here.",
    });

    expect(output).toContain("---");
    expect(output).toContain("name: test-smart");
    expect(output).toContain("domain: testing");
    expect(output).toContain("tags:");
    expect(output).toContain("confidence: 0.8");
    expect(output).toContain("source: auto");
    expect(output).toContain("# Test Knowledge");
  });

  test("round-trips through parse", () => {
    const input = {
      name: "roundtrip",
      domain: "meta",
      tags: ["test"],
      confidence: 0.9,
      source: "manual" as const,
      content: "# Round Trip\n\nThis should survive.",
    };
    const serialized = serializeSmartFile(input);
    const parsed = parseFrontmatter(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe(input.name);
    expect(parsed!.domain).toBe(input.domain);
    expect(parsed!.tags).toEqual(input.tags);
    expect(parsed!.confidence).toBe(input.confidence);
    expect(parsed!.content).toContain("# Round Trip");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-parser.test.ts`
Expected: FAIL — `parseFrontmatter` and `serializeSmartFile` not found

**Step 3: Implement the parser**

```typescript
import type { SmartEntry, SmartSource } from "./types.ts";

type ParsedSmart = Omit<SmartEntry, "filePath">;

const VALID_SOURCES: SmartSource[] = ["manual", "auto", "conversation"];

export function parseFrontmatter(raw: string): ParsedSmart | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, yamlBlock, body] = match;
  if (!yamlBlock || body === undefined) return null;

  const fields = parseYamlFields(yamlBlock);

  const name = fields.name;
  const domain = fields.domain;
  const tagsRaw = fields.tags;
  if (!name || !domain || !tagsRaw) return null;

  const tags = parseYamlArray(tagsRaw);
  const confidence = fields.confidence ? Number.parseFloat(fields.confidence) : 0.7;
  const source: SmartSource = VALID_SOURCES.includes(fields.source as SmartSource)
    ? (fields.source as SmartSource)
    : "manual";

  return {
    name: name.trim(),
    domain: domain.trim(),
    tags,
    confidence,
    source,
    content: body.trim(),
  };
}

export function serializeSmartFile(entry: Omit<SmartEntry, "filePath">): string {
  const today = new Date().toISOString().split("T")[0];
  const tagsLine = entry.tags.map((t) => `  - ${t}`).join("\n");

  return `---
name: ${entry.name}
domain: ${entry.domain}
tags:
${tagsLine}
confidence: ${entry.confidence}
source: ${entry.source}
created: ${today}
updated: ${today}
---

${entry.content}
`;
}

function parseYamlFields(yaml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey = "";

  for (const line of yaml.split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1]!;
      fields[currentKey] = kvMatch[2]!.trim();
    } else if (currentKey && line.match(/^\s+-\s+/)) {
      // Continuation of a YAML array
      fields[currentKey] = (fields[currentKey] || "") + "," + line.replace(/^\s+-\s+/, "").trim();
    }
  }

  return fields;
}

function parseYamlArray(value: string): string[] {
  // Handle inline: [a, b, c]
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Handle block style collected by parseYamlFields as comma-separated
  if (value === "") {
    return [];
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-parser.test.ts`
Expected: ALL PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/smarts/parser.ts tests/unit/smarts-parser.test.ts
git commit -m "feat(smarts): add frontmatter parser with serialize/parse round-trip"
```

---

### Task 3: SmartsStore — Core Subsystem

**Files:**
- Create: `src/smarts/store.ts`
- Create: `tests/unit/smarts-store.test.ts`
- Create: test fixture files in `/tmp/friday-test-smarts/`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink, mkdir, writeFile, rm } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-smarts.db";
const TEST_SMARTS_DIR = "/tmp/friday-test-smarts";

const SECURITY_SMART = `---
name: security-basics
domain: security
tags: [owasp, xss, injection]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Always validate and sanitize user input at system boundaries.
Use parameterized queries to prevent SQL injection.`;

const BUN_SMART = `---
name: bun-patterns
domain: bun
tags: [bun, runtime, javascript, typescript]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Bun Runtime Patterns

Use Bun.file() instead of node:fs for file operations.
Use Bun.serve() for HTTP servers.`;

const LOW_CONFIDENCE_SMART = `---
name: outdated-tips
domain: general
tags: [legacy, deprecated]
confidence: 0.3
source: auto
created: 2026-02-21
updated: 2026-02-21
---

# Outdated Tips

This content has low confidence.`;

describe("SmartsStore", () => {
  let store: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    await mkdir(TEST_SMARTS_DIR, { recursive: true });
    await writeFile(`${TEST_SMARTS_DIR}/security-basics.md`, SECURITY_SMART);
    await writeFile(`${TEST_SMARTS_DIR}/bun-patterns.md`, BUN_SMART);
    await writeFile(`${TEST_SMARTS_DIR}/outdated-tips.md`, LOW_CONFIDENCE_SMART);
    memory = new SQLiteMemory(TEST_DB);
    store = new SmartsStore();
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB),
      unlink(`${TEST_DB}-wal`),
      unlink(`${TEST_DB}-shm`),
      rm(TEST_SMARTS_DIR, { recursive: true }),
    ]);
  });

  test("initialize loads all .md files from directory", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    expect(store.all()).toHaveLength(3);
  });

  test("all() returns loaded entries", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const names = store.all().map((e) => e.name);
    expect(names).toContain("security-basics");
    expect(names).toContain("bun-patterns");
    expect(names).toContain("outdated-tips");
  });

  test("getByName returns a specific entry", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const entry = await store.getByName("security-basics");
    expect(entry).toBeDefined();
    expect(entry!.domain).toBe("security");
    expect(entry!.confidence).toBe(0.9);
  });

  test("getByName returns undefined for unknown name", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const entry = await store.getByName("nonexistent");
    expect(entry).toBeUndefined();
  });

  test("getByDomain returns entries for a domain", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const entries = await store.getByDomain("security");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("security-basics");
  });

  test("domains() lists unique domains", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const domains = store.domains();
    expect(domains).toContain("security");
    expect(domains).toContain("bun");
    expect(domains).toContain("general");
  });

  test("findRelevant returns FTS5 matches", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const results = await store.findRelevant("SQL injection security");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe("security-basics");
  });

  test("findRelevant respects minConfidence filter", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const results = await store.findRelevant("legacy deprecated");
    // outdated-tips has confidence 0.3, below minConfidence 0.5
    const names = results.map((r) => r.name);
    expect(names).not.toContain("outdated-tips");
  });

  test("findRelevant respects limit parameter", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const results = await store.findRelevant("runtime javascript", 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test("create writes a new .md file and indexes it", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    const entry = await store.create({
      name: "docker-tips",
      domain: "docker",
      tags: ["docker", "containers"],
      confidence: 0.7,
      source: "auto",
      content: "# Docker Tips\n\nUse multi-stage builds.",
    });
    expect(entry.filePath).toContain("docker-tips.md");
    expect(store.all()).toHaveLength(4);

    // Verify file was written
    const file = Bun.file(entry.filePath);
    expect(await file.exists()).toBe(true);

    // Verify it's searchable
    const results = await store.findRelevant("docker containers");
    expect(results.map((r) => r.name)).toContain("docker-tips");
  });

  test("update modifies content of existing entry", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    await store.update("security-basics", "# Updated Security\n\nNew content here.");
    const entry = await store.getByName("security-basics");
    expect(entry!.content).toContain("Updated Security");
  });

  test("reindex rebuilds index from filesystem", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    // Write a new file directly to disk (simulating manual edit)
    const newContent = `---
name: manual-add
domain: general
tags: [manual]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Manually Added

This was added by hand.`;
    await writeFile(`${TEST_SMARTS_DIR}/manual-add.md`, newContent);
    await store.reindex();
    expect(store.all()).toHaveLength(4);
    expect(store.all().map((e) => e.name)).toContain("manual-add");
  });

  test("initialize handles empty directory", async () => {
    const emptyDir = "/tmp/friday-test-smarts-empty";
    await mkdir(emptyDir, { recursive: true });
    await store.initialize(
      { smartsDir: emptyDir, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    expect(store.all()).toHaveLength(0);
    await rm(emptyDir, { recursive: true });
  });

  test("initialize handles missing directory by creating it", async () => {
    const missingDir = "/tmp/friday-test-smarts-missing";
    await store.initialize(
      { smartsDir: missingDir, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    expect(store.all()).toHaveLength(0);
    await rm(missingDir, { recursive: true });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-store.test.ts`
Expected: FAIL — `SmartsStore` not found

**Step 3: Implement SmartsStore**

```typescript
import type { SmartEntry, SmartsConfig } from "./types.ts";
import { parseFrontmatter, serializeSmartFile } from "./parser.ts";
import type { SQLiteMemory } from "../core/memory.ts";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const SMARTS_NAMESPACE = "smarts";

export class SmartsStore {
  private entries = new Map<string, SmartEntry>();
  private config!: SmartsConfig;
  private memory!: SQLiteMemory;

  async initialize(config: SmartsConfig, memory: SQLiteMemory): Promise<void> {
    this.config = config;
    this.memory = memory;
    this.entries.clear();

    const dir = resolve(config.smartsDir);
    await mkdir(dir, { recursive: true });

    await this.scanAndIndex(dir);
  }

  private async scanAndIndex(dir: string): Promise<void> {
    const glob = new Bun.Glob("*.md");

    for await (const match of glob.scan({ cwd: dir, onlyFiles: true })) {
      const filePath = `${dir}/${match}`;
      try {
        const file = Bun.file(filePath);
        const raw = await file.text();
        const parsed = parseFrontmatter(raw);
        if (parsed) {
          const entry: SmartEntry = { ...parsed, filePath };
          this.entries.set(entry.name, entry);
          await this.memory.embed(
            SMARTS_NAMESPACE,
            `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
            { name: entry.name },
          );
        }
      } catch {
        // Skip files that can't be read or parsed
      }
    }
  }

  async findRelevant(query: string, limit?: number): Promise<SmartEntry[]> {
    const maxResults = limit ?? this.config.maxPerMessage;
    // Search more than needed to account for confidence filtering
    const ftsResults = await this.memory.search(SMARTS_NAMESPACE, query, maxResults * 3);

    const results: SmartEntry[] = [];
    let tokenCount = 0;

    for (const ftsResult of ftsResults) {
      const name = (ftsResult.metadata as { name?: string })?.name;
      if (!name) continue;
      const entry = this.entries.get(name);
      if (!entry) continue;
      if (entry.confidence < this.config.minConfidence) continue;

      const entryTokens = Math.ceil(entry.content.length / 4);
      if (tokenCount + entryTokens > this.config.tokenBudget) continue;

      results.push(entry);
      tokenCount += entryTokens;

      if (results.length >= maxResults) break;
    }

    return results;
  }

  async getByDomain(domain: string): Promise<SmartEntry[]> {
    return this.all().filter((e) => e.domain === domain);
  }

  async getByName(name: string): Promise<SmartEntry | undefined> {
    return this.entries.get(name);
  }

  async create(entry: Omit<SmartEntry, "filePath">): Promise<SmartEntry> {
    const dir = resolve(this.config.smartsDir);
    const filePath = `${dir}/${entry.name}.md`;
    const content = serializeSmartFile(entry);

    await Bun.write(filePath, content);

    const full: SmartEntry = { ...entry, filePath };
    this.entries.set(entry.name, full);

    await this.memory.embed(
      SMARTS_NAMESPACE,
      `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
      { name: entry.name },
    );

    return full;
  }

  async update(name: string, content: string): Promise<void> {
    const existing = this.entries.get(name);
    if (!existing) return;

    const updated: SmartEntry = { ...existing, content };
    const serialized = serializeSmartFile(updated);
    await Bun.write(existing.filePath, serialized);

    this.entries.set(name, updated);
    // Reindex to update FTS5 — simple approach: clear and re-scan
    await this.reindex();
  }

  async reindex(): Promise<void> {
    // Clear existing FTS5 entries for smarts namespace
    const existing = await this.memory.search(SMARTS_NAMESPACE, "*", 1000);
    for (const result of existing) {
      await this.memory.forget(SMARTS_NAMESPACE, result.id);
    }

    this.entries.clear();
    const dir = resolve(this.config.smartsDir);
    await this.scanAndIndex(dir);
  }

  domains(): string[] {
    const domainSet = new Set<string>();
    for (const entry of this.entries.values()) {
      domainSet.add(entry.domain);
    }
    return [...domainSet];
  }

  all(): SmartEntry[] {
    return [...this.entries.values()];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-store.test.ts`
Expected: ALL PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/smarts/store.ts tests/unit/smarts-store.test.ts
git commit -m "feat(smarts): add SmartsStore with FTS5 indexing and CRUD"
```

---

### Task 4: Cortex Integration — Dynamic Prompt Assembly

**Files:**
- Modify: `src/core/cortex.ts`
- Modify: `tests/unit/friday.test.ts`

**Step 1: Write the failing tests (append to existing test file)**

Add these tests to `tests/unit/friday.test.ts`:

```typescript
// Add import at top:
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { unlink } from "node:fs/promises";

const TEST_DB_CORTEX = "/tmp/friday-test-cortex-smarts.db";
const TEST_SMARTS_DIR_CORTEX = "/tmp/friday-test-cortex-smarts";

const SECURITY_SMART_FIXTURE = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Validate all input.`;

describe("Cortex — SMARTS integration", () => {
  let capturedPrompt: string;
  const capturingProvider: LLMProvider = {
    name: "capturing",
    defaultModel: "capture-model",
    chat: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return "response with smarts";
    },
  };

  let smartsStore: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    capturedPrompt = "";
    await mkdir(TEST_SMARTS_DIR_CORTEX, { recursive: true });
    await writeFile(`${TEST_SMARTS_DIR_CORTEX}/security-basics.md`, SECURITY_SMART_FIXTURE);
    memory = new SQLiteMemory(TEST_DB_CORTEX);
    smartsStore = new SmartsStore();
    await smartsStore.initialize(
      { smartsDir: TEST_SMARTS_DIR_CORTEX, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB_CORTEX),
      unlink(`${TEST_DB_CORTEX}-wal`),
      unlink(`${TEST_DB_CORTEX}-shm`),
      rm(TEST_SMARTS_DIR_CORTEX, { recursive: true }),
    ]);
  });

  test("enriches system prompt with relevant SMARTS", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    await cortex.chat("How do I prevent XSS attacks?");
    expect(capturedPrompt).toContain("Active Knowledge");
    expect(capturedPrompt).toContain("Security Basics");
  });

  test("includes base SYSTEM_PROMPT in enriched prompt", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    await cortex.chat("How do I prevent XSS attacks?");
    expect(capturedPrompt).toContain("You are Friday");
  });

  test("works without smartsStore (backwards compatible)", async () => {
    const cortex = new Cortex({ injectedProvider: capturingProvider });
    await cortex.chat("Hello");
    expect(capturedPrompt).toBe(SYSTEM_PROMPT);
    expect(capturedPrompt).not.toContain("Active Knowledge");
  });

  test("pinned SMARTS are always included", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    cortex.pinSmart("security-basics");
    await cortex.chat("Tell me about Bun");
    // Even though we're asking about Bun, security-basics is pinned
    expect(capturedPrompt).toContain("Security Basics");
  });

  test("unpinSmart removes a pin", async () => {
    const cortex = new Cortex({
      injectedProvider: capturingProvider,
      smartsStore,
    });
    cortex.pinSmart("security-basics");
    cortex.unpinSmart("security-basics");
    await cortex.chat("Tell me about cooking");
    // No relevant smarts and nothing pinned
    expect(capturedPrompt).not.toContain("Security Basics");
  });
});
```

Note: You will need to add `beforeEach` and `afterEach` imports at the top of the file.

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/friday.test.ts`
Expected: FAIL — `smartsStore` not a valid property of `CortexConfig`, `pinSmart`/`unpinSmart` not found

**Step 3: Modify Cortex to accept SmartsStore and build enriched prompts**

In `src/core/cortex.ts`, make these changes:

1. Add import: `import type { SmartsStore } from "../smarts/store.ts";`
2. Add `smartsStore?: SmartsStore` to `CortexConfig`
3. Add private fields: `private smartsStore?: SmartsStore;` and `private pinnedSmarts = new Set<string>();`
4. In constructor: `this.smartsStore = config.smartsStore;`
5. Add `pinSmart(name: string)` and `unpinSmart(name: string)` methods
6. Add `private async buildSystemPrompt(userMessage: string): Promise<string>` method
7. In `chat()`, replace `SYSTEM_PROMPT` with `await this.buildSystemPrompt(userMessage)`

The `buildSystemPrompt` method:

```typescript
private async buildSystemPrompt(userMessage: string): Promise<string> {
  if (!this.smartsStore) return SYSTEM_PROMPT;

  const sections: string[] = [];

  // Add pinned SMARTS first
  for (const name of this.pinnedSmarts) {
    const entry = await this.smartsStore.getByName(name);
    if (entry) {
      sections.push(`### ${entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name} (confidence: ${entry.confidence})\n${entry.content}`);
    }
  }

  // Add relevant SMARTS from FTS5
  const relevant = await this.smartsStore.findRelevant(userMessage);
  for (const entry of relevant) {
    if (this.pinnedSmarts.has(entry.name)) continue; // Skip duplicates
    sections.push(`### ${entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name} (confidence: ${entry.confidence})\n${entry.content}`);
  }

  if (sections.length === 0) return SYSTEM_PROMPT;

  return `${SYSTEM_PROMPT}\n\n## Active Knowledge\n\nThe following domain knowledge is available for this conversation.\nUse it to inform your responses when relevant.\n\n${sections.join("\n\n")}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/friday.test.ts`
Expected: ALL PASS (both old and new tests)

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/core/cortex.ts tests/unit/friday.test.ts
git commit -m "feat(smarts): integrate SmartsStore into Cortex for dynamic prompt assembly"
```

---

### Task 5: Runtime Integration — Wire SmartsStore into Boot Sequence

**Files:**
- Modify: `src/core/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

**Step 1: Write the failing tests (append to existing test file)**

Add to `tests/unit/runtime.test.ts`:

```typescript
// Add imports:
import { mkdir, writeFile, rm } from "node:fs/promises";

const TEST_SMARTS_DIR_RT = "/tmp/friday-test-runtime-smarts";

describe("FridayRuntime — SMARTS integration", () => {
  beforeEach(async () => {
    await mkdir(TEST_SMARTS_DIR_RT, { recursive: true });
    await writeFile(
      `${TEST_SMARTS_DIR_RT}/test-smart.md`,
      `---
name: test-knowledge
domain: testing
tags: [test, unit]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Test Knowledge

This is test knowledge.`,
    );
  });

  afterEach(async () => {
    await rm(TEST_SMARTS_DIR_RT, { recursive: true, force: true });
  });

  test("boots with smartsDir and loads SMARTS", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({
      injectedProvider: stubProvider,
      smartsDir: TEST_SMARTS_DIR_RT,
    });
    expect(runtime.smarts).toBeDefined();
    expect(runtime.smarts!.all()).toHaveLength(1);
    await runtime.shutdown();
  });

  test("boots without smartsDir (backwards compatible)", async () => {
    const runtime = new FridayRuntime();
    await runtime.boot({ injectedProvider: stubProvider });
    expect(runtime.smarts).toBeUndefined();
    await runtime.shutdown();
  });
});
```

Note: You'll also need to add `beforeEach`, `afterEach` imports at the top of the file.

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — `smartsDir` not on `RuntimeConfig`, `runtime.smarts` not defined

**Step 3: Modify FridayRuntime**

In `src/core/runtime.ts`:

1. Add imports: `import { SmartsStore } from "../smarts/store.ts";`, `import { SQLiteMemory } from "./memory.ts";`, `import { SMARTS_DEFAULTS } from "../smarts/types.ts";`
2. Add to `RuntimeConfig`: `smartsDir?: string;`
3. Add private field: `private _smarts?: SmartsStore;` and `private _memory?: SQLiteMemory;`
4. Add getter: `get smarts(): SmartsStore | undefined { return this._smarts; }`
5. In `boot()`, after `_directiveEngine.start()` and before `new Cortex(...)`:
   - If `config.smartsDir` is set, create `SQLiteMemory` (use path like `${config.smartsDir}/.smarts-index.db`), create `SmartsStore`, call `initialize()`, and pass `smartsStore` to the Cortex constructor
6. In `shutdown()`, close memory if it exists

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/core/runtime.ts tests/unit/runtime.test.ts
git commit -m "feat(smarts): wire SmartsStore into FridayRuntime boot sequence"
```

---

### Task 6: /smart Protocol

**Files:**
- Create: `src/smarts/protocol.ts`
- Create: `tests/unit/smarts-protocol.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSmartProtocol } from "../../src/smarts/protocol.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink, mkdir, writeFile, rm } from "node:fs/promises";
import type { ProtocolContext } from "../../src/modules/types.ts";

const TEST_DB = "/tmp/friday-test-smart-proto.db";
const TEST_DIR = "/tmp/friday-test-smart-proto";

const FIXTURE = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Validate all input.`;

function makeContext(): ProtocolContext {
  return {
    workingDirectory: "/tmp",
    audit: { log: () => {} } as any,
    signal: { emit: async () => {} } as any,
    memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    tools: new Map(),
  };
}

describe("/smart protocol", () => {
  let store: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(`${TEST_DIR}/security-basics.md`, FIXTURE);
    memory = new SQLiteMemory(TEST_DB);
    store = new SmartsStore();
    await store.initialize(
      { smartsDir: TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB),
      unlink(`${TEST_DB}-wal`),
      unlink(`${TEST_DB}-shm`),
      rm(TEST_DIR, { recursive: true }),
    ]);
  });

  test("list returns all SMARTS entries", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "list" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security-basics");
  });

  test("show displays a specific entry", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "show security-basics" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Validate all input");
  });

  test("show returns error for unknown entry", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "show nonexistent" }, makeContext());
    expect(result.success).toBe(false);
    expect(result.summary).toContain("not found");
  });

  test("domains lists all domains", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "domains" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security");
  });

  test("search returns FTS5 results", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "search xss injection" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("security-basics");
  });

  test("reload re-indexes the directory", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "reload" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("reindex");
  });

  test("unknown subcommand returns help", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "invalid" }, makeContext());
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown");
  });

  test("empty args returns help", async () => {
    const proto = createSmartProtocol(store);
    const result = await proto.execute({ rawArgs: "" }, makeContext());
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-protocol.test.ts`
Expected: FAIL — `createSmartProtocol` not found

**Step 3: Implement the /smart protocol**

```typescript
import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../modules/types.ts";
import type { SmartsStore } from "./store.ts";

export function createSmartProtocol(store: SmartsStore): FridayProtocol {
  return {
    name: "smart",
    description: "Manage Friday's SMARTS knowledge base",
    aliases: ["smarts", "knowledge"],
    parameters: [],
    clearance: ["read-fs"],
    execute: async (args: Record<string, unknown>, _context: ProtocolContext): Promise<ProtocolResult> => {
      const rawArgs = (args.rawArgs as string) ?? "";
      const parts = rawArgs.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "list":
          return handleList(store);
        case "show":
          return handleShow(store, rest);
        case "domains":
          return handleDomains(store);
        case "search":
          return handleSearch(store, rest);
        case "reload":
          return handleReload(store);
        default:
          return {
            success: false,
            summary: `Unknown subcommand: "${subcommand}". Available: list, show <name>, domains, search <query>, reload, pin <name>, unpin <name>`,
          };
      }
    },
  };
}

function handleList(store: SmartsStore): ProtocolResult {
  const entries = store.all();
  if (entries.length === 0) {
    return { success: true, summary: "No SMARTS loaded." };
  }
  const lines = entries.map(
    (e) => `  ${e.name} [${e.domain}] confidence:${e.confidence} source:${e.source}`,
  );
  return { success: true, summary: `SMARTS (${entries.length}):\n${lines.join("\n")}` };
}

async function handleShow(store: SmartsStore, name: string): Promise<ProtocolResult> {
  if (!name) return { success: false, summary: "Usage: /smart show <name>" };
  const entry = await store.getByName(name);
  if (!entry) return { success: false, summary: `SMART "${name}" not found.` };
  return {
    success: true,
    summary: `${entry.name} [${entry.domain}] confidence:${entry.confidence}\n\n${entry.content}`,
  };
}

function handleDomains(store: SmartsStore): ProtocolResult {
  const domains = store.domains();
  if (domains.length === 0) {
    return { success: true, summary: "No domains found." };
  }
  return { success: true, summary: `Domains: ${domains.join(", ")}` };
}

async function handleSearch(store: SmartsStore, query: string): Promise<ProtocolResult> {
  if (!query) return { success: false, summary: "Usage: /smart search <query>" };
  const results = await store.findRelevant(query);
  if (results.length === 0) {
    return { success: true, summary: "No matching SMARTS found." };
  }
  const lines = results.map((e) => `  ${e.name} [${e.domain}] confidence:${e.confidence}`);
  return { success: true, summary: `Matches (${results.length}):\n${lines.join("\n")}` };
}

async function handleReload(store: SmartsStore): Promise<ProtocolResult> {
  await store.reindex();
  return { success: true, summary: `SMARTS reindex complete. ${store.all().length} entries loaded.` };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-protocol.test.ts`
Expected: ALL PASS

**Step 5: Wire /smart protocol into Runtime**

In `src/core/runtime.ts`, after SmartsStore initialization and before module loading, register the protocol:

```typescript
import { createSmartProtocol } from "../smarts/protocol.ts";

// In boot(), after smartsStore.initialize():
if (this._smarts) {
  this._protocols.register(createSmartProtocol(this._smarts));
}
```

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/smarts/protocol.ts tests/unit/smarts-protocol.test.ts src/core/runtime.ts
git commit -m "feat(smarts): add /smart protocol for knowledge management"
```

---

### Task 7: SmartsCurator — Autonomous Knowledge Extraction

**Files:**
- Create: `src/smarts/curator.ts`
- Create: `tests/unit/smarts-curator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsCurator, EXTRACTION_PROMPT } from "../../src/smarts/curator.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { unlink, mkdir, rm } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-curator.db";
const TEST_DIR = "/tmp/friday-test-curator-smarts";

describe("SmartsCurator", () => {
  let store: SmartsStore;
  let memory: SQLiteMemory;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    memory = new SQLiteMemory(TEST_DB);
    store = new SmartsStore();
    await store.initialize(
      { smartsDir: TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
  });

  afterEach(async () => {
    memory.close();
    await Promise.allSettled([
      unlink(TEST_DB),
      unlink(`${TEST_DB}-wal`),
      unlink(`${TEST_DB}-shm`),
      rm(TEST_DIR, { recursive: true }),
    ]);
  });

  test("EXTRACTION_PROMPT is defined and non-empty", () => {
    expect(EXTRACTION_PROMPT).toBeDefined();
    expect(EXTRACTION_PROMPT.length).toBeGreaterThan(0);
  });

  test("skips extraction for short conversations (< 5 exchanges)", async () => {
    const stubProvider: LLMProvider = {
      name: "stub",
      defaultModel: "stub",
      chat: async () => "should not be called",
    };
    const curator = new SmartsCurator(store, stubProvider);
    const messages: ConversationMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(0);
  });

  test("calls provider with extraction prompt for long conversations", async () => {
    let calledWith = "";
    const mockProvider: LLMProvider = {
      name: "mock",
      defaultModel: "mock",
      chat: async (_system, messages) => {
        calledWith = messages[messages.length - 1]?.content ?? "";
        return JSON.stringify([
          {
            name: "docker-networking",
            domain: "docker",
            tags: ["docker", "networking", "bridge"],
            confidence: 0.7,
            content: "# Docker Networking\n\nUse bridge networks for container isolation.",
          },
        ]);
      },
    };
    const curator = new SmartsCurator(store, mockProvider);
    const messages: ConversationMessage[] = [
      { role: "user", content: "How does Docker networking work?" },
      { role: "assistant", content: "Docker uses several network drivers..." },
      { role: "user", content: "What about bridge networks?" },
      { role: "assistant", content: "Bridge networks provide container isolation..." },
      { role: "user", content: "How do I create a custom bridge?" },
      { role: "assistant", content: "Use docker network create..." },
      { role: "user", content: "And how do I connect containers to it?" },
      { role: "assistant", content: "Use --network flag or docker network connect..." },
      { role: "user", content: "What about DNS resolution between containers?" },
      { role: "assistant", content: "Docker provides automatic DNS resolution..." },
    ];
    await curator.extractFromConversation(messages);
    expect(calledWith).toContain("Docker");
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.name).toBe("docker-networking");
    expect(store.all()[0]!.source).toBe("conversation");
  });

  test("handles malformed provider response gracefully", async () => {
    const badProvider: LLMProvider = {
      name: "bad",
      defaultModel: "bad",
      chat: async () => "this is not JSON",
    };
    const curator = new SmartsCurator(store, badProvider);
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i} about TypeScript`,
    }));
    // Should not throw
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(0);
  });

  test("handles provider error gracefully", async () => {
    const failingProvider: LLMProvider = {
      name: "failing",
      defaultModel: "failing",
      chat: async () => { throw new Error("API down"); },
    };
    const curator = new SmartsCurator(store, failingProvider);
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i} about Go programming`,
    }));
    // Should not throw
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-curator.test.ts`
Expected: FAIL — `SmartsCurator` and `EXTRACTION_PROMPT` not found

**Step 3: Implement SmartsCurator**

```typescript
import type { SmartsStore } from "./store.ts";
import type { LLMProvider } from "../providers/types.ts";
import type { ConversationMessage } from "../core/types.ts";

const MIN_MESSAGES_FOR_EXTRACTION = 10;

export const EXTRACTION_PROMPT = `You are a knowledge extraction system. Review the conversation below and extract reusable domain knowledge.

Return a JSON array of knowledge entries. Each entry must have:
- "name": kebab-case unique identifier (e.g., "docker-networking-basics")
- "domain": broad category (e.g., "docker", "security", "typescript", "bun")
- "tags": array of keywords for search indexing
- "confidence": 0.0-1.0 based on how authoritative the information is
- "content": markdown-formatted knowledge (concise, actionable, not conversation-specific)

Rules:
- Only extract knowledge that would be useful in future conversations
- Do not extract conversation-specific context or personal information
- Write content as reference material, not as conversation summaries
- Each entry should be self-contained

Return ONLY the JSON array, no other text. If no knowledge is worth extracting, return [].`;

interface ExtractedSmart {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  content: string;
}

export class SmartsCurator {
  constructor(
    private store: SmartsStore,
    private provider: LLMProvider,
  ) {}

  async extractFromConversation(messages: ConversationMessage[]): Promise<void> {
    if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return;

    try {
      const conversationText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");

      const response = await this.provider.chat(
        EXTRACTION_PROMPT,
        [{ role: "user", content: conversationText }],
        { model: this.provider.defaultModel, maxTokens: 4096 },
      );

      const extracted = this.parseResponse(response);
      for (const smart of extracted) {
        await this.store.create({
          name: smart.name,
          domain: smart.domain,
          tags: smart.tags,
          confidence: Math.min(smart.confidence, 0.7), // Cap auto-generated at 0.7
          source: "conversation",
          content: smart.content,
        });
      }
    } catch {
      // Non-blocking: log but don't throw
    }
  }

  private parseResponse(response: string): ExtractedSmart[] {
    try {
      // Try to find JSON array in the response
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (item: unknown): item is ExtractedSmart =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as ExtractedSmart).name === "string" &&
          typeof (item as ExtractedSmart).domain === "string" &&
          Array.isArray((item as ExtractedSmart).tags) &&
          typeof (item as ExtractedSmart).content === "string",
      );
    } catch {
      return [];
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-curator.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/smarts/curator.ts tests/unit/smarts-curator.test.ts
git commit -m "feat(smarts): add SmartsCurator for autonomous knowledge extraction"
```

---

### Task 8: Wire Curator into Runtime via session:end Signal

**Files:**
- Modify: `src/core/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/runtime.test.ts`:

```typescript
test("session:end triggers SMARTS extraction (non-blocking)", async () => {
  let extractCalled = false;
  const capturingProvider: LLMProvider = {
    name: "capturing",
    defaultModel: "capture",
    chat: async () => {
      extractCalled = true;
      return "[]";
    },
  };

  const runtime = new FridayRuntime();
  await runtime.boot({
    injectedProvider: capturingProvider,
    smartsDir: TEST_SMARTS_DIR_RT,
  });

  // Simulate a conversation long enough to trigger extraction
  for (let i = 0; i < 6; i++) {
    await runtime.process(`Message ${i} about security`);
  }

  await runtime.shutdown();
  // Give async extraction a moment
  await new Promise((resolve) => setTimeout(resolve, 100));
  // The provider was called for chat AND for extraction
  expect(extractCalled).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime.test.ts`
Expected: FAIL — extraction not wired

**Step 3: Wire curator into Runtime**

In `src/core/runtime.ts`:

1. Add import: `import { SmartsCurator } from "../smarts/curator.ts";`
2. Add private field: `private _curator?: SmartsCurator;`
3. In `boot()`, after SmartsStore initialization:
   ```typescript
   if (this._smarts) {
     this._curator = new SmartsCurator(this._smarts, this._cortex.provider);
   }
   ```
   Note: You'll need to expose `provider` as a getter on Cortex, or pass the provider separately.

   Alternative: pass the provider from the config directly:
   ```typescript
   const provider = config.injectedProvider ?? createProvider(config.provider ?? DEFAULT_PROVIDER);
   // ... later ...
   if (this._smarts) {
     this._curator = new SmartsCurator(this._smarts, provider);
   }
   ```

4. In `shutdown()`, before emitting `session:end`, trigger curator extraction as fire-and-forget:
   ```typescript
   if (this._curator) {
     const history = this._cortex.getHistory();
     // Fire-and-forget: don't await
     void this._curator.extractFromConversation(history).catch(() => {});
   }
   ```

5. Add `getHistory()` method to Cortex that returns a copy of `conversationHistory`.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/runtime.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/core/runtime.ts src/core/cortex.ts tests/unit/runtime.test.ts
git commit -m "feat(smarts): wire SmartsCurator into runtime session:end for async extraction"
```

---

### Task 9: CLI Integration — Pass smartsDir from Chat Command

**Files:**
- Modify: `src/cli/commands/chat.ts` (or wherever the chat command creates the runtime)

**Step 1: Read the chat command file**

Read `src/cli/commands/chat.ts` to understand how FridayRuntime is configured.

**Step 2: Add smartsDir to the runtime config**

Pass `smartsDir: "./smarts"` (or resolve it relative to the project root) when booting the runtime in the chat command.

**Step 3: Run the full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 4: Run lint**

Run: `bun run lint:fix`
Expected: PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(smarts): enable SMARTS in CLI chat command"
```

---

### Task 10: Create Seed SMARTS Files

**Files:**
- Create: `smarts/bun-patterns.md`
- Create: `smarts/friday-conventions.md`

**Step 1: Create bun-patterns.md**

```markdown
---
name: bun-patterns
domain: bun
tags: [bun, runtime, javascript, typescript, sqlite, testing]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Bun Runtime Patterns

## File Operations
- Use `Bun.file()` over `node:fs` readFile/writeFile
- Use `Bun.write()` for writing files

## HTTP/WebSocket
- Use `Bun.serve()` for servers (not express)

## Shell
- Use `Bun.$\`cmd\`` instead of execa for shell commands

## SQLite
- Use `bun:sqlite` (not better-sqlite3)
- Transactions: `db.transaction(() => { ... })()` — must invoke the returned function

## Testing
- Use `bun:test` (not jest or vitest)
- Import from `bun:test`: describe, test, expect, beforeEach, afterEach

## Environment
- Bun auto-loads `.env` files — do not use dotenv
```

**Step 2: Create friday-conventions.md**

```markdown
---
name: friday-conventions
domain: project-friday
tags: [friday, conventions, architecture, mcu]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Friday Project Conventions

## MCU Naming
- Cortex = LLM brain, conversation state
- Protocol = slash command (/command routing)
- Directive = standing order (signal-triggered action)
- Module = suit upgrade (bundled tools/protocols/knowledge)
- Signal = event (typed, flows through SignalBus)
- Clearance = permission gate

## Architecture
- FridayRuntime is the composition root
- Boot order: SignalBus → ClearanceManager → AuditLogger → NotificationManager → ProtocolRegistry → DirectiveStore/Engine → SmartsStore → Cortex → Modules
- Protocols bypass LLM entirely
- Everything flows through typed interfaces

## Testing
- Use `injectedProvider` stubs for tests (never real API keys)
- SQLite tests clean up WAL: unlink .db, .db-wal, .db-shm in afterEach
- Temp files in /tmp/friday-test-*
```

**Step 3: Create smarts/ directory**

Run: `mkdir -p smarts`

**Step 4: Commit**

```bash
git add smarts/bun-patterns.md smarts/friday-conventions.md
git commit -m "feat(smarts): add seed knowledge files for Bun patterns and Friday conventions"
```

---

### Task 11: Final Validation

**Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: PASS (may auto-fix formatting)

**Step 4: Verify SMARTS count**

Manually verify the total test count has increased. The previous count was ~84 tests across 12 files. This plan adds ~30+ new tests across 4 new test files (smarts-parser, smarts-store, smarts-protocol, smarts-curator) plus additions to existing files (friday.test.ts, runtime.test.ts).

Expected: ~115+ tests across 16 files.

**Step 5: Update CLAUDE.md if needed**

Update the architecture diagram in CLAUDE.md to include `src/smarts/` and the boot order change.

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: update CLAUDE.md with SMARTS subsystem architecture"
```
