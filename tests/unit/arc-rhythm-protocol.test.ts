// tests/unit/arc-rhythm-protocol.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createArcProtocol } from "../../src/arc-rhythm/protocol.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { RhythmScheduler } from "../../src/arc-rhythm/scheduler.ts";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-protocol.db";

let db: Database;
let store: RhythmStore;
let scheduler: RhythmScheduler;

const stubContext: ProtocolContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as unknown as ProtocolContext["audit"],
	signal: { emit: async () => {} } as unknown as ProtocolContext["signal"],
	memory: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
	tools: new Map(),
};

beforeEach(() => {
	db = new Database(TEST_DB, { create: true });
	db.run("PRAGMA journal_mode=WAL;");
	store = new RhythmStore(db);

	const clearance = new ClearanceManager(["system", "provider"]);
	const cortex = new Cortex({ injectedModel: createMockModel() });
	const protocols = new ProtocolRegistry();
	const executor = new RhythmExecutor({ cortex, protocols, clearance, audit: new AuditLogger() });

	scheduler = new RhythmScheduler({
		store, executor,
		signals: new SignalBus(),
		notifications: new NotificationManager(),
		audit: new AuditLogger(),
	});
});

afterEach(async () => {
	await scheduler.stop();
	db.close();
	await Promise.allSettled([
		unlink(TEST_DB),
		unlink(`${TEST_DB}-wal`),
		unlink(`${TEST_DB}-shm`),
	]);
});

describe("/arc protocol", () => {
	test("has correct name and aliases", () => {
		const proto = createArcProtocol(store, scheduler);
		expect(proto.name).toBe("arc");
		expect(proto.aliases).toContain("rhythm");
	});

	test("list shows 'No rhythms' when empty", async () => {
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: "list" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("No rhythms");
	});

	test("list shows created rhythms", async () => {
		store.create({ name: "Morning", description: "check", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "hi" }, nextRun: new Date(), clearance: [] });
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: "list" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Morning");
	});

	test("show returns rhythm details", async () => {
		const rhythm = store.create({ name: "Morning", description: "check PRs", cron: "0 9 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "hi" }, nextRun: new Date(), clearance: [] });
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: `show ${rhythm.id}` }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Morning");
		expect(result.summary).toContain("0 9 * * *");
	});

	test("show returns error for missing id", async () => {
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: "show nonexistent" }, stubContext);
		expect(result.success).toBe(false);
	});

	test("create makes a new rhythm", async () => {
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute(
			{ rawArgs: 'create "0 9 * * *" Check stale PRs' },
			stubContext,
		);
		expect(result.success).toBe(true);
		expect(store.list().length).toBe(1);
		expect(store.list()[0]!.cron).toBe("0 9 * * *");
	});

	test("create rejects invalid cron", async () => {
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute(
			{ rawArgs: 'create "invalid" Do something' },
			stubContext,
		);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Invalid");
	});

	test("pause disables a rhythm", async () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const proto = createArcProtocol(store, scheduler);
		await proto.execute({ rawArgs: `pause ${rhythm.id}` }, stubContext);
		expect(store.get(rhythm.id)!.enabled).toBe(false);
	});

	test("resume enables a rhythm", async () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: false, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const proto = createArcProtocol(store, scheduler);
		await proto.execute({ rawArgs: `resume ${rhythm.id}` }, stubContext);
		expect(store.get(rhythm.id)!.enabled).toBe(true);
	});

	test("delete removes a rhythm", async () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		const proto = createArcProtocol(store, scheduler);
		await proto.execute({ rawArgs: `delete ${rhythm.id}` }, stubContext);
		expect(store.get(rhythm.id)).toBeUndefined();
	});

	test("history shows execution log", async () => {
		const rhythm = store.create({ name: "A", description: "", cron: "0 0 * * *", enabled: true, origin: "user", action: { type: "prompt", prompt: "a" }, nextRun: new Date(), clearance: [] });
		store.logExecution({ rhythmId: rhythm.id, startedAt: new Date(), status: "success" });
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: "history" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("success");
	});

	test("unknown subcommand returns error", async () => {
		const proto = createArcProtocol(store, scheduler);
		const result = await proto.execute({ rawArgs: "bogus" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown");
	});
});
