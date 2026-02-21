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

export async function gatherDev(): Promise<DevSnapshot> {
	const [git, ports, runtimes] = await Promise.all([
		gatherGit(),
		gatherPorts(),
		gatherRuntimes(),
	]);
	return { git, ports, runtimes };
}

async function gatherGit(): Promise<DevSnapshot["git"]> {
	try {
		const topLevel =
			await Bun.$`git rev-parse --show-toplevel 2>/dev/null`
				.quiet()
				.nothrow();
		if (topLevel.exitCode !== 0) return undefined;

		const repo =
			topLevel.stdout.toString().trim().split("/").pop() ?? "";
		const branchResult =
			await Bun.$`git rev-parse --abbrev-ref HEAD`.quiet().nothrow();
		const branch =
			branchResult.exitCode === 0
				? branchResult.stdout.toString().trim()
				: "unknown";

		const statusResult =
			await Bun.$`git status --porcelain`.quiet().nothrow();
		const dirty =
			statusResult.exitCode === 0 &&
			statusResult.stdout.toString().trim().length > 0;

		let ahead = 0;
		let behind = 0;
		const countResult =
			await Bun.$`git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null`
				.quiet()
				.nothrow();
		if (countResult.exitCode === 0) {
			const parts = countResult.stdout.toString().trim().split(/\s+/);
			ahead = Number.parseInt(parts[0] ?? "0", 10) || 0;
			behind = Number.parseInt(parts[1] ?? "0", 10) || 0;
		}

		return { repo, branch, dirty, ahead, behind };
	} catch {
		return undefined;
	}
}

async function gatherPorts(): Promise<DevSnapshot["ports"]> {
	try {
		const ports: DevSnapshot["ports"] = [];
		const plat = osPlatform();

		if (plat === "darwin") {
			const result =
				await Bun.$`lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null`
					.quiet()
					.nothrow();
			if (result.exitCode !== 0) return [];
			const lines = result.stdout
				.toString()
				.trim()
				.split("\n")
				.slice(1); // skip header
			const seen = new Set<number>();
			for (const line of lines) {
				const parts = line.split(/\s+/);
				const proc = parts[0] ?? "";
				const pid = Number.parseInt(parts[1] ?? "0", 10) || 0;
				const nameField = parts[8] ?? "";
				const portMatch = nameField.match(/:(\d+)$/);
				if (portMatch) {
					const port = Number.parseInt(portMatch[1]!, 10);
					if (!seen.has(port)) {
						seen.add(port);
						ports.push({ port, pid, process: proc });
					}
				}
			}
		} else {
			// Linux: ss -tlnp
			const result =
				await Bun.$`ss -tlnp 2>/dev/null`.quiet().nothrow();
			if (result.exitCode !== 0) return [];
			const lines = result.stdout
				.toString()
				.trim()
				.split("\n")
				.slice(1);
			for (const line of lines) {
				const parts = line.split(/\s+/);
				const addrField = parts[3] ?? "";
				const portMatch = addrField.match(/:(\d+)$/);
				const pidMatch = (parts[5] ?? "").match(/pid=(\d+)/);
				const procMatch = (parts[5] ?? "").match(/\("([^"]+)"/);
				if (portMatch) {
					ports.push({
						port: Number.parseInt(portMatch[1]!, 10),
						pid: pidMatch ? Number.parseInt(pidMatch[1]!, 10) : 0,
						process: procMatch ? procMatch[1]! : "",
					});
				}
			}
		}

		return ports;
	} catch {
		return [];
	}
}

async function gatherRuntimes(): Promise<DevSnapshot["runtimes"]> {
	const checks = [
		{ name: "bun", cmd: () => Bun.$`bun --version`.quiet().nothrow() },
		{ name: "node", cmd: () => Bun.$`node --version`.quiet().nothrow() },
		{
			name: "python3",
			cmd: () => Bun.$`python3 --version`.quiet().nothrow(),
		},
		{ name: "go", cmd: () => Bun.$`go version`.quiet().nothrow() },
		{
			name: "rust",
			cmd: () => Bun.$`rustc --version`.quiet().nothrow(),
		},
	];

	const results = await Promise.all(
		checks.map(async ({ name, cmd }) => {
			try {
				const result = await cmd();
				if (result.exitCode === 0) {
					const output = result.stdout.toString().trim();
					const vMatch = output.match(/(\d+\.\d+[\w.-]*)/);
					return { name, version: vMatch ? vMatch[1]! : output };
				}
			} catch {
				/* not installed */
			}
			return null;
		}),
	);

	const runtimes: DevSnapshot["runtimes"] = [];
	for (const r of results) {
		if (r) runtimes.push(r);
	}
	return runtimes;
}
