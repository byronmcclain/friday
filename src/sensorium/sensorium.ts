import type { SignalBus } from "../core/events.ts";
import type { NotificationManager } from "../core/notifications.ts";
import type { SystemSnapshot, SensorConfig } from "./types.ts";
import { AlertState } from "./types.ts";
import {
	gatherMachine,
	gatherContainers,
	gatherDev,
	type CpuTimes,
} from "./sensors.ts";
import { formatBytes } from "./format.ts";

/**
 * Formats the current date/time as a compact string with both local and UTC.
 * e.g. "Sun Feb 23 2026 3:45 PM CST (21:45 UTC)"
 */
export function formatDateTime(now = new Date()): string {
	const local = now.toLocaleString("en-US", {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	});
	const utcTime = now.toLocaleString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: false,
		timeZone: "UTC",
	});
	return `${local} (${utcTime} UTC)`;
}

export interface SensoriumOptions {
	config: SensorConfig;
	signals: SignalBus;
	notifications: NotificationManager;
}

export class Sensorium {
	private config: SensorConfig;
	private signals: SignalBus;
	private notifications: NotificationManager;
	private _snapshot: SystemSnapshot | null = null;
	private _prevCpuTimes?: CpuTimes;
	private _fastTimer?: ReturnType<typeof setInterval>;
	private _slowTimer?: ReturnType<typeof setInterval>;
	private _running = false;
	private _pollingFast = false;
	private _pollingSlow = false;

	// Hysteresis state
	private _alertStates = {
		cpu: AlertState.Normal,
		memory: AlertState.Normal,
		disk: AlertState.Normal,
		containers: new Set<string>(),
	};
	private _cpuHighCount = 0;

	constructor(options: SensoriumOptions) {
		this.config = options.config;
		this.signals = options.signals;
		this.notifications = options.notifications;
	}

	get currentSnapshot(): SystemSnapshot | null {
		return this._snapshot;
	}

	get isRunning(): boolean {
		return this._running;
	}

	async poll(): Promise<void> {
		if (this._pollingSlow) return;
		this._pollingSlow = true;
		try {
			const machineResult = await gatherMachine(this._prevCpuTimes);
			this._prevCpuTimes = machineResult.cpuTimes;

			const { cpuTimes: _, ...machine } = machineResult;

			const [containers, dev] = await Promise.all([
				gatherContainers(),
				gatherDev(),
			]);

			this._snapshot = {
				timestamp: new Date(),
				machine,
				containers,
				dev,
			};

			this.evaluateAlerts(this._snapshot);
		} finally {
			this._pollingSlow = false;
		}
	}

	async pollFast(): Promise<void> {
		if (this._pollingFast) return;
		this._pollingFast = true;
		try {
			if (!this._snapshot) {
				const machineResult = await gatherMachine(this._prevCpuTimes);
				this._prevCpuTimes = machineResult.cpuTimes;
				const { cpuTimes: _, ...machine } = machineResult;
				const [containers, dev] = await Promise.all([gatherContainers(), gatherDev()]);
				this._snapshot = { timestamp: new Date(), machine, containers, dev };
				this.evaluateAlerts(this._snapshot);
				return;
			}

			const machineResult = await gatherMachine(this._prevCpuTimes);
			this._prevCpuTimes = machineResult.cpuTimes;

			const { cpuTimes: _, ...machine } = machineResult;

			this._snapshot = {
				...this._snapshot,
				timestamp: new Date(),
				machine,
			};

			this.evaluateAlerts(this._snapshot);
		} finally {
			this._pollingFast = false;
		}
	}

	start(): void {
		if (this._running) return;
		this._running = true;
		if (!this._snapshot) {
			void this.poll();
		}
		this._fastTimer = setInterval(
			() => this.pollFast(),
			this.config.fastPollInterval,
		);
		this._slowTimer = setInterval(
			() => this.poll(),
			this.config.slowPollInterval,
		);
	}

	stop(): void {
		if (this._fastTimer) clearInterval(this._fastTimer);
		if (this._slowTimer) clearInterval(this._slowTimer);
		this._fastTimer = undefined;
		this._slowTimer = undefined;
		this._running = false;
	}

	evaluateAlerts(snapshot: SystemSnapshot): void {
		const { thresholds } = this.config;
		const memPercent =
			snapshot.machine.memory.total > 0
				? (snapshot.machine.memory.used / snapshot.machine.memory.total) * 100
				: 0;

		// Memory alerts
		if (memPercent >= thresholds.memoryCritical) {
			if (this._alertStates.memory !== AlertState.Critical) {
				this._alertStates.memory = AlertState.Critical;
				this.signals.emit("custom:env-memory-critical", "sensorium", {
					usage: memPercent,
				});
				this.notifications.notify({
					level: "alert",
					title: "Memory Critical",
					body: `Memory usage at ${memPercent.toFixed(0)}% (${formatBytes(snapshot.machine.memory.used)}/${formatBytes(snapshot.machine.memory.total)})`,
					source: "sensorium",
				});
			}
		} else if (memPercent >= thresholds.memoryHigh) {
			if (this._alertStates.memory !== AlertState.High) {
				this._alertStates.memory = AlertState.High;
				this.signals.emit("custom:env-memory-high", "sensorium", {
					usage: memPercent,
				});
				this.notifications.notify({
					level: "warning",
					title: "Memory High",
					body: `Memory usage at ${memPercent.toFixed(0)}% (${formatBytes(snapshot.machine.memory.used)}/${formatBytes(snapshot.machine.memory.total)})`,
					source: "sensorium",
				});
			}
		} else if (this._alertStates.memory !== AlertState.Normal) {
			this._alertStates.memory = AlertState.Normal;
		}

		// CPU alerts (requires 2 consecutive high readings)
		if (snapshot.machine.cpus.usage >= thresholds.cpuHigh) {
			this._cpuHighCount++;
			if (
				this._cpuHighCount >= 2 &&
				this._alertStates.cpu !== AlertState.High
			) {
				this._alertStates.cpu = AlertState.High;
				this.signals.emit("custom:env-cpu-high", "sensorium", {
					usage: snapshot.machine.cpus.usage,
				});
				this.notifications.notify({
					level: "warning",
					title: "CPU High",
					body: `CPU usage at ${snapshot.machine.cpus.usage}% (sustained)`,
					source: "sensorium",
				});
			}
		} else {
			this._cpuHighCount = 0;
			if (this._alertStates.cpu !== AlertState.Normal) {
				this._alertStates.cpu = AlertState.Normal;
			}
		}

		// Container down alerts
		if (thresholds.watchContainers.length > 0) {
			const runningNames = new Set(
				snapshot.containers.running.map((c) => c.name),
			);
			for (const name of thresholds.watchContainers) {
				if (
					!runningNames.has(name) &&
					!this._alertStates.containers.has(name)
				) {
					this._alertStates.containers.add(name);
					this.signals.emit("custom:env-container-down", "sensorium", {
						container: name,
					});
					this.notifications.notify({
						level: "alert",
						title: "Container Down",
						body: `Watched container "${name}" is not running`,
						source: "sensorium",
					});
				} else if (
					runningNames.has(name) &&
					this._alertStates.containers.has(name)
				) {
					this._alertStates.containers.delete(name);
				}
			}
		}
	}

	getContextBlock(): string {
		if (!this._snapshot) return "";
		const s = this._snapshot;
		const memUsed = formatBytes(s.machine.memory.used);
		const memTotal = formatBytes(s.machine.memory.total);
		const memPercent =
			s.machine.memory.total > 0
				? Math.round(
						(s.machine.memory.used / s.machine.memory.total) * 100,
					)
				: 0;

		const parts: string[] = [
			formatDateTime(),
			`${s.machine.osVersion} ${s.machine.arch}`,
			`${s.machine.cpus.count} cores @ ${s.machine.cpus.usage}%`,
			`${memUsed}/${memTotal} RAM (${memPercent}%)`,
		];

		if (s.containers.runtime !== "none" && s.containers.running.length > 0) {
			const names = s.containers.running.map((c) => c.name).join(", ");
			parts.push(
				`Docker: ${s.containers.running.length} running (${names})`,
			);
		}

		if (s.dev.git) {
			const dirtyFlag = s.dev.git.dirty ? ", dirty" : ", clean";
			parts.push(`Git: ${s.dev.git.repo}@${s.dev.git.branch}${dirtyFlag}`);
		}

		if (s.dev.ports.length > 0) {
			const portList = s.dev.ports.map((p) => p.port).join(", ");
			parts.push(`Ports: ${portList}`);
		}

		return `[ENVIRONMENT] ${parts.join(" | ")}`;
	}
}

