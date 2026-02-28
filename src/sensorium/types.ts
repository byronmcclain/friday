export interface CpuSnapshot {
	count: number;
	model: string;
	usage: number; // 0-100%
}

export interface MemorySnapshot {
	total: number; // bytes
	used: number;
	free: number;
}

export interface MachineSnapshot {
	platform: string;
	arch: string;
	hostname: string;
	osVersion: string;
	uptime: number; // seconds
	cpus: CpuSnapshot;
	memory: MemorySnapshot;
	loadAvg: [number, number, number];
}

export interface ContainerInfo {
	id: string;
	name: string;
	image: string;
	cpu: number;
	memory: number;
	status: string;
}

export interface ContainerSnapshot {
	runtime: "docker" | "podman" | "none";
	running: ContainerInfo[];
	stopped: number;
}

export interface GitStatus {
	repo: string;
	branch: string;
	dirty: boolean;
	ahead: number;
	behind: number;
}

export interface PortInfo {
	port: number;
	pid: number;
	process: string;
}

export interface RuntimeInfo {
	name: string;
	version: string;
}

export interface DevSnapshot {
	git?: GitStatus;
	ports: PortInfo[];
	runtimes: RuntimeInfo[];
}

export interface SystemSnapshot {
	timestamp: Date;
	machine: MachineSnapshot;
	containers: ContainerSnapshot;
	dev: DevSnapshot;
}

export interface AlertThresholds {
	cpuHigh: number;
	memoryHigh: number;
	memoryCritical: number;
	watchContainers: string[];
}

export interface SensorConfig {
	fastPollInterval: number;
	slowPollInterval: number;
	thresholds: AlertThresholds;
}

export enum AlertState {
	Normal = "normal",
	High = "high",
	Critical = "critical",
}

export const SENSORIUM_DEFAULTS: SensorConfig = {
	fastPollInterval: 30_000,
	slowPollInterval: 300_000,
	thresholds: {
		cpuHigh: 85,
		memoryHigh: 80,
		memoryCritical: 95,
		watchContainers: [],
	},
};
