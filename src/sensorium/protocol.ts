import type {
	FridayProtocol,
	ProtocolResult,
	ProtocolContext,
} from "../modules/types.ts";
import type { Sensorium } from "./sensorium.ts";
import { formatBytes, formatUptime } from "./format.ts";

export function createEnvProtocol(sensorium: Sensorium): FridayProtocol {
	return {
		name: "env",
		description:
			"View system environment: CPU, memory, containers, ports, git",
		aliases: ["environment", "sys"],
		parameters: [],
		clearance: [],
		execute: async (
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> => {
			const rawArgs = (args.rawArgs as string) ?? "";
			const parts = rawArgs.trim().split(/\s+/);
			const subcommand = parts[0] ?? "";

			const snap = sensorium.currentSnapshot;
			if (!snap) {
				return {
					success: false,
					summary: "No environment data available yet.",
				};
			}

			switch (subcommand) {
				case "":
				case "status":
					return handleStatus(sensorium);
				case "cpu":
					return handleCpu(sensorium);
				case "memory":
				case "mem":
					return handleMemory(sensorium);
				case "docker":
				case "containers":
					return handleDocker(sensorium);
				case "ports":
					return handlePorts(sensorium);
				case "git":
					return handleGit(sensorium);
				default:
					return {
						success: false,
						summary: `Unknown subcommand: "${subcommand}". Available: status, cpu, memory, docker, ports, git`,
					};
			}
		},
	};
}

function handleStatus(sensorium: Sensorium): ProtocolResult {
	const s = sensorium.currentSnapshot!;
	const m = s.machine;
	const memPercent =
		m.memory.total > 0
			? Math.round((m.memory.used / m.memory.total) * 100)
			: 0;

	const lines: string[] = [
		`System: ${m.osVersion} ${m.arch} (${m.hostname})`,
		`Uptime: ${formatUptime(m.uptime)}`,
		`CPU: ${m.cpus.count} cores (${m.cpus.model}) @ ${m.cpus.usage}%`,
		`Memory: ${formatBytes(m.memory.used)}/${formatBytes(m.memory.total)} (${memPercent}%)`,
		`Load: ${m.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
	];

	if (s.containers.runtime !== "none") {
		lines.push(
			`Containers: ${s.containers.running.length} running, ${s.containers.stopped} stopped (${s.containers.runtime})`,
		);
	}

	if (s.dev.git) {
		const dirty = s.dev.git.dirty ? "dirty" : "clean";
		lines.push(`Git: ${s.dev.git.repo}@${s.dev.git.branch} (${dirty})`);
	}

	if (s.dev.ports.length > 0) {
		lines.push(
			`Ports: ${s.dev.ports.map((p) => `${p.port} (${p.process})`).join(", ")}`,
		);
	}

	if (s.dev.runtimes.length > 0) {
		lines.push(
			`Runtimes: ${s.dev.runtimes.map((r) => `${r.name} ${r.version}`).join(", ")}`,
		);
	}

	return { success: true, summary: lines.join("\n") };
}

function handleCpu(sensorium: Sensorium): ProtocolResult {
	const m = sensorium.currentSnapshot!.machine;
	const lines = [
		`CPU: ${m.cpus.count} cores (${m.cpus.model})`,
		`Usage: ${m.cpus.usage}%`,
		`Load averages: ${m.loadAvg[0].toFixed(2)} (1m) ${m.loadAvg[1].toFixed(2)} (5m) ${m.loadAvg[2].toFixed(2)} (15m)`,
	];
	return { success: true, summary: lines.join("\n") };
}

function handleMemory(sensorium: Sensorium): ProtocolResult {
	const m = sensorium.currentSnapshot!.machine.memory;
	const percent =
		m.total > 0 ? Math.round((m.used / m.total) * 100) : 0;
	const lines = [
		`Total: ${formatBytes(m.total)}`,
		`Used:  ${formatBytes(m.used)} (${percent}%)`,
		`Free:  ${formatBytes(m.free)}`,
	];
	return { success: true, summary: lines.join("\n") };
}

function handleDocker(sensorium: Sensorium): ProtocolResult {
	const c = sensorium.currentSnapshot!.containers;
	if (c.runtime === "none") {
		return { success: true, summary: "Docker/Podman not detected." };
	}
	if (c.running.length === 0) {
		return {
			success: true,
			summary: `${c.runtime}: No running containers. ${c.stopped} stopped.`,
		};
	}
	const lines = [
		`${c.runtime}: ${c.running.length} running, ${c.stopped} stopped`,
		"",
		...c.running.map(
			(r) =>
				`  ${r.name}  ${r.image}  CPU:${r.cpu.toFixed(1)}%  MEM:${r.memory.toFixed(1)}%  ${r.status}`,
		),
	];
	return { success: true, summary: lines.join("\n") };
}

function handlePorts(sensorium: Sensorium): ProtocolResult {
	const ports = sensorium.currentSnapshot!.dev.ports;
	if (ports.length === 0) {
		return { success: true, summary: "No listening ports detected." };
	}
	const lines = ports.map(
		(p) => `  :${p.port}  PID:${p.pid}  ${p.process}`,
	);
	return {
		success: true,
		summary: `Listening ports (${ports.length}):\n${lines.join("\n")}`,
	};
}

function handleGit(sensorium: Sensorium): ProtocolResult {
	const git = sensorium.currentSnapshot!.dev.git;
	if (!git) {
		return { success: true, summary: "Not in a Git repository." };
	}
	const lines = [
		`Repo: ${git.repo}`,
		`Branch: ${git.branch}`,
		`Status: ${git.dirty ? "dirty (uncommitted changes)" : "clean"}`,
		`Ahead: ${git.ahead}  Behind: ${git.behind}`,
	];
	return { success: true, summary: lines.join("\n") };
}
