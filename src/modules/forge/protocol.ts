import type {
	FridayProtocol,
	ProtocolResult,
	ProtocolContext,
} from "../types.ts";
import { ForgeManifestManager } from "./manifest.ts";

export function createForgeProtocol(forgeDir: string): FridayProtocol {
	return {
		name: "forge",
		description:
			"Manage Friday's self-authored modules — list | status <name> | history <name> | protect <name> | unprotect <name> | manifest | rollback <name>",
		aliases: ["workshop"],
		parameters: [],
		clearance: ["read-fs"],
		execute: async (
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> => {
			const rawArgs = (args.rawArgs as string) ?? "";
			const parts = rawArgs.trim().split(/\s+/);
			const subcommand = parts[0] ?? "";
			const rest = parts.slice(1).join(" ");
			const manifest = new ForgeManifestManager(forgeDir);

			switch (subcommand) {
				case "":
				case "help":
					return {
						success: true,
						summary: [
							"The Forge — Friday's self-improvement system",
							"",
							"  /forge list              List all forge modules with status",
							"  /forge status <name>     Show details for a module",
							"  /forge history <name>    Version history from manifest",
							"  /forge protect <name>    Lock a module from AI modification",
							"  /forge unprotect <name>  Remove protection lock",
							"  /forge manifest          Dump raw manifest.json",
							"  /forge rollback <name>   Restore from backup (not yet implemented)",
							"",
							"Alias: /workshop",
						].join("\n"),
					};
				case "list":
					return handleList(manifest);
				case "status":
					return handleStatus(manifest, rest);
				case "history":
					return handleHistory(manifest, rest);
				case "protect":
					return handleProtect(manifest, rest, true);
				case "unprotect":
					return handleProtect(manifest, rest, false);
				case "manifest":
					return handleManifestDump(manifest);
				case "rollback":
					return handleRollback(rest);
				default:
					return {
						success: false,
						summary: `Unknown subcommand: "${subcommand}". Use /forge help to see available commands.`,
					};
			}
		},
	};
}

async function handleList(
	manifest: ForgeManifestManager,
): Promise<ProtocolResult> {
	const names = await manifest.listModules();
	if (names.length === 0) {
		return { success: true, summary: "No forge modules found." };
	}
	const lines: string[] = [];
	for (const name of names) {
		const entry = await manifest.getEntry(name);
		if (entry) {
			const prot = entry.protected ? " [protected]" : "";
			lines.push(
				`  ${name} v${entry.version} (${entry.status})${prot}`,
			);
		}
	}
	return {
		success: true,
		summary: `Forge Modules (${names.length}):\n${lines.join("\n")}`,
	};
}

async function handleStatus(
	manifest: ForgeManifestManager,
	name: string,
): Promise<ProtocolResult> {
	if (!name) return { success: false, summary: "Usage: /forge status <name>" };
	const entry = await manifest.getEntry(name);
	if (!entry) return { success: false, summary: `Module "${name}" not found.` };
	return {
		success: true,
		summary: [
			`${name} v${entry.version} (${entry.status})`,
			`Description: ${entry.description}`,
			`Protected: ${entry.protected ? "yes" : "no"}`,
			`Created: ${entry.created}`,
			`Modified: ${entry.lastModified}`,
		].join("\n"),
	};
}

async function handleHistory(
	manifest: ForgeManifestManager,
	name: string,
): Promise<ProtocolResult> {
	if (!name)
		return { success: false, summary: "Usage: /forge history <name>" };
	const entry = await manifest.getEntry(name);
	if (!entry) return { success: false, summary: `Module "${name}" not found.` };
	const lines = entry.history.map(
		(h) => `  v${h.version} [${h.action}] ${h.date} — ${h.reason}`,
	);
	return {
		success: true,
		summary: `History for ${name}:\n${lines.join("\n")}`,
	};
}

async function handleProtect(
	manifest: ForgeManifestManager,
	name: string,
	value: boolean,
): Promise<ProtocolResult> {
	if (!name)
		return {
			success: false,
			summary: `Usage: /forge ${value ? "protect" : "unprotect"} <name>`,
		};
	try {
		await manifest.setProtected(name, value);
		return {
			success: true,
			summary: `Module "${name}" is now ${value ? "protected" : "unprotected"}.`,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { success: false, summary: msg };
	}
}

async function handleManifestDump(
	manifest: ForgeManifestManager,
): Promise<ProtocolResult> {
	const data = await manifest.load();
	return { success: true, summary: JSON.stringify(data, null, 2) };
}

async function handleRollback(_name: string): Promise<ProtocolResult> {
	if (!_name)
		return { success: false, summary: "Usage: /forge rollback <name>" };
	return {
		success: false,
		summary:
			"Rollback is not yet implemented. Manually restore from forge/.backups/ for now.",
	};
}
