import {
	cpus,
	totalmem,
	freemem,
	loadavg,
	uptime,
	platform,
	arch,
	hostname,
	version,
	platform as osPlatform,
} from "node:os";
import type {
	MachineSnapshot,
	ContainerSnapshot,
	DevSnapshot,
} from "./types.ts";

export interface CpuTimes {
	idle: number;
	total: number;
}

export function getCpuTimes(): CpuTimes {
	const cores = cpus();
	let idle = 0;
	let total = 0;
	for (const core of cores) {
		idle += core.times.idle;
		total +=
			core.times.user +
			core.times.nice +
			core.times.sys +
			core.times.irq +
			core.times.idle;
	}
	return { idle, total };
}

export async function gatherMachine(
	prevCpuTimes?: CpuTimes,
): Promise<MachineSnapshot & { cpuTimes: CpuTimes }> {
	try {
		const cores = cpus();
		const currentTimes = getCpuTimes();

		let usage = 0;
		if (prevCpuTimes) {
			const idleDelta = currentTimes.idle - prevCpuTimes.idle;
			const totalDelta = currentTimes.total - prevCpuTimes.total;
			if (totalDelta > 0) {
				usage = Math.round((1 - idleDelta / totalDelta) * 100);
			}
		}

		const total = totalmem();
		const free = freemem();
		const load = loadavg() as [number, number, number];

		return {
			platform: platform(),
			arch: arch(),
			hostname: hostname(),
			osVersion: version(),
			uptime: uptime(),
			cpus: {
				count: cores.length,
				model: cores[0]?.model ?? "unknown",
				usage,
			},
			memory: { total, used: total - free, free },
			loadAvg: load,
			cpuTimes: currentTimes,
		};
	} catch {
		const currentTimes = { idle: 0, total: 0 };
		return {
			platform: "unknown",
			arch: "unknown",
			hostname: "unknown",
			osVersion: "unknown",
			uptime: 0,
			cpus: { count: 0, model: "unknown", usage: 0 },
			memory: { total: 0, used: 0, free: 0 },
			loadAvg: [0, 0, 0],
			cpuTimes: currentTimes,
		};
	}
}
