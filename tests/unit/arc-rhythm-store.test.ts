// tests/unit/arc-rhythm-store.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-rhythm.db";

let db: Database;
let store: RhythmStore;

beforeEach(() => {
	db = new Database(TEST_DB, { create: true });
	db.exec("PRAGMA journal_mode=WAL;");
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

describe("RhythmStore CRUD", () => {
	test("create() returns a rhythm with generated id", () => {
		const rhythm = store.create({
			name: "Morning Check",
			description: "Check stale PRs",
			cron: "0 9 * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "Check my repos for stale PRs" },
			nextRun: new Date("2026-02-25T09:00:00Z"),
			clearance: [],
		});
		expect(rhythm.id).toBeDefined();
		expect(rhythm.name).toBe("Morning Check");
		expect(rhythm.runCount).toBe(0);
		expect(rhythm.consecutiveFailures).toBe(0);
	});

	test("get() retrieves a created rhythm", () => {
		const created = store.create({
			name: "Test",
			description: "",
			cron: "0 0 * * *",
			enabled: true,
			origin: "friday",
			action: { type: "tool", tool: "getEnvironmentStatus" },
			nextRun: new Date("2026-02-25T00:00:00Z"),
			clearance: ["system"],
		});
		const fetched = store.get(created.id);
		expect(fetched).toBeDefined();
		expect(fetched!.name).toBe("Test");
		expect(fetched!.clearance).toEqual(["system"]);
	});

	test("get() returns undefined for missing id", () => {
		expect(store.get("nonexistent")).toBeUndefined();
	});

	test("list() returns all rhythms", () => {
		store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: false, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
		expect(store.list().length).toBe(2);
	});

	test("list() filters by enabled", () => {
		store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: false, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
		expect(store.list({ enabled: true }).length).toBe(1);
		expect(store.list({ enabled: false }).length).toBe(1);
	});

	test("list() filters by origin", () => {
		store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: true, origin: "friday", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
		expect(store.list({ origin: "user" }).length).toBe(1);
		expect(store.list({ origin: "friday" }).length).toBe(1);
	});

	test("update() modifies rhythm fields", () => {
		const created = store.create({ name: "Old", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const updated = store.update(created.id, { name: "New", enabled: false });
		expect(updated.name).toBe("New");
		expect(updated.enabled).toBe(false);
	});

	test("update() throws on missing id", () => {
		expect(() => store.update("nonexistent", { name: "X" })).toThrow();
	});

	test("remove() deletes a rhythm", () => {
		const created = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.remove(created.id);
		expect(store.get(created.id)).toBeUndefined();
	});
});

describe("RhythmStore execution tracking", () => {
	test("logExecution() creates an execution record", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const exec = store.logExecution({
			rhythmId: rhythm.id,
			startedAt: new Date(),
			status: "running",
		});
		expect(exec.id).toBeDefined();
		expect(exec.status).toBe("running");
	});

	test("completeExecution() updates status and timestamps", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const exec = store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "running" });
		store.completeExecution(exec.id, "success", "All clear");
		const history = store.getHistory(rhythm.id);
		expect(history[0]!.status).toBe("success");
		expect(history[0]!.result).toBe("All clear");
		expect(history[0]!.completedAt).toBeDefined();
	});

	test("getHistory() returns executions in reverse chronological order", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.logExecution({ rhythmId: rhythm.id, startedAt: new Date("2026-02-24T10:00:00Z"), status: "success" });
		store.logExecution({ rhythmId: rhythm.id, startedAt: new Date("2026-02-24T11:00:00Z"), status: "failure" });
		const history = store.getHistory(rhythm.id);
		expect(history.length).toBe(2);
		expect(history[0]!.startedAt.getTime()).toBeGreaterThan(history[1]!.startedAt.getTime());
	});

	test("getHistory() respects limit", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		for (let i = 0; i < 5; i++) {
			store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(Date.now() + i * 1000), status: "success" });
		}
		expect(store.getHistory(rhythm.id, 3).length).toBe(3);
	});

	test("getHistory() without rhythmId returns all executions", () => {
		const r1 = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const r2 = store.create({ name: "B", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "b" }, nextRun: new Date(), clearance: [] });
		store.logExecution({ rhythmId: r1.id, startedAt: new Date(), status: "success" });
		store.logExecution({ rhythmId: r2.id, startedAt: new Date(), status: "success" });
		expect(store.getHistory(undefined, 10).length).toBe(2);
	});
});

describe("RhythmStore scheduling state", () => {
	test("markExecuted() updates lastRun, lastResult, nextRun, and increments runCount", () => {
		const nextRun = new Date("2026-02-25T09:00:00Z");
		const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date("2026-02-24T09:00:00Z"), clearance: [] });
		store.markExecuted(rhythm.id, "success", nextRun);
		const updated = store.get(rhythm.id)!;
		expect(updated.lastResult).toBe("success");
		expect(updated.lastRun).toBeDefined();
		expect(updated.nextRun.toISOString()).toBe(nextRun.toISOString());
		expect(updated.runCount).toBe(1);
		expect(updated.consecutiveFailures).toBe(0);
	});

	test("markExecuted() with failure increments consecutiveFailures", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.markExecuted(rhythm.id, "failure", new Date());
		store.markExecuted(rhythm.id, "failure", new Date());
		const updated = store.get(rhythm.id)!;
		expect(updated.consecutiveFailures).toBe(2);
	});

	test("markExecuted() with success resets consecutiveFailures", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.markExecuted(rhythm.id, "failure", new Date());
		store.markExecuted(rhythm.id, "failure", new Date());
		store.markExecuted(rhythm.id, "success", new Date());
		expect(store.get(rhythm.id)!.consecutiveFailures).toBe(0);
	});

	test("getDueRhythms() returns enabled rhythms past nextRun", () => {
		const past = new Date("2026-02-23T00:00:00Z");
		const future = new Date("2026-02-26T00:00:00Z");
		store.create({ name: "Due", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: past, clearance: [] });
		store.create({ name: "NotDue", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "b" }, nextRun: future, clearance: [] });
		store.create({ name: "Disabled", description: "", cron: "0 0 * * *", enabled: false, origin: "user", action: { type: "prompt", prompt: "c" }, nextRun: past, clearance: [] });
		const now = new Date("2026-02-24T12:00:00Z");
		const due = store.getDueRhythms(now);
		expect(due.length).toBe(1);
		expect(due[0]!.name).toBe("Due");
	});

	test("completeExecution() prunes history beyond 100 entries per rhythm", () => {
		const rhythm = store.create({ name: "Prunable", description: "", cron: "* * * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		// Create 105 executions
		const execIds: string[] = [];
		for (let i = 0; i < 105; i++) {
			const exec = store.logExecution({
				rhythmId: rhythm.id,
				startedAt: new Date(Date.now() + i * 1000),
				status: "running",
			});
			execIds.push(exec.id);
		}
		// Complete the last execution — triggers pruning
		store.completeExecution(execIds[104]!, "success", "done");
		// Should retain only 100 entries
		const allHistory = store.getHistory(rhythm.id, 200);
		expect(allHistory.length).toBe(100);
	});

	test("remove() cascades to rhythm_executions", () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "success" });
		store.remove(rhythm.id);
		expect(store.getHistory(rhythm.id).length).toBe(0);
	});
});
