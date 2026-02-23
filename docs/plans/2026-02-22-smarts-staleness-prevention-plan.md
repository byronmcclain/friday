# SMARTS Staleness Prevention Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent stale knowledge from poisoning Friday's system prompt by adding session-based TTL to SMARTS entries and blocking volatile system state extraction.

**Architecture:** Two layers — (1) the curator's extraction prompt and a post-extraction regex filter prevent volatile system state (tool inventories, module lists) from being captured, and (2) a session-based TTL stamps each entry with a session counter, pruning entries older than 5 sessions on boot.

**Tech Stack:** Bun, TypeScript, bun:test, SQLiteMemory KV store for session counter persistence.

---

### Task 1: Add `sessionId` to SmartEntry and parser

**Files:**
- Modify: `src/smarts/types.ts:3-11`
- Modify: `src/smarts/parser.ts:7-36` (parseFrontmatter)
- Modify: `src/smarts/parser.ts:46-62` (serializeSmartFile)
- Test: `tests/unit/smarts-parser.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/smarts-parser.test.ts`:

```typescript
test("parses session_id from frontmatter", () => {
	const raw = `---
name: test-entry
domain: test
tags: [a, b]
confidence: 0.7
source: conversation
session_id: 42
created: 2026-02-22
updated: 2026-02-22
---

Test content.`;
	const result = parseFrontmatter(raw);
	expect(result).not.toBeNull();
	expect(result!.sessionId).toBe(42);
});

test("parses entry without session_id as undefined", () => {
	const raw = `---
name: legacy-entry
domain: test
tags: [a]
confidence: 0.7
source: manual
created: 2026-02-22
updated: 2026-02-22
---

Legacy content.`;
	const result = parseFrontmatter(raw);
	expect(result).not.toBeNull();
	expect(result!.sessionId).toBeUndefined();
});

test("serializeSmartFile includes session_id when present", () => {
	const output = serializeSmartFile({
		name: "test",
		domain: "test",
		tags: ["a"],
		confidence: 0.7,
		source: "conversation",
		sessionId: 42,
		content: "Test content.",
	});
	expect(output).toContain("session_id: 42");
});

test("serializeSmartFile omits session_id when undefined", () => {
	const output = serializeSmartFile({
		name: "test",
		domain: "test",
		tags: ["a"],
		confidence: 0.7,
		source: "manual",
		content: "Test content.",
	});
	expect(output).not.toContain("session_id");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-parser.test.ts -v`
Expected: FAIL — `sessionId` property doesn't exist on the return type yet.

**Step 3: Implement the changes**

In `src/smarts/types.ts`, add `sessionId` to `SmartEntry`:

```typescript
export interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: SmartSource;
  sessionId?: number;     // session counter when created/last refreshed
  content: string;
  filePath: string;
}
```

In `src/smarts/parser.ts`, update `parseFrontmatter()` to parse `session_id`. After the `source` parsing (line 24-26), add:

```typescript
  const sessionIdRaw = fields.session_id ?? fields.sessionId;
  const sessionId = sessionIdRaw ? Number.parseInt(sessionIdRaw, 10) : undefined;
```

And include `sessionId` in the return object (add after `source,`):

```typescript
    ...(sessionId !== undefined && Number.isFinite(sessionId) ? { sessionId } : {}),
```

In `src/smarts/parser.ts`, update `serializeSmartFile()` to serialize `session_id`. After the `source` line (line 56), add a conditional line:

```typescript
${entry.sessionId !== undefined ? `session_id: ${entry.sessionId}\n` : ""}
```

Note: the template literal must be placed inside the existing template string, after the `source` line and before `created`.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-parser.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/smarts/types.ts src/smarts/parser.ts tests/unit/smarts-parser.test.ts
git commit -m "feat(smarts): add sessionId field to SmartEntry and parser"
```

---

### Task 2: Add session counter and boot-time pruning to SmartsStore

**Files:**
- Modify: `src/smarts/store.ts:9-26` (class fields and initialize)
- Test: `tests/unit/smarts-store.test.ts`

**Step 1: Write the failing tests**

Add a new `describe("session-based TTL", ...)` block to `tests/unit/smarts-store.test.ts`:

```typescript
describe("session-based TTL", () => {
	test("increments session counter on each initialize", async () => {
		// First boot
		const store1 = new SmartsStore();
		const mem1 = new SQLiteMemory(TEST_DB);
		await store1.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			mem1,
		);
		const session1 = store1.currentSession;
		expect(session1).toBe(1);
		mem1.close();

		// Second boot (reopen same DB)
		const store2 = new SmartsStore();
		const mem2 = new SQLiteMemory(TEST_DB);
		await store2.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			mem2,
		);
		expect(store2.currentSession).toBe(2);
		mem2.close();
	});

	test("stamps legacy entries with current session on first boot", async () => {
		// Write a legacy file with no session_id
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

		const store = new SmartsStore();
		await store.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			memory,
		);

		const entry = await store.getByName("legacy-entry");
		expect(entry).toBeDefined();
		expect(entry!.sessionId).toBe(store.currentSession);
	});

	test("prunes expired conversation entries on boot", async () => {
		// Write a file with session_id far in the past
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

		// Simulate being on session 10 (1 + 5 = 6, so session 1 is expired at session 7+)
		// We need to set the counter to 9 so initialize increments to 10
		await memory.set("smarts", "session-counter", 9);

		const store = new SmartsStore();
		await store.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			memory,
		);

		expect(store.currentSession).toBe(10);
		const entry = await store.getByName("old-entry");
		expect(entry).toBeUndefined();
		// File should be deleted from disk
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

		const store = new SmartsStore();
		await store.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			memory,
		);

		const entry = await store.getByName("manual-entry");
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

		const store = new SmartsStore();
		await store.initialize(
			{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			memory,
		);

		expect(store.currentSession).toBe(10);
		const entry = await store.getByName("fresh-entry");
		expect(entry).toBeDefined();
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-store.test.ts -v`
Expected: FAIL — `currentSession` property doesn't exist yet.

**Step 3: Implement the changes**

In `src/smarts/store.ts`, add to the class:

```typescript
private _currentSession = 0;

get currentSession(): number {
  return this._currentSession;
}
```

Rewrite `initialize()` to add session counter management and pruning before `scanAndIndex()`:

```typescript
async initialize(config: SmartsConfig, memory: SQLiteMemory): Promise<void> {
  this.config = config;
  this.memory = memory;
  this.entries.clear();
  this.embeddingIds.clear();

  const dir = resolve(config.smartsDir);
  await mkdir(dir, { recursive: true });

  // Increment session counter
  const prev = await this.memory.get<number>("smarts", "session-counter") ?? 0;
  this._currentSession = prev + 1;
  await this.memory.set("smarts", "session-counter", this._currentSession);

  // Prune expired entries before indexing
  await this.pruneExpired(dir);

  await this.memory.purgeNamespace(SMARTS_NAMESPACE);
  await this.scanAndIndex(dir);
}
```

Add the `pruneExpired()` private method. Import `unlink` from `node:fs/promises` at the top:

```typescript
import { mkdir, unlink } from "node:fs/promises";
```

```typescript
private static readonly MAX_SESSION_AGE = 5;

private async pruneExpired(dir: string): Promise<void> {
  const glob = new Bun.Glob("*.md");
  for await (const match of glob.scan({ cwd: dir, onlyFiles: true })) {
    const filePath = `${dir}/${match}`;
    try {
      const raw = await Bun.file(filePath).text();
      const parsed = parseFrontmatter(raw);
      if (!parsed) continue;

      // Manual entries never expire
      if (parsed.source === "manual") continue;

      if (parsed.sessionId === undefined) {
        // Legacy entry — stamp with current session (migration)
        const stamped = serializeSmartFile({ ...parsed, sessionId: this._currentSession });
        await Bun.write(filePath, stamped);
        continue;
      }

      // Prune if expired
      if (this._currentSession - parsed.sessionId > SmartsStore.MAX_SESSION_AGE) {
        await unlink(filePath);
      }
    } catch {
      // Skip files that can't be read or parsed
    }
  }
}
```

Also import `serializeSmartFile` at the top of `store.ts` (it's already imported).

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-store.test.ts -v`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass (no regressions in other SMARTS tests).

**Step 6: Commit**

```bash
git add src/smarts/store.ts tests/unit/smarts-store.test.ts
git commit -m "feat(smarts): add session-based TTL with boot-time pruning"
```

---

### Task 3: Add volatile extraction prevention to curator

**Files:**
- Modify: `src/smarts/curator.ts:51-61` (EXTRACTION_PROMPT_BASE DO NOT section)
- Modify: `src/smarts/curator.ts:94-141` (extractFromConversation)
- Test: `tests/unit/smarts-curator.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/smarts-curator.test.ts`:

```typescript
describe("volatile extraction filter", () => {
	test("rejects entries containing tool inventory counts", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "friday-tools",
					domain: "project-context",
					tags: ["tools"],
					confidence: 0.7,
					content: "**Current Live Tools (11 total)**:\n- getEnvironmentStatus\n- fs.read",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	test("rejects entries with 'Visible Tools' pattern", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "friday-visible-tools",
					domain: "project-context",
					tags: ["tools"],
					confidence: 0.7,
					content: "Visible Tools:\n- fs.read\n- bash.exec",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	test("rejects entries with 'Current Friday Toolkit' pattern", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "friday-toolkit",
					domain: "project-context",
					tags: ["tools"],
					confidence: 0.7,
					content: "# Current Friday Modules\n\nFilesystem, Forge",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	test("allows non-volatile entries through", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "docker-networking",
					domain: "docker",
					tags: ["docker", "networking"],
					confidence: 0.7,
					content: "# Docker Networking\n\nUse bridge networks for container isolation.",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("docker-networking");
	});

	test("filters volatile entries while keeping valid ones in same batch", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "friday-tools-list",
					domain: "project-context",
					tags: ["tools"],
					confidence: 0.7,
					content: "Friday has 29 tools available.",
				},
				{
					action: "create",
					name: "valid-knowledge",
					domain: "typescript",
					tags: ["ts"],
					confidence: 0.7,
					content: "# TS Tip\n\nUse satisfies for literal type preservation.",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("valid-knowledge");
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-curator.test.ts -v`
Expected: FAIL — volatile entries will be persisted (filter doesn't exist yet).

**Step 3: Implement the changes**

In `src/smarts/curator.ts`, add the volatile patterns constant after the `MIN_MESSAGES_FOR_EXTRACTION` line:

```typescript
const VOLATILE_PATTERNS = [
	/\b\d+\s+tools?\b/i,
	/\btool(?:s|kit)\s*\(/i,
	/\bcurrent.*(?:tools|modules)/i,
	/\bvisible\s+tools/i,
	/\blive\s+tools/i,
];
```

Add a static filter method to `SmartsCurator` (or a module-level function):

```typescript
function isVolatile(content: string): boolean {
	return VOLATILE_PATTERNS.some((p) => p.test(content));
}
```

Export it for testing: `export { isVolatile };` (optional — tests can verify indirectly via curator behavior).

In `extractFromConversation()`, after `const extracted = this.parseResponse(response);` (line 116), add the filter:

```typescript
const filtered = extracted.filter((smart) => !isVolatile(smart.content));
```

Change the `for` loop to iterate `filtered` instead of `extracted`:

```typescript
for (const smart of filtered) {
```

Update the extraction prompt. In `EXTRACTION_PROMPT_BASE`, add to the "DO NOT extract" section (after line 57 — "Ephemeral conversation details..."):

```
- Enumerations of the system's own state: tool inventories, module lists, capability counts, component catalogs, or "what tools does Friday have" summaries — these are defined in code and change with every deploy, they are not knowledge
- Lists that restate what the API tool definitions already provide
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-curator.test.ts -v`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/smarts/curator.ts tests/unit/smarts-curator.test.ts
git commit -m "feat(smarts): add volatile extraction filter and prompt exclusions"
```

---

### Task 4: Wire session stamping through create/update paths

**Files:**
- Modify: `src/smarts/store.ts:102-132` (create method)
- Modify: `src/smarts/store.ts:134-152` (update method)
- Modify: `src/smarts/curator.ts:117-138` (extraction loop)
- Test: `tests/unit/smarts-curator.test.ts`
- Test: `tests/unit/smarts-store.test.ts`

**Step 1: Write the failing tests**

Add to the `describe("session-based TTL", ...)` block in `tests/unit/smarts-store.test.ts`:

```typescript
test("create() stamps entry with current session", async () => {
	const store = new SmartsStore();
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
	const store = new SmartsStore();
	await store.initialize(
		{ smartsDir: TEST_SMARTS_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
		memory,
	);

	await store.create({
		name: "update-me",
		domain: "test",
		tags: ["test"],
		confidence: 0.7,
		source: "conversation",
		sessionId: 1,
		content: "Original.",
	});

	await store.update("update-me", "Updated content.");

	const entry = await store.getByName("update-me");
	expect(entry!.sessionId).toBe(store.currentSession);
	expect(entry!.content).toContain("Updated content");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/smarts-store.test.ts -v`
Expected: FAIL — `sessionId` is not set on create/update.

**Step 3: Implement the changes**

In `src/smarts/store.ts`, modify `create()` to stamp the session. Before line 117 (`const content = serializeSmartFile(entry);`), override the sessionId:

```typescript
const stamped = { ...entry, sessionId: this._currentSession };
const content = serializeSmartFile(stamped);
```

And update the `full` object on line 121:

```typescript
const full: SmartEntry = { ...stamped, filePath };
```

In `update()`, modify the `updated` construction to refresh sessionId:

```typescript
const updated: SmartEntry = { ...existing, content, sessionId: this._currentSession };
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/smarts-store.test.ts -v`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/smarts/store.ts src/smarts/curator.ts tests/unit/smarts-store.test.ts tests/unit/smarts-curator.test.ts
git commit -m "feat(smarts): stamp sessionId on create/update for TTL renewal"
```

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (604+ tests).

**Step 2: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: Clean (ignore pre-existing web/ typecheck errors).

**Step 3: Integration smoke test**

Run the module discovery + SMARTS boot simulation:

```bash
bun -e '
import { resolve } from "node:path";
import { FridayRuntime } from "./src/core/runtime.ts";

const runtime = new FridayRuntime();
const stubProvider = {
  name: "test", defaultModel: "m", defaultFastModel: "f",
  async chat() { return { type: "text" as const, text: "stub" }; },
};
await runtime.boot({
  provider: "grok", injectedProvider: stubProvider,
  smartsDir: resolve("./smarts"), dataDir: resolve("./data"),
  modulesDir: resolve("./src/modules"), forgeDir: resolve("./forge"),
  fresh: true,
});
console.log("Tools:", runtime.cortex.availableTools.length);
const smarts = runtime.smarts;
if (smarts) {
  const results = await smarts.findRelevant("What tools can you see?");
  console.log("SMARTS for tool query:", results.length, "entries");
  for (const r of results) console.log("  ", r.name);
}
await runtime.shutdown();
'
```

Expected: 29 tools, no tool-inventory SMARTS entries returned.

**Step 4: Commit (if any lint fixes were needed)**

```bash
git add -A && git commit -m "chore: lint fixes for smarts staleness prevention"
```
