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

export async function gatherContainers(): Promise<ContainerSnapshot> {
	try {
		const check = await Bun.$`docker info 2>/dev/null`.quiet().nothrow();
		if (check.exitCode !== 0) {
			return { runtime: "none", running: [], stopped: 0 };
		}

		const psResult =
			await Bun.$`docker ps --format '{{json .}}'`.quiet().nothrow();
		const running: ContainerSnapshot["running"] = [];

		if (psResult.exitCode === 0 && psResult.stdout.length > 0) {
			const lines = psResult.stdout
				.toString()
				.trim()
				.split("\n")
				.filter(Boolean);

			const statsResult =
				await Bun.$`docker stats --no-stream --format '{{json .}}'`
					.quiet()
					.nothrow();
			const statsMap = new Map<string, { cpu: number; memory: number }>();

			if (statsResult.exitCode === 0 && statsResult.stdout.length > 0) {
				for (const line of statsResult.stdout
					.toString()
					.trim()
					.split("\n")
					.filter(Boolean)) {
					try {
						const stat = JSON.parse(line);
						statsMap.set(stat.ID || stat.Container, {
							cpu: Number.parseFloat(stat.CPUPerc) || 0,
							memory: Number.parseFloat(stat.MemPerc) || 0,
						});
					} catch {
						/* skip malformed lines */
					}
				}
			}

			for (const line of lines) {
				try {
					const c = JSON.parse(line);
					const id = c.ID ?? "";
					const stats = statsMap.get(id) ?? { cpu: 0, memory: 0 };
					running.push({
						id,
						name: c.Names ?? "",
						image: c.Image ?? "",
						cpu: stats.cpu,
						memory: stats.memory,
						status: c.Status ?? "",
					});
				} catch {
					/* skip malformed lines */
				}
			}
		}

		const stoppedResult =
			await Bun.$`docker ps -a --filter status=exited -q`.quiet().nothrow();
		const stopped =
			stoppedResult.exitCode === 0
				? stoppedResult.stdout.toString().trim().split("\n").filter(Boolean)
						.length
				: 0;

		return { runtime: "docker", running, stopped };
	} catch {
		return { runtime: "none", running: [], stopped: 0 };
	}
}
