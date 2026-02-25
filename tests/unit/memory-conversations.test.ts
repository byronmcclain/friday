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

	test("deleteAllConversations cleans up FTS5 embeddings", async () => {
		const session = makeSession("s1", "test summary");
		await memory.saveConversation(session);
		const results = await memory.searchConversations("test");
		expect(results.length).toBeGreaterThan(0);
		await memory.deleteAllConversations();
		const afterResults = await memory.searchConversations("test");
		expect(afterResults.length).toBe(0);
	});

	test("saveConversation cleans up orphaned embeddings on prune", async () => {
		const s1 = makeSession("will-survive", "Survivor conversation.", new Date("2026-02-22T10:00:00Z"));
		const s2 = makeSession("will-die", "Doomed conversation.", new Date("2026-01-01T10:00:00Z"));

		await memory.saveConversation(s2);
		await memory.saveConversation(s1);

		// Both should be searchable
		expect(await memory.searchConversations("Survivor")).toHaveLength(1);
		expect(await memory.searchConversations("Doomed")).toHaveLength(1);

		// After cleanup, orphaned embeddings for deleted conversations should be removed
		await memory.cleanupOrphanedConversationEmbeddings();

		// Both still exist because neither conversation was deleted
		expect(await memory.searchConversations("Survivor")).toHaveLength(1);
		expect(await memory.searchConversations("Doomed")).toHaveLength(1);
	});
});
