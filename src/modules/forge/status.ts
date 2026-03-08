import { resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { ForgeManifestManager } from "./manifest.ts";

export const forgeStatus: FridayTool = {
	name: "forge_status",
	description:
		"List all forge-authored modules and their health. Optionally show detail for a specific module.",
	parameters: [
		{
			name: "moduleName",
			type: "string",
			description: "Optional: specific module to get details for",
			required: false,
		},
	],
	clearance: ["read-fs"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const forgeDir = (args.forgeDir as string) ?? resolve(context.workingDirectory, "forge");
		const moduleName = args.moduleName as string | undefined;

		const manifest = new ForgeManifestManager(forgeDir);

		if (moduleName) {
			const entry = await manifest.getEntry(moduleName);
			if (!entry) {
				return {
					success: false,
					output: `Module "${moduleName}" not found in forge manifest.`,
				};
			}

			const historyLines = entry.history
				.map(
					(h) =>
						`  v${h.version} [${h.action}] ${h.date} — ${h.reason}`,
				)
				.join("\n");

			return {
				success: true,
				output: [
					`Module: ${moduleName}`,
					`Description: ${entry.description}`,
					`Version: ${entry.version}`,
					`Status: ${entry.status}`,
					`Protected: ${entry.protected ? "yes" : "no"}`,
					`Created: ${entry.created}`,
					`Last Modified: ${entry.lastModified}`,
					`History:\n${historyLines}`,
				].join("\n"),
			};
		}

		const names = await manifest.listModules();
		if (names.length === 0) {
			return { success: true, output: "No forge modules found." };
		}

		const lines: string[] = [];
		for (const name of names) {
			const entry = await manifest.getEntry(name);
			if (entry) {
				const prot = entry.protected ? " [protected]" : "";
				lines.push(
					`  ${name} v${entry.version} (${entry.status})${prot} — ${entry.description}`,
				);
			}
		}

		return {
			success: true,
			output: `Forge Modules (${names.length}):\n${lines.join("\n")}`,
		};
	},
};
