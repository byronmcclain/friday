// tests/unit/arc-rhythm-tool.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createManageRhythmTool } from "../../src/arc-rhythm/tool.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import type { ToolContext } from "../../src/modules/types.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-tool.db";

let db: Database;
let store: RhythmStore;

const stubContext: ToolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as unknown as ToolContext["audit"],
	signal: { emit: async () => {} } as unknown as ToolContext["signal"],
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
};

beforeEach(() => {
	db = new Database(TEST_DB, { create: true });
	db.run("PRAGMA journal_mode=WAL;");
	store = new RhythmStore(db);
});

afterEach(async () => {
	db.close();
	await Promise.allSettled([
		unlink(TEST_DB),
		unlink(`${TEST_DB}-wal`),
		unlink(`${TEST_DB}-shm`),
	]);
});

describe("manage_rhythm tool", () => {
	test("has correct name and clearance", () => {
		const tool = createManageRhythmTool(store);
		expect(tool.name).toBe("manage_rhythm");
		expect(tool.clearance).toEqual(["system"]);
	});

	test("create operation makes a new rhythm", async () => {
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({
			operation: "create",
			name: "Morning Check",
			cron: "0 9 * * *",
			action_type: "prompt",
			action_config: JSON.stringify({ prompt: "Check PRs" }),
		}, stubContext);
		expect(result.success).toBe(true);
		expect(store.list().length).toBe(1);
	});

	test("create validates cron expression", async () => {
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({
			operation: "create",
			name: "Bad",
			cron: "not-valid",
			action_type: "prompt",
			action_config: JSON.stringify({ prompt: "x" }),
		}, stubContext);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("list operation returns rhythms", async () => {
		store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({ operation: "list" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.output).toContain("A");
	});

	test("update operation modifies rhythm", async () => {
		const rhythm = store.create({ name: "Old", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({
			operation: "update",
			rhythm_id: rhythm.id,
			name: "New",
		}, stubContext);
		expect(result.success).toBe(true);
		expect(store.get(rhythm.id)!.name).toBe("New");
	});

	test("delete operation removes rhythm", async () => {
		const rhythm = store.create({ name: "Gone", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({
			operation: "delete",
			rhythm_id: rhythm.id,
		}, stubContext);
		expect(result.success).toBe(true);
		expect(store.get(rhythm.id)).toBeUndefined();
	});

	test("unknown operation returns error", async () => {
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({ operation: "bogus" }, stubContext);
		expect(result.success).toBe(false);
	});

	test("create missing required fields returns error", async () => {
		const tool = createManageRhythmTool(store);
		const result = await tool.execute({ operation: "create" }, stubContext);
		expect(result.success).toBe(false);
	});
});
