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
import { createMockModel, buildUsage } from "../helpers/stubs.ts";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
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
	const cortex = new Cortex({ injectedModel: createMockModel() });
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

	test("computes next occurrence relative to wall clock after execution", async () => {
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
		// Next occurrence should be in the future (relative to now, not the original nextRun)
		expect(updated!.nextRun.getTime()).toBeGreaterThan(Date.now() - 60_000);
	});

	test("reentrant guard skips rhythm that is already running", async () => {
		const clearance = new ClearanceManager(["system", "provider"]);
		const slowCortex = new Cortex({
			injectedModel: new MockLanguageModelV3({
				doGenerate: async () => {
					await new Promise((r) => setTimeout(r, 200));
					return {
						content: [{ type: "text" as const, text: "done" }],
						finishReason: { unified: "stop" as const, raw: undefined },
						usage: buildUsage(),
						warnings: [],
					};
				},
				doStream: async () => {
					await new Promise((r) => setTimeout(r, 200));
					return {
						stream: simulateReadableStream({
							chunks: [
								{ type: "text-start" as const, id: "text-0" },
								{ type: "text-delta" as const, id: "text-0", delta: "done" },
								{ type: "text-end" as const, id: "text-0" },
								{ type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: buildUsage() },
							],
							initialDelayInMs: null,
							chunkDelayInMs: null,
						}),
					};
				},
			}),
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
