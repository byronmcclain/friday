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
