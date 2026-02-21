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

    const file = Bun.file(entry.filePath);
    expect(await file.exists()).toBe(true);

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
