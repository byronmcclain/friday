import type { FridayTool, ToolContext, ToolResult } from "../modules/types.ts";
import type { Sensorium } from "./sensorium.ts";
import { formatBytes, formatUptime } from "./format.ts";

export function createEnvironmentTool(sensorium: Sensorium): FridayTool {
	return {
		name: "getEnvironmentStatus",
		description:
			"Check system environment: CPU, memory, disk, containers, ports, git status. Use this to understand the current state of the machine Friday is running on.",
		parameters: [
			{
				name: "section",
				type: "string",
				description:
					"Which section to query: 'all', 'cpu', 'memory', 'docker', 'ports', 'git'. Defaults to 'all'.",
				required: false,
				default: "all",
			},
		],
		clearance: ["system"],
		execute: async (
			args: Record<string, unknown>,
			_context: ToolContext,
		): Promise<ToolResult> => {
			const snap = sensorium.currentSnapshot;
			if (!snap) {
				return {
					success: false,
					output: "No environment data available yet.",
				};
			}

			const section = (args.section as string) ?? "all";

			switch (section) {
				case "cpu":
					return {
						success: true,
						output: `CPU: ${snap.machine.cpus.count} cores (${snap.machine.cpus.model}) @ ${snap.machine.cpus.usage}%\nLoad: ${snap.machine.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
						artifacts: {
							cpu: snap.machine.cpus,
							loadAvg: snap.machine.loadAvg,
						},
					};

				case "memory":
				case "mem": {
					const m = snap.machine.memory;
					const percent =
						m.total > 0
							? Math.round((m.used / m.total) * 100)
							: 0;
					return {
						success: true,
						output: `Memory: ${formatBytes(m.used)}/${formatBytes(m.total)} (${percent}% used), ${formatBytes(m.free)} free`,
						artifacts: { memory: m },
					};
				}

				case "docker":
				case "containers":
					return {
						success: true,
						output:
							snap.containers.runtime === "none"
								? "Docker/Podman not detected."
								: `${snap.containers.runtime}: ${snap.containers.running.length} running, ${snap.containers.stopped} stopped\n${snap.containers.running.map((c) => `  ${c.name} (${c.image}) CPU:${c.cpu.toFixed(1)}% MEM:${c.memory.toFixed(1)}%`).join("\n")}`,
						artifacts: { containers: snap.containers },
					};

				case "ports":
					return {
						success: true,
						output:
							snap.dev.ports.length === 0
								? "No listening ports."
								: snap.dev.ports
										.map(
											(p) =>
												`:${p.port} (PID:${p.pid} ${p.process})`,
										)
										.join("\n"),
						artifacts: { ports: snap.dev.ports },
					};

				case "git":
					return {
						success: true,
						output: snap.dev.git
							? `${snap.dev.git.repo}@${snap.dev.git.branch} (${snap.dev.git.dirty ? "dirty" : "clean"}) ahead:${snap.dev.git.ahead} behind:${snap.dev.git.behind}`
							: "Not in a Git repository.",
						artifacts: { git: snap.dev.git ?? null },
					};

				case "all":
				default: {
					const m = snap.machine.memory;
					const memPercent =
						m.total > 0
							? Math.round((m.used / m.total) * 100)
							: 0;
					const lines = [
						`System: ${snap.machine.osVersion} ${snap.machine.arch} (${snap.machine.hostname}), uptime ${formatUptime(snap.machine.uptime)}`,
						`CPU: ${snap.machine.cpus.count} cores @ ${snap.machine.cpus.usage}%, load ${snap.machine.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
						`Memory: ${formatBytes(m.used)}/${formatBytes(m.total)} (${memPercent}%), ${formatBytes(m.free)} free`,
					];

					if (snap.containers.runtime !== "none") {
						lines.push(
							`Containers: ${snap.containers.running.length} running, ${snap.containers.stopped} stopped`,
						);
					}
					if (snap.dev.git) {
						lines.push(
							`Git: ${snap.dev.git.repo}@${snap.dev.git.branch} (${snap.dev.git.dirty ? "dirty" : "clean"})`,
						);
					}
					if (snap.dev.ports.length > 0) {
						lines.push(
							`Ports: ${snap.dev.ports.map((p) => `:${p.port}`).join(", ")}`,
						);
					}
					if (snap.dev.runtimes.length > 0) {
						lines.push(
							`Runtimes: ${snap.dev.runtimes.map((r) => `${r.name} ${r.version}`).join(", ")}`,
						);
					}

					return {
						success: true,
						output: lines.join("\n"),
						artifacts: {
							machine: snap.machine,
							containers: snap.containers,
							dev: snap.dev,
						},
					};
				}
			}
		},
	};
}

