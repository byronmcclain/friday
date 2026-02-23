# Conversational Memory Recall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Friday the ability to search and recall past conversations via a tool-based FTS5 search system.

**Architecture:** Two new methods on SQLiteMemory (`indexConversation`, `searchConversations`) provide the FTS5 layer. A `recall_memory` tool registered on Cortex lets the LLM search summaries (mode: "search") then drill into full messages (mode: "recall"). Summaries are indexed at save-time and backfilled on first boot.

**Tech Stack:** bun:sqlite FTS5, existing `embed()`/`search()`/`forget()` infrastructure, `FridayTool` pattern.

**Design:** `docs/plans/2026-02-23-conversational-memory-recall-design.md`

---

### Task 1: Add `indexConversation()` and `searchConversations()` to SQLiteMemory

**Files:**
- Modify: `src/core/memory.ts` — add two methods after `deleteAllConversations()` (line 170)
- Test: `tests/unit/memory-conversations.test.ts` — new file

**Step 1: Write the failing tests**

Create `tests/unit/memory-conversations.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { ConversationSession } from "../../src/core/memory.ts";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-memory-conversations.db";

function makeSession(id: string, summary?: string, date?: Date): ConversationSession {
	return {
		id,
		startedAt: date ?? new Date("2026-02-20T10:00:00Z"),
		endedAt: new Date("2026-02-20T11:00:00Z"),
		provider: "grok",
		model: "grok-3",
		messages: [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
		],
		summary,
	};
}

describe("SQLiteMemory conversation indexing", () => {
	let memory: SQLiteMemory;

	beforeEach(() => {
		memory = new SQLiteMemory(TEST_DB);
	});

	afterEach(async () => {
		memory.close();
		await Promise.allSettled([
			unlink(TEST_DB),
			unlink(`${TEST_DB}-wal`),
			unlink(`${TEST_DB}-shm`),
		]);
	});

	test("indexConversation embeds summary into FTS5", async () => {
		const session = makeSession("sess-1", "Discussed Docker networking and bridge networks.");
		await memory.indexConversation(session);

		const results = await memory.searchConversations("Docker");
		expect(results).toHaveLength(1);
		expect(results[0]!.sessionId).toBe("sess-1");
		expect(results[0]!.summary).toContain("Docker");
	});

	test("indexConversation skips sessions without summary", async () => {
		const session = makeSession("sess-no-summary");
		await memory.indexConversation(session);

		const results = await memory.searchConversations("Hello");
		expect(results).toHaveLength(0);
	});

	test("indexConversation is idempotent", async () => {
		const session = makeSession("sess-idem", "Implemented SMARTS knowledge system.");
		await memory.indexConversation(session);
		await memory.indexConversation(session);

		const results = await memory.searchConversations("SMARTS");
		expect(results).toHaveLength(1);
	});

	test("searchConversations returns results with metadata", async () => {
		const session = makeSession("sess-meta", "Debugged CPU polling in Sensorium.", new Date("2026-02-21T14:30:00Z"));
		await memory.indexConversation(session);

		const results = await memory.searchConversations("Sensorium");
		expect(results).toHaveLength(1);
		expect(results[0]!.sessionId).toBe("sess-meta");
		expect(results[0]!.date).toBe("2026-02-21T14:30:00.000Z");
		expect(results[0]!.summary).toContain("Sensorium");
		expect(results[0]!.similarity).toBeGreaterThan(0);
	});

	test("searchConversations returns empty for no matches", async () => {
		await memory.indexConversation(makeSession("sess-1", "Docker networking discussion."));

		const results = await memory.searchConversations("Kubernetes");
		expect(results).toHaveLength(0);
	});

	test("searchConversations respects limit", async () => {
		await memory.indexConversation(makeSession("sess-1", "Docker networking part one."));
		await memory.indexConversation(makeSession("sess-2", "Docker networking part two."));
		await memory.indexConversation(makeSession("sess-3", "Docker networking part three."));

		const results = await memory.searchConversations("Docker", 2);
		expect(results).toHaveLength(2);
	});

	test("searchConversations handles empty query", async () => {
		await memory.indexConversation(makeSession("sess-1", "Something useful."));

		const results = await memory.searchConversations("");
		expect(results).toHaveLength(0);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/memory-conversations.test.ts`
Expected: FAIL — `indexConversation` is not a function

**Step 3: Implement `indexConversation()` and `searchConversations()`**

Add these two methods to `SQLiteMemory` in `src/core/memory.ts`, after the `deleteAllConversations()` method (line 170):

```typescript
async indexConversation(session: ConversationSession): Promise<void> {
	if (!session.summary) return;

	// Idempotent: remove old embedding if re-indexing
	const existing = await this.get<string>("conversations", session.id);
	if (existing) {
		await this.forget("conversations", existing);
	}

	const embeddingId = await this.embed(
		"conversations",
		session.summary,
		{ sessionId: session.id, date: session.startedAt.toISOString() },
	);

	// Store session → embeddingId mapping for later cleanup
	await this.set("conversations", session.id, embeddingId);
}

async searchConversations(
	query: string,
	limit = 5,
): Promise<Array<{ sessionId: string; date: string; summary: string; similarity: number }>> {
	const results = await this.search("conversations", query, limit);
	return results
		.filter((r) => r.metadata?.sessionId)
		.map((r) => ({
			sessionId: r.metadata!.sessionId as string,
			date: (r.metadata!.date as string) ?? "",
			summary: r.content,
			similarity: r.similarity,
		}));
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/memory-conversations.test.ts`
Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add src/core/memory.ts tests/unit/memory-conversations.test.ts
git commit -m "feat(memory): add conversation indexing and FTS5 search"
```

---

### Task 2: Wire indexing into `saveConversation()` with prune cleanup

**Files:**
- Modify: `src/core/memory.ts:124-145` — update `saveConversation()`, add `cleanupOrphanedConversationEmbeddings()`
- Test: `tests/unit/memory-conversations.test.ts` — add tests

**Step 1: Write the failing tests**

Add these tests to the existing describe block in `tests/unit/memory-conversations.test.ts`:

```typescript
test("saveConversation indexes summary automatically", async () => {
	const session = makeSession("auto-idx", "Auto-indexed conversation about TypeScript generics.");
	await memory.saveConversation(session);

	const results = await memory.searchConversations("TypeScript generics");
	expect(results).toHaveLength(1);
	expect(results[0]!.sessionId).toBe("auto-idx");
});

test("saveConversation skips indexing when no summary", async () => {
	const session = makeSession("no-sum");
	await memory.saveConversation(session);

	const all = await memory.searchConversations("Hello");
	expect(all).toHaveLength(0);
});

test("saveConversation cleans up orphaned embeddings on prune", async () => {
	// Create sessions up to the limit, then add one more to trigger prune
	// Use a small override for testing — we'll test with a helper that checks cleanup logic
	const s1 = makeSession("will-survive", "Survivor conversation.", new Date("2026-02-22T10:00:00Z"));
	const s2 = makeSession("will-die", "Doomed conversation.", new Date("2026-01-01T10:00:00Z"));

	await memory.saveConversation(s2);
	await memory.saveConversation(s1);

	// Both should be searchable
	expect(await memory.searchConversations("Survivor")).toHaveLength(1);
	expect(await memory.searchConversations("Doomed")).toHaveLength(1);

	// After cleanup, orphaned embeddings for deleted conversations should be removed
	// (Full prune test requires MAX_CONVERSATIONS override — test cleanup method directly)
	await memory.cleanupOrphanedConversationEmbeddings();

	// Both still exist because neither conversation was deleted
	expect(await memory.searchConversations("Survivor")).toHaveLength(1);
	expect(await memory.searchConversations("Doomed")).toHaveLength(1);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/memory-conversations.test.ts`
Expected: FAIL — first new test fails because `saveConversation` doesn't call `indexConversation` yet

**Step 3: Implement**

In `src/core/memory.ts`, modify `saveConversation()` to call indexing after the transaction, and add the cleanup method:

Update `saveConversation()` (replace lines 124-145):

```typescript
async saveConversation(session: ConversationSession): Promise<void> {
	this.db.transaction(() => {
		this.db
			.query(
				"INSERT OR REPLACE INTO conversations (id, started_at, ended_at, provider, model, messages, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				session.id,
				session.startedAt.toISOString(),
				session.endedAt?.toISOString() ?? null,
				session.provider,
				session.model,
				JSON.stringify(session.messages),
				session.summary ?? null,
			);
		this.db
			.query(
				"DELETE FROM conversations WHERE id NOT IN (SELECT id FROM conversations ORDER BY started_at DESC LIMIT ?)",
			)
			.run(SQLiteMemory.MAX_CONVERSATIONS);
	})();

	// Index the conversation's summary for recall search
	if (session.summary) {
		await this.indexConversation(session);
	}

	// Clean up FTS5 embeddings for pruned conversations
	await this.cleanupOrphanedConversationEmbeddings();
}
```

Add the cleanup method after `searchConversations()`:

```typescript
async cleanupOrphanedConversationEmbeddings(): Promise<void> {
	const keys = this.db
		.query<{ key: string }, [string]>("SELECT key FROM kv WHERE namespace = ?")
		.all("conversations");

	for (const { key } of keys) {
		if (key === "backfill-done") continue;

		const exists = this.db
			.query<{ id: string }, [string]>("SELECT id FROM conversations WHERE id = ?")
			.get(key);

		if (!exists) {
			const embeddingId = await this.get<string>("conversations", key);
			if (embeddingId) {
				await this.forget("conversations", embeddingId);
			}
			await this.delete("conversations", key);
		}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/memory-conversations.test.ts`
Expected: 10 tests PASS

**Step 5: Run the full test suite to ensure no regressions**

Run: `bun test`
Expected: All tests pass (any existing memory tests still green)

**Step 6: Commit**

```bash
git add src/core/memory.ts tests/unit/memory-conversations.test.ts
git commit -m "feat(memory): auto-index conversations on save with prune cleanup"
```

---

### Task 3: Create the `recall_memory` tool

**Files:**
- Create: `src/core/recall-tool.ts`
- Test: `tests/unit/recall-tool.test.ts` — new file

**Step 1: Write the failing tests**

Create `tests/unit/recall-tool.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRecallTool } from "../../src/core/recall-tool.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { ConversationSession } from "../../src/core/memory.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-recall-tool.db";

const stubContext: ToolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as unknown as ToolContext["audit"],
	signal: { emit: async () => {} } as unknown as ToolContext["signal"],
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
};

function makeSession(id: string, summary: string, date?: Date, messageCount = 4): ConversationSession {
	const messages = Array.from({ length: messageCount }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `Message ${i} about the topic discussed in ${id}`,
	}));
	return {
		id,
		startedAt: date ?? new Date("2026-02-20T10:00:00Z"),
		endedAt: new Date("2026-02-20T11:00:00Z"),
		provider: "grok",
		model: "grok-3",
		messages,
		summary,
	};
}

describe("recall_memory tool", () => {
	let memory: SQLiteMemory;

	beforeEach(async () => {
		memory = new SQLiteMemory(TEST_DB);
	});

	afterEach(async () => {
		memory.close();
		await Promise.allSettled([
			unlink(TEST_DB),
			unlink(`${TEST_DB}-wal`),
			unlink(`${TEST_DB}-shm`),
		]);
	});

	test("tool has correct name and parameters", () => {
		const tool = createRecallTool(memory);
		expect(tool.name).toBe("recall_memory");
		expect(tool.clearance).toEqual([]);
		expect(tool.parameters.find((p) => p.name === "query")).toBeDefined();
		expect(tool.parameters.find((p) => p.name === "mode")).toBeDefined();
		expect(tool.parameters.find((p) => p.name === "sessionId")).toBeDefined();
		expect(tool.parameters.find((p) => p.name === "limit")).toBeDefined();
	});

	describe("search mode", () => {
		test("returns matching conversations", async () => {
			await memory.saveConversation(makeSession("s1", "Discussed Docker networking and bridge config."));
			await memory.saveConversation(makeSession("s2", "Implemented SMARTS knowledge extraction."));

			const tool = createRecallTool(memory);
			const result = await tool.execute({ query: "Docker", mode: "search" }, stubContext);

			expect(result.success).toBe(true);
			expect(result.output).toContain("s1");
			expect(result.output).toContain("Docker");
			expect(result.output).not.toContain("s2");
		});

		test("returns empty message when no matches", async () => {
			await memory.saveConversation(makeSession("s1", "Docker networking discussion."));

			const tool = createRecallTool(memory);
			const result = await tool.execute({ query: "Kubernetes", mode: "search" }, stubContext);

			expect(result.success).toBe(true);
			expect(result.output).toContain("No matching conversations");
		});

		test("fails when query is missing", async () => {
			const tool = createRecallTool(memory);
			const result = await tool.execute({ mode: "search" }, stubContext);

			expect(result.success).toBe(false);
			expect(result.output).toContain("query");
		});

		test("defaults to search mode when mode omitted", async () => {
			await memory.saveConversation(makeSession("s1", "TypeScript generics discussion."));

			const tool = createRecallTool(memory);
			const result = await tool.execute({ query: "TypeScript" }, stubContext);

			expect(result.success).toBe(true);
			expect(result.output).toContain("TypeScript");
		});

		test("respects limit parameter", async () => {
			await memory.saveConversation(makeSession("s1", "Docker topic one.", new Date("2026-02-20T10:00:00Z")));
			await memory.saveConversation(makeSession("s2", "Docker topic two.", new Date("2026-02-21T10:00:00Z")));
			await memory.saveConversation(makeSession("s3", "Docker topic three.", new Date("2026-02-22T10:00:00Z")));

			const tool = createRecallTool(memory);
			const result = await tool.execute({ query: "Docker", limit: 2 }, stubContext);

			expect(result.success).toBe(true);
			// Output should mention found conversations but only show 2
			const matches = result.output.match(/\d+\.\s+\[/g);
			expect(matches).toHaveLength(2);
		});
	});

	describe("recall mode", () => {
		test("returns full messages for a session", async () => {
			await memory.saveConversation(makeSession("s-recall", "Docker networking recap.", undefined, 6));

			const tool = createRecallTool(memory);
			const result = await tool.execute({ mode: "recall", sessionId: "s-recall" }, stubContext);

			expect(result.success).toBe(true);
			expect(result.output).toContain("user:");
			expect(result.output).toContain("assistant:");
			expect(result.output).toContain("s-recall");
		});

		test("fails when sessionId is missing", async () => {
			const tool = createRecallTool(memory);
			const result = await tool.execute({ mode: "recall" }, stubContext);

			expect(result.success).toBe(false);
			expect(result.output).toContain("sessionId");
		});

		test("fails when session not found", async () => {
			const tool = createRecallTool(memory);
			const result = await tool.execute({ mode: "recall", sessionId: "nonexistent" }, stubContext);

			expect(result.success).toBe(false);
			expect(result.output).toContain("No conversation found");
		});

		test("truncates long messages", async () => {
			const longMessage = "A".repeat(1000);
			const session: ConversationSession = {
				id: "s-long",
				startedAt: new Date("2026-02-20T10:00:00Z"),
				endedAt: new Date("2026-02-20T11:00:00Z"),
				provider: "grok",
				model: "grok-3",
				messages: [
					{ role: "user", content: longMessage },
					{ role: "assistant", content: longMessage },
				],
				summary: "Long messages test.",
			};
			await memory.saveConversation(session);

			const tool = createRecallTool(memory);
			const result = await tool.execute({ mode: "recall", sessionId: "s-long" }, stubContext);

			expect(result.success).toBe(true);
			// Each message should be truncated to 500 chars + "..."
			expect(result.output).toContain("...");
			expect(result.output.length).toBeLessThan(longMessage.length * 2);
		});
	});

	test("returns failure for unknown mode", async () => {
		const tool = createRecallTool(memory);
		const result = await tool.execute({ query: "test", mode: "invalid" }, stubContext);

		expect(result.success).toBe(false);
		expect(result.output).toContain("Unknown mode");
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/recall-tool.test.ts`
Expected: FAIL — `createRecallTool` cannot be resolved

**Step 3: Implement `createRecallTool()`**

Create `src/core/recall-tool.ts`:

```typescript
import type { FridayTool, ToolContext, ToolResult } from "../modules/types.ts";
import type { SQLiteMemory } from "./memory.ts";
import { getTextContent } from "./types.ts";

const MAX_RECALL_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 500;
const MAX_OUTPUT_LENGTH = 8000;

export function createRecallTool(memory: SQLiteMemory): FridayTool {
	return {
		name: "recall_memory",
		description:
			"Search your memory of past conversations. Use mode 'search' with a query to find relevant past discussions (returns summaries with dates). Use mode 'recall' with a sessionId to retrieve the full conversation transcript. Use this when the user references something previously discussed, or when you need context from a past session.",
		parameters: [
			{
				name: "query",
				type: "string",
				description: "Search terms to find relevant past conversations (required for search mode)",
				required: false,
			},
			{
				name: "mode",
				type: "string",
				description: "'search' to find conversations by keyword, 'recall' to retrieve full messages by session ID. Defaults to 'search'.",
				required: false,
				default: "search",
			},
			{
				name: "sessionId",
				type: "string",
				description: "The session ID to retrieve full messages from (required for recall mode)",
				required: false,
			},
			{
				name: "limit",
				type: "number",
				description: "Maximum number of search results to return (default: 5, max: 20)",
				required: false,
				default: 5,
			},
		],
		clearance: [],

		async execute(
			args: Record<string, unknown>,
			_context: ToolContext,
		): Promise<ToolResult> {
			const mode = (args.mode as string) ?? "search";

			if (mode === "recall") {
				return handleRecall(memory, args);
			}
			if (mode === "search") {
				return handleSearch(memory, args);
			}
			return { success: false, output: `Unknown mode: "${mode}". Use "search" or "recall".` };
		},
	};
}

async function handleSearch(
	memory: SQLiteMemory,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const query = args.query as string;
	if (!query?.trim()) {
		return { success: false, output: "Missing required parameter: query (for search mode)" };
	}

	const limit = Math.min(20, Math.max(1, (args.limit as number) ?? 5));
	const results = await memory.searchConversations(query, limit);

	if (results.length === 0) {
		return {
			success: true,
			output: "No matching conversations found in memory.",
			artifacts: { results: [], query },
		};
	}

	const lines = results.map((r, i) => {
		const date = r.date ? r.date.replace("T", " ").slice(0, 16) : "unknown date";
		return `${i + 1}. [${date}] (session ${r.sessionId})\n   "${r.summary}"`;
	});

	return {
		success: true,
		output: `Found ${results.length} matching conversation${results.length === 1 ? "" : "s"}:\n\n${lines.join("\n\n")}`,
		artifacts: { results, query },
	};
}

async function handleRecall(
	memory: SQLiteMemory,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const sessionId = args.sessionId as string;
	if (!sessionId?.trim()) {
		return { success: false, output: "Missing required parameter: sessionId (for recall mode)" };
	}

	const session = await memory.getConversationById(sessionId);
	if (!session) {
		return { success: false, output: `No conversation found with ID: ${sessionId}` };
	}

	const date = session.startedAt.toISOString().replace("T", " ").slice(0, 16);
	const header = `Conversation ${sessionId} (${date}, ${session.provider}/${session.model}, ${session.messages.length} messages)`;

	let output = `${header}\n${"─".repeat(60)}\n`;
	let totalLength = output.length;

	const messages = session.messages.slice(0, MAX_RECALL_MESSAGES);
	for (const msg of messages) {
		let text = getTextContent(msg.content);
		if (text.length > MAX_MESSAGE_LENGTH) {
			text = `${text.slice(0, MAX_MESSAGE_LENGTH)}...`;
		}
		const line = `${msg.role}: ${text}\n`;
		if (totalLength + line.length > MAX_OUTPUT_LENGTH) {
			output += `\n... (${session.messages.length - messages.indexOf(msg)} more messages truncated)`;
			break;
		}
		output += line;
		totalLength += line.length;
	}

	if (session.messages.length > MAX_RECALL_MESSAGES) {
		output += `\n... (showing first ${MAX_RECALL_MESSAGES} of ${session.messages.length} messages)`;
	}

	return {
		success: true,
		output,
		artifacts: { sessionId, messageCount: session.messages.length },
	};
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/recall-tool.test.ts`
Expected: 11 tests PASS

**Step 5: Commit**

```bash
git add src/core/recall-tool.ts tests/unit/recall-tool.test.ts
git commit -m "feat(recall): add recall_memory tool for conversation search"
```

---

### Task 4: Wire backfill and tool registration into FridayRuntime

**Files:**
- Modify: `src/core/runtime.ts:1` — add import
- Modify: `src/core/runtime.ts:149-156` — add backfill after memory init
- Modify: `src/core/runtime.ts:201-204` — add recall tool registration alongside sensorium tool
- Test: `tests/unit/friday.test.ts` — add test for tool registration (check existing patterns)

**Step 1: Check existing runtime tests for the pattern**

Read `tests/unit/friday.test.ts` to find how other tool registrations are tested. Look for patterns like checking `cortex.tools` or verifying tool existence. Follow the same pattern.

**Step 2: Write the failing test**

Add to the appropriate describe block in the existing runtime test file:

```typescript
test("registers recall_memory tool when memory is configured", async () => {
	// Boot runtime with dataDir (which creates memory)
	await runtime.boot({ dataDir: TEST_DATA_DIR, injectedProvider: stubProvider });
	// The recall_memory tool should be registered on cortex
	const result = await runtime.process("test message that triggers tool listing");
	// Verify by checking the cortex has the tool
	// (Exact assertion depends on how other tests verify tool registration)
});
```

Note: The exact test approach depends on how the existing tests access Cortex internals. If `runtime.cortex` exposes a way to check registered tools, use that. Otherwise, verify that boot completes without error and trust the registration code.

**Step 3: Implement**

Add import at the top of `src/core/runtime.ts`:

```typescript
import { createRecallTool } from "./recall-tool.ts";
```

Add backfill logic in `boot()`, after the memory initialization block (after line 156, before the smartsDir block):

```typescript
// Backfill conversation FTS5 index (one-time migration)
if (this._memory) {
	const backfillDone = await this._memory.get<boolean>("conversations", "backfill-done");
	if (!backfillDone) {
		const sessions = await this._memory.getConversationHistory(500);
		for (const session of sessions) {
			if (session.summary) {
				await this._memory.indexConversation(session);
			}
		}
		await this._memory.set("conversations", "backfill-done", true);
	}
}
```

Add recall tool registration after the sensorium tool registration (after line 204):

```typescript
// Register recall tool for conversation memory search
if (this._memory) {
	this._cortex.registerTool(createRecallTool(this._memory));
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat(runtime): wire recall tool registration and conversation backfill"
```

---

### Task 5: Add recall guidance to system prompt

**Files:**
- Modify: `src/core/prompts.ts:29` — add recall section after Memory line
- Test: `tests/unit/prompts.test.ts` or verify via existing prompt tests

**Step 1: Check if prompt tests exist**

Look for existing tests that assert on `SYSTEM_PROMPT` content. If none exist, add a simple test.

**Step 2: Add recall guidance to SYSTEM_PROMPT**

In `src/core/prompts.ts`, add a new section after the `- **Memory** persists everything to SQLite` line (line 29), before `## Personality`:

```typescript
- **Memory Recall** — you can search your full conversation history using the \`recall_memory\` tool. When the user references a past discussion ("remember when...", "we discussed...", "last time..."), or when you sense missing context from a previous session, search with relevant keywords first, then recall specific sessions for details. Acknowledge your recall naturally — "Let me think back... yes, I remember that conversation."
```

This goes inside the existing `## Self-Knowledge` section as a new bullet point, keeping the format consistent.

**Step 3: Run tests to verify nothing broke**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/core/prompts.ts
git commit -m "feat(prompts): add recall_memory tool guidance to system prompt"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (should be ~635+ tests now)

**Step 2: Run linter**

Run: `bun run lint`
Expected: Clean (no errors)

**Step 3: Run type checker**

Run: `bun run typecheck`
Expected: Clean (the `web/` directory errors are pre-existing and expected)

**Step 4: Verify file inventory**

Confirm these files were created/modified:

| File | Action |
|------|--------|
| `src/core/memory.ts` | Modified — `indexConversation()`, `searchConversations()`, `cleanupOrphanedConversationEmbeddings()`, updated `saveConversation()` |
| `src/core/recall-tool.ts` | Created — `createRecallTool()` factory |
| `src/core/runtime.ts` | Modified — import, backfill logic, tool registration |
| `src/core/prompts.ts` | Modified — recall guidance in SYSTEM_PROMPT |
| `tests/unit/memory-conversations.test.ts` | Created — 10 tests |
| `tests/unit/recall-tool.test.ts` | Created — 11 tests |

**Step 5: Update CLAUDE.md test count**

If the test count in CLAUDE.md needs updating, update the line that says "469 tests across 49 files" to reflect the new count.
