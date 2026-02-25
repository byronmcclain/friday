import { mkdir, realpath, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import type { ForgeProposal } from "./types.ts";
import { ForgeManifestManager } from "./manifest.ts";
import { isProtectedPath } from "../filesystem/containment.ts";

export const forgeApply: FridayTool = {
	name: "forge_apply",
	description:
		"Write an approved proposal to disk. Requires a proposalId from a prior forge_propose call. Creates backups before patching existing modules.",
	parameters: [
		{
			name: "proposalId",
			type: "string",
			description: "The proposal ID returned by forge_propose",
			required: true,
		},
		{
			name: "forgeDir",
			type: "string",
			description: "The forge directory path (injected by runtime)",
			required: true,
		},
	],
	clearance: ["write-fs", "forge-modify"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const proposalId = args.proposalId as string;
		const forgeDir = args.forgeDir as string;

		if (!proposalId) {
			return {
				success: false,
				output: "Missing required parameter: proposalId",
			};
		}
		if (!forgeDir) {
			return {
				success: false,
				output: "Missing required parameter: forgeDir",
			};
		}

		const proposal =
			await context.memory.get<ForgeProposal>(`proposal:${proposalId}`);
		if (!proposal) {
			return {
				success: false,
				output: `Proposal "${proposalId}" not found. Use forge_propose first.`,
			};
		}

		// Resolve symlinks for path containment (e.g. /tmp → /private/tmp on macOS)
		const resolvedForge = await realpath(forgeDir).catch(
			() => resolve(forgeDir),
		);
		const resolvedModule = resolve(resolvedForge, proposal.moduleName);

		// Path containment check
		if (!resolvedModule.startsWith(resolvedForge)) {
			return {
				success: false,
				output: "Access denied: module path escapes forge directory",
			};
		}

		try {
			// Enforce protection before patching
			if (proposal.action === "patch") {
				const patchManifest = new ForgeManifestManager(resolvedForge);
				if (await patchManifest.isProtected(proposal.moduleName)) {
					return {
						success: false,
						output: `Module "${proposal.moduleName}" is protected and cannot be patched`,
					};
				}

				// Verify manifest entry exists before writing files
				const patchEntry = await patchManifest.getEntry(proposal.moduleName);
				if (!patchEntry) {
					return {
						success: false,
						output: `Module "${proposal.moduleName}" not found in forge manifest. Cannot patch a module that doesn't exist.`,
					};
				}
			}

			// Backup existing module for patches
			if (proposal.action === "patch") {
				const backupDir = resolve(
					resolvedForge,
					".backups",
					`${proposal.moduleName}-${Date.now()}`,
				);
				const moduleExists = await Bun.file(
					resolve(resolvedModule, "index.ts"),
				).exists();
				if (moduleExists) {
					await cp(resolvedModule, backupDir, { recursive: true });
				}
			}

			// Write all proposal files
			const written: string[] = [];
			for (const file of proposal.files) {
				const filePath = resolve(resolvedModule, file.path);

				// Path containment per-file
				if (!filePath.startsWith(resolvedModule)) {
					return {
						success: false,
						output: `Access denied: file "${file.path}" escapes module directory`,
					};
				}

				if (isProtectedPath(filePath)) {
					await context.audit.log({
						action: "genesis:write-denied",
						source: "forge",
						detail: `Blocked forge proposal targeting protected path: ${filePath}`,
						success: false,
					});
					return {
						success: false,
						output: `Access denied: file "${file.path}" targets a protected path (GENESIS.md is BOSS-only)`,
					};
				}

				await mkdir(dirname(filePath), { recursive: true });
				await Bun.write(filePath, file.content);
				written.push(`${proposal.moduleName}/${file.path}`);
			}

			// Update manifest
			const manifest = new ForgeManifestManager(resolvedForge);
			if (proposal.action === "create") {
				await manifest.addModule(
					proposal.moduleName,
					proposal.description,
					"1.0.0",
					proposal.description,
				);
			} else {
				const entry = await manifest.getEntry(proposal.moduleName);
				const currentVersion = entry?.version ?? "1.0.0";
				const rawParts = currentVersion.split(".");
				// Ensure at least 3 parts and clamp NaN to 0
				const major = Number.parseInt(rawParts[0] ?? "1", 10) || 0;
				const minor = Number.parseInt(rawParts[1] ?? "0", 10) || 0;
				const patch = (Number.parseInt(rawParts[2] ?? "0", 10) || 0) + 1;
				const newVersion = `${major}.${minor}.${patch}`;
				await manifest.updateModule(
					proposal.moduleName,
					newVersion,
					"patched",
					proposal.description,
				);
			}

			// Clean up proposal from memory
			await context.memory.delete(`proposal:${proposalId}`);

			await context.audit.log({
				action: "forge:apply",
				source: "forge",
				detail: `Applied ${proposal.action} for "${proposal.moduleName}": ${written.join(", ")}`,
				success: true,
			});

			return {
				success: true,
				output: `Applied ${proposal.action} for "${proposal.moduleName}".\nFiles written:\n${written.map((f) => `  ${f}`).join("\n")}\n\nRun forge_validate next to check the module before restarting.`,
				artifacts: {
					moduleName: proposal.moduleName,
					action: proposal.action,
					files: written,
				},
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Failed to apply proposal: ${msg}` };
		}
	},
};
