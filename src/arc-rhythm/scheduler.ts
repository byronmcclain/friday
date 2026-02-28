import type { RhythmStore } from "./store.ts";
import type { RhythmExecutor } from "./executor.ts";
import type { SignalBus } from "../core/events.ts";
import type { NotificationManager } from "../core/notifications.ts";
import type { AuditLogger } from "../audit/logger.ts";
import { nextOccurrence } from "./cron.ts";
import { MAX_CONSECUTIVE_FAILURES, DEFAULT_TICK_INTERVAL } from "./types.ts";

export interface SchedulerConfig {
	store: RhythmStore;
	executor: RhythmExecutor;
	signals: SignalBus;
	notifications: NotificationManager;
	audit: AuditLogger;
	tickInterval?: number;
}

export class RhythmScheduler {
	private store: RhythmStore;
	private executor: RhythmExecutor;
	private signals: SignalBus;
	private notifications: NotificationManager;
	private audit: AuditLogger;
	private tickInterval: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private _running = false;
	private inflight = new Set<string>();

	constructor(config: SchedulerConfig) {
		this.store = config.store;
		this.executor = config.executor;
		this.signals = config.signals;
		this.notifications = config.notifications;
		this.audit = config.audit;
		this.tickInterval = config.tickInterval ?? DEFAULT_TICK_INTERVAL;
	}

	get isRunning(): boolean {
		return this._running;
	}

	start(): void {
		if (this._running) return;
		this._running = true;
		this.timer = setInterval(() => this.tick(), this.tickInterval);
	}

	async stop(): Promise<void> {
		this._running = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		// Wait for in-flight executions (10s timeout)
		if (this.inflight.size > 0) {
			const deadline = Date.now() + 10_000;
			while (this.inflight.size > 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
		}
	}

	async executeById(rhythmId: string): Promise<void> {
		if (this.inflight.has(rhythmId)) throw new Error("Rhythm is already running");
		await this.executeRhythm(rhythmId);
	}

	async tick(): Promise<void> {
		const now = new Date();
		const due = this.store.getDueRhythms(now);

		const promises: Promise<void>[] = [];
		for (const rhythm of due) {
			if (this.inflight.has(rhythm.id)) continue;
			promises.push(this.executeRhythm(rhythm.id));
		}

		await Promise.allSettled(promises);
	}

	private async executeRhythm(rhythmId: string): Promise<void> {
		this.inflight.add(rhythmId);

		try {
			const rhythm = this.store.get(rhythmId);
			if (!rhythm) return;

			const exec = this.store.logExecution({
				rhythmId: rhythm.id,
				startedAt: new Date(),
				status: "running",
			});

			const result = await this.executor.execute(rhythm);

			this.store.completeExecution(
				exec.id,
				result.status,
				result.result,
				result.error,
			);

			const computedNext = nextOccurrence(rhythm.cron, new Date());
			this.store.markExecuted(rhythm.id, result.status, computedNext);

			if (result.status === "success") {
				await this.signals.emit(
					"custom:arc-rhythm-executed",
					"arc-rhythm",
					{ rhythmId: rhythm.id, name: rhythm.name },
				);
			} else {
				await this.signals.emit(
					"custom:arc-rhythm-failed",
					"arc-rhythm",
					{ rhythmId: rhythm.id, name: rhythm.name, error: result.error },
				);
			}

			// Check auto-pause
			const updated = this.store.get(rhythmId);
			if (
				updated &&
				updated.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
			) {
				this.store.update(rhythmId, { enabled: false });

				await this.signals.emit(
					"custom:arc-rhythm-paused",
					"arc-rhythm",
					{ rhythmId: rhythm.id, name: rhythm.name, failures: updated.consecutiveFailures },
				);

				await this.notifications.notify({
					level: "warning",
					title: `Rhythm "${rhythm.name}" auto-paused`,
					body: `Disabled after ${updated.consecutiveFailures} consecutive failures`,
					source: "arc-rhythm",
				});
			}

			this.audit.log({
				action: `arc-rhythm:${result.status}`,
				source: "arc-rhythm",
				detail: `Rhythm "${rhythm.name}" (${rhythm.id}) ${result.status}`,
				success: result.status === "success",
			});
		} finally {
			this.inflight.delete(rhythmId);
		}
	}
}
