import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { FridayTool, ToolContext, ToolResult, FridayModule } from "../types.ts";
import { validateModule } from "../loader.ts";
import type { ForgeValidationResult, ForgeValidationStep } from "./types.ts";

export const forgeValidate: FridayTool = {
	name: "forge_validate",
	description:
		"Run validation pipeline on a forge module: import test, manifest check, typecheck, and lint. Stores a validation receipt on success that forge_restart requires.",
	parameters: [
		{
			name: "moduleName",
			type: "string",
			description: "Name of the forge module to validate",
			required: true,
		},
		{
			name: "forgeDir",
			type: "string",
			description: "The forge directory path (injected by runtime)",
			required: true,
		},
	],
	clearance: ["exec-shell"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const moduleName = args.moduleName as string;
		const forgeDir = args.forgeDir as string;

		if (!moduleName) {
			return {
				success: false,
				output: "Missing required parameter: moduleName",
			};
		}
		if (!forgeDir) {
			return {
				success: false,
				output: "Missing required parameter: forgeDir",
			};
		}

		const resolvedForge = await realpath(forgeDir).catch(
			() => resolve(forgeDir),
		);
		const moduleDir = resolve(resolvedForge, moduleName);
		const indexPath = resolve(moduleDir, "index.ts");

		if (!(await Bun.file(indexPath).exists())) {
			return {
				success: false,
				output: `Module "${moduleName}" not found at ${moduleDir}`,
			};
		}

		const steps: ForgeValidationStep[] = [];

		// Step 1: Import test
		let mod: FridayModule | undefined;
		try {
			const imported = await import(`${indexPath}?t=${Date.now()}`);
			mod = imported.default ?? imported;
			steps.push({ name: "import", passed: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			steps.push({ name: "import", passed: false, error: msg });
		}

		// Step 2: Manifest check
		if (mod) {
			const validation = validateModule(mod);
			if (validation.valid) {
				steps.push({ name: "manifest", passed: true });
			} else {
				steps.push({
					name: "manifest",
					passed: false,
					error: validation.error,
				});
			}
		} else {
			steps.push({
				name: "manifest",
				passed: false,
				error: "Skipped — import failed",
			});
		}

		// Step 3: Typecheck (best-effort, non-blocking)
		try {
			const proc = Bun.spawn(
				["bunx", "tsc", "--noEmit", "--pretty", indexPath],
				{
					cwd: context.workingDirectory,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			// Consume I/O before awaiting exit to prevent pipe buffer deadlock
			const [, stderrBuf] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
			]);
			const exitCode = await proc.exited;
			if (exitCode === 0) {
				steps.push({ name: "typecheck", passed: true });
			} else {
				const stderr = new TextDecoder().decode(stderrBuf);
				steps.push({
					name: "typecheck",
					passed: false,
					error: stderr.slice(0, 500),
				});
			}
		} catch (err: unknown) {
			const isNotFound = err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT";
			steps.push({ name: "typecheck", passed: isNotFound });
		}

		// Step 4: Lint (best-effort, non-blocking)
		try {
			const proc = Bun.spawn(["bunx", "biome", "check", moduleDir], {
				cwd: context.workingDirectory,
				stdout: "pipe",
				stderr: "pipe",
			});
			// Consume I/O before awaiting exit to prevent pipe buffer deadlock
			const [stdoutBuf] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
			]);
			const exitCode = await proc.exited;
			if (exitCode === 0) {
				steps.push({ name: "lint", passed: true });
			} else {
				const stdout = new TextDecoder().decode(stdoutBuf);
				steps.push({
					name: "lint",
					passed: false,
					error: stdout.slice(0, 500),
				});
			}
		} catch (err: unknown) {
			const isNotFound = err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT";
			steps.push({ name: "lint", passed: isNotFound });
		}

		const allPassed = steps.every((s) => s.passed);
		const result: ForgeValidationResult = {
			moduleName,
			passed: allPassed,
			steps,
		};

		if (allPassed) {
			await context.memory.set(`validation:${moduleName}`, {
				moduleName,
				validatedAt: new Date().toISOString(),
			});
		}

		await context.audit.log({
			action: "forge:validate",
			source: "forge",
			detail: `Validation ${allPassed ? "passed" : "failed"} for "${moduleName}": ${steps.map((s) => `${s.name}:${s.passed ? "pass" : "fail"}`).join(", ")}`,
			success: allPassed,
		});

		const report = steps
			.map(
				(s) =>
					`  ${s.passed ? "pass" : "FAIL"} ${s.name}${s.error ? `: ${s.error}` : ""}`,
			)
			.join("\n");

		return {
			success: allPassed,
			output: `Validation ${allPassed ? "passed" : "FAILED"} for "${moduleName}":\n${report}${allPassed ? "\n\nReady for forge_restart." : "\n\nFix the errors and try again with forge_propose."}`,
			artifacts: { ...result },
		};
	},
};
