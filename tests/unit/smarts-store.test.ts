import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { unlink, mkdir, writeFile, rm } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-smarts.db";
const TEST_SMARTS_DIR = "/tmp/friday-test-smarts";
const SESSION_TEST_DB = "/tmp/friday-test-smarts-session.db";
const SESSION_TEST_DIR = "/tmp/friday-test-smarts-session";

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
    expect(results.map((r) => r.name)).toContain("security-basics");
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

  test("update on nonexistent entry throws", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    expect(store.update("nonexistent", "new content")).rejects.toThrow("not found");
  });

  test("rejects duplicate entries that sanitize to the same filename", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    await store.create({ name: "Bun Tips!", domain: "dev", tags: ["bun"], confidence: 0.8, source: "manual", content: "First" });
    expect(store.create({ name: "Bun Tips?", domain: "dev", tags: ["bun"], confidence: 0.8, source: "manual", content: "Second" })).rejects.toThrow();
  });

  test("create with duplicate name cleans up old embedding", async () => {
    await store.initialize(
      { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
      memory,
    );
    await store.create({
      name: "docker-tips",
      domain: "docker",
      tags: ["docker"],
      confidence: 0.8,
      source: "manual",
      content: "# Docker Tips v1\n\nOriginal content.",
    });
    await store.create({
      name: "docker-tips",
      domain: "docker",
      tags: ["docker", "updated"],
      confidence: 0.9,
      source: "manual",
      content: "# Docker Tips v2\n\nUpdated content.",
    });
    const all = store.all();
    const dockerEntries = all.filter((e) => e.name === "docker-tips");
    expect(dockerEntries).toHaveLength(1);
    expect(dockerEntries[0]!.content).toContain("v2");

    const results = await store.findRelevant("docker tips");
    const dockerResults = results.filter((r) => r.name === "docker-tips");
    expect(dockerResults).toHaveLength(1);
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

  test("initialize called twice does not accumulate duplicate embeddings", async () => {
    const config = { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 };
    await store.initialize(config, memory);
    await store.initialize(config, memory);
    const results = await memory.search("smarts", "security injection owasp", 20);
    const securityResults = results.filter(
      (r) => (r.metadata as { name?: string })?.name === "security-basics",
    );
    expect(securityResults).toHaveLength(1);
  });

  test("reindex does not leave orphaned embeddings", async () => {
    const config = { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 };
    await store.initialize(config, memory);
    await store.reindex();
    const results = await memory.search("smarts", "security injection owasp", 20);
    const securityResults = results.filter(
      (r) => (r.metadata as { name?: string })?.name === "security-basics",
    );
    expect(securityResults).toHaveLength(1);
  });

  describe("session-based TTL", () => {
    test("increments session counter on each initialize", async () => {
      // Use isolated DB/dir to avoid interference from shared beforeEach
      await mkdir(SESSION_TEST_DIR, { recursive: true });

      const store1 = new SmartsStore();
      const mem1 = new SQLiteMemory(SESSION_TEST_DB);
      await store1.initialize(
        { smartsDir: SESSION_TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        mem1,
      );
      expect(store1.currentSession).toBe(1);
      mem1.close();

      const store2 = new SmartsStore();
      const mem2 = new SQLiteMemory(SESSION_TEST_DB);
      await store2.initialize(
        { smartsDir: SESSION_TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        mem2,
      );
      expect(store2.currentSession).toBe(2);
      mem2.close();

      await Promise.allSettled([
        unlink(SESSION_TEST_DB),
        unlink(`${SESSION_TEST_DB}-wal`),
        unlink(`${SESSION_TEST_DB}-shm`),
        rm(SESSION_TEST_DIR, { recursive: true }),
      ]);
    });

    test("stamps legacy entries with current session on first boot", async () => {
      await writeFile(`${TEST_SMARTS_DIR}/legacy.md`, `---
name: legacy-entry
domain: test
tags: [test]
confidence: 0.7
source: conversation
created: 2026-02-22
updated: 2026-02-22
---

Legacy content.`);

      const freshStore = new SmartsStore();
      await freshStore.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );

      const entry = await freshStore.getByName("legacy-entry");
      expect(entry).toBeDefined();
      expect(entry!.sessionId).toBe(freshStore.currentSession);
    });

    test("prunes expired conversation entries on boot", async () => {
      await writeFile(`${TEST_SMARTS_DIR}/old-entry.md`, `---
name: old-entry
domain: test
tags: [test]
confidence: 0.7
source: conversation
session_id: 1
created: 2026-02-22
updated: 2026-02-22
---

Old content.`);

      // Set counter to 9 so initialize increments to 10 (age = 10 - 1 = 9 > 5)
      await memory.set("smarts", "session-counter", 9);

      const freshStore = new SmartsStore();
      await freshStore.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );

      expect(freshStore.currentSession).toBe(10);
      const entry = await freshStore.getByName("old-entry");
      expect(entry).toBeUndefined();
      expect(await Bun.file(`${TEST_SMARTS_DIR}/old-entry.md`).exists()).toBe(false);
    });

    test("does NOT prune manual entries regardless of age", async () => {
      await writeFile(`${TEST_SMARTS_DIR}/manual-entry.md`, `---
name: manual-entry
domain: test
tags: [test]
confidence: 0.9
source: manual
session_id: 1
created: 2026-02-22
updated: 2026-02-22
---

Manual content that should persist forever.`);

      await memory.set("smarts", "session-counter", 99);

      const freshStore = new SmartsStore();
      await freshStore.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );

      const entry = await freshStore.getByName("manual-entry");
      expect(entry).toBeDefined();
      expect(entry!.content).toContain("persist forever");
    });

    test("does NOT prune entries within TTL window", async () => {
      await writeFile(`${TEST_SMARTS_DIR}/fresh-entry.md`, `---
name: fresh-entry
domain: test
tags: [test]
confidence: 0.7
source: conversation
session_id: 8
created: 2026-02-22
updated: 2026-02-22
---

Fresh content.`);

      await memory.set("smarts", "session-counter", 9);

      const freshStore = new SmartsStore();
      await freshStore.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );

      expect(freshStore.currentSession).toBe(10);
      const entry = await freshStore.getByName("fresh-entry");
      expect(entry).toBeDefined();
    });

    test("create() stamps entry with current session", async () => {
      await store.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );

      await store.create({
        name: "new-entry",
        domain: "test",
        tags: ["test"],
        confidence: 0.7,
        source: "conversation",
        content: "New content.",
      });

      const entry = await store.getByName("new-entry");
      expect(entry!.sessionId).toBe(store.currentSession);
    });

    test("update() refreshes sessionId to current session", async () => {
      // Set counter to 4 so currentSession becomes 5 — distinct from sessionId: 1
      await memory.set("smarts", "session-counter", 4);

      const freshStore = new SmartsStore();
      await freshStore.initialize(
        { smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
        memory,
      );
      expect(freshStore.currentSession).toBe(5);

      await freshStore.create({
        name: "update-me",
        domain: "test",
        tags: ["test"],
        confidence: 0.7,
        source: "conversation",
        sessionId: 1,
        content: "Original.",
      });

      await freshStore.update("update-me", "Updated content.");

      const entry = await freshStore.getByName("update-me");
      expect(entry!.sessionId).toBe(5);
      expect(entry!.content).toContain("Updated content");
    });
  });
});
