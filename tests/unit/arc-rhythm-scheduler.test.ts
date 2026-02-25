// tests/unit/arc-rhythm-scheduler.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RhythmScheduler } from "../../src/arc-rhythm/scheduler.ts";
import { RhythmStore } from "../../src/arc-rhythm/store.ts";
import { RhythmExecutor } from "../../src/arc-rhythm/executor.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { ProtocolRegistry } from "../../src/protocols/registry.ts";
import { stubProvider } from "../helpers/stubs.ts";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-arc-scheduler.db";

let db: Database;
let store: RhythmStore;
let executor: RhythmExecutor;
let scheduler: RhythmScheduler;
let signals: SignalBus;
let notifications: NotificationManager;
let audit: AuditLogger;

beforeEach(() => {
	db = new Database(TEST_DB, { create: true });
	db.run("PRAGMA journal_mode=WAL;");
	store = new RhythmStore(db);

	signals = new SignalBus();
	notifications = new NotificationManager();
	audit = new AuditLogger();

	const clearance = new ClearanceManager(["system", "read-fs", "network", "provider"]);
	const cortex = new Cortex({ injectedProvider: stubProvider });
	const protocols = new ProtocolRegistry();
	executor = new RhythmExecutor({ cortex, protocols, clearance, audit });

	scheduler = new RhythmScheduler({
		store,
		executor,
		signals,
		notifications,
		audit,
		tickInterval: 100,
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

describe("RhythmScheduler", () => {
	test("start and stop manage running state", () => {
		scheduler.start();
		expect(scheduler.isRunning).toBe(true);
		scheduler.stop();
		expect(scheduler.isRunning).toBe(false);
	});

	test("tick executes due rhythms", async () => {
		const pastDate = new Date(Date.now() - 60_000);
		store.create({
			name: "Due",
			description: "",
			cron: "* * * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "hello" },
			nextRun: pastDate,
			clearance: [],
		});

		await scheduler.tick();

		const rhythms = store.list();
		expect(rhythms[0]!.runCount).toBe(1);
		expect(rhythms[0]!.lastResult).toBe("success");
	});

	test("tick skips non-due rhythms", async () => {
		const futureDate = new Date(Date.now() + 3_600_000);
		store.create({
			name: "NotDue",
			description: "",
			cron: "0 0 * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "hello" },
			nextRun: futureDate,
			clearance: [],
		});

		await scheduler.tick();

		const rhythms = store.list();
		expect(rhythms[0]!.runCount).toBe(0);
	});

	test("tick skips disabled rhythms", async () => {
		const pastDate = new Date(Date.now() - 60_000);
		store.create({
			name: "Disabled",
			description: "",
			cron: "* * * * *",
			enabled: false,
			origin: "user",
			action: { type: "prompt", prompt: "hello" },
			nextRun: pastDate,
			clearance: [],
		});

		await scheduler.tick();

		const rhythms = store.list();
		expect(rhythms[0]!.runCount).toBe(0);
	});

	test("tick emits success signal", async () => {
		const emitted: string[] = [];
		signals.on("custom:arc-rhythm-executed", (sig) => {
			emitted.push(sig.name);
		});

		const pastDate = new Date(Date.now() - 60_000);
		store.create({
			name: "A",
			description: "",
			cron: "* * * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "hello" },
			nextRun: pastDate,
			clearance: [],
		});

		await scheduler.tick();
		expect(emitted).toContain("custom:arc-rhythm-executed");
	});

	test("tick emits failure signal on error", async () => {
		const emitted: string[] = [];
		signals.on("custom:arc-rhythm-failed", (sig) => {
			emitted.push(sig.name);
		});

		const pastDate = new Date(Date.now() - 60_000);
		store.create({
			name: "Fail",
			description: "",
			cron: "* * * * *",
			enabled: true,
			origin: "user",
			action: { type: "tool", tool: "nonexistent" },
			nextRun: pastDate,
			clearance: [],
		});

		await scheduler.tick();
		expect(emitted).toContain("custom:arc-rhythm-failed");
	});

	test("auto-pauses after MAX_CONSECUTIVE_FAILURES", async () => {
		const emitted: string[] = [];
		signals.on("custom:arc-rhythm-paused", (sig) => {
			emitted.push(sig.name);
		});

		const rhythm = store.create({
			name: "Fragile",
			description: "",
			cron: "* * * * *",
			enabled: true,
			origin: "user",
			action: { type: "tool", tool: "nonexistent" },
			nextRun: new Date(Date.now() - 60_000),
			clearance: [],
		});

		for (let i = 0; i < 5; i++) {
			// Re-enable and set nextRun to past for each tick
			db.query("UPDATE rhythms SET enabled = 1, next_run = ? WHERE id = ?").run(
				new Date(Date.now() - 60_000).toISOString(),
				rhythm.id,
			);
			await scheduler.tick();
		}

		const updated = store.get(rhythm.id)!;
		expect(updated.enabled).toBe(false);
		expect(emitted).toContain("custom:arc-rhythm-paused");
	});

	test("computes next occurrence relative to rhythm's original nextRun, not wall clock", async () => {
		const rhythm = store.create({
			name: "test",
			description: "test",
			cron: "*/5 * * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "test" },
			nextRun: new Date("2026-01-01T00:05:00Z"),
			clearance: [],
		});

		await scheduler.tick();

		const updated = store.get(rhythm.id);
		expect(updated!.nextRun.getUTCMinutes()).toBe(10);
	});

	test("reentrant guard skips rhythm that is already running", async () => {
		const clearance = new ClearanceManager(["system", "provider"]);
		const slowCortex = new Cortex({
			injectedProvider: {
				...stubProvider,
				chat: async () => {
					await new Promise((r) => setTimeout(r, 200));
					return { type: "text" as const, text: "done" };
				},
			},
		});
		const slowExecutor = new RhythmExecutor({
			cortex: slowCortex,
			protocols: new ProtocolRegistry(),
			clearance,
			audit,
		});
		const slowScheduler = new RhythmScheduler({
			store, executor: slowExecutor, signals, notifications, audit, tickInterval: 100,
		});

		const pastDate = new Date(Date.now() - 60_000);
		store.create({
			name: "Slow",
			description: "",
			cron: "* * * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "slow" },
			nextRun: pastDate,
			clearance: [],
		});

		const tickPromise = slowScheduler.tick();
		await slowScheduler.tick();
		await tickPromise;

		const rhythms = store.list();
		expect(rhythms[0]!.runCount).toBe(1);

		await slowScheduler.stop();
	});
});
