import { resolve } from "node:path";
import { readdir, realpath } from "node:fs/promises";
import type { FridayTool, ToolContext, ToolResult, FridayModule } from "../types.ts";
import { validateModule } from "../loader.ts";
import type { ForgeValidationResult, ForgeValidationStep } from "./types.ts";

/** Known HTML entity patterns LLMs emit inside TypeScript code */
const HTML_ENTITY_PAIRS: [RegExp, string][] = [
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
	[/&amp;/g, "&"],
	[/&quot;/g, '"'],
	[/&#39;/g, "'"],
];

/**
 * Scan all .ts files in a module directory and fix HTML entities in-place.
 * Returns the list of files that were sanitized (empty if none needed fixing).
 */
async function sanitizeLlmArtifacts(moduleDir: string): Promise<string[]> {
	const fixed: string[] = [];
	let entries: string[];
	try {
		entries = (await readdir(moduleDir, { recursive: true }))
			.filter((e) => e.endsWith(".ts"));
	} catch {
		return fixed;
	}

	await Promise.all(entries.map(async (entry) => {
		const filePath = resolve(moduleDir, entry);
		const content = await Bun.file(filePath).text();
		let sanitized = content;
		for (const [pattern, replacement] of HTML_ENTITY_PAIRS) {
			sanitized = sanitized.replace(pattern, replacement);
		}
		if (sanitized !== content) {
			await Bun.write(filePath, sanitized);
			fixed.push(entry);
		}
	}));
	return fixed;
}

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
	],
	clearance: ["exec-shell"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const moduleName = args.moduleName as string;
		const forgeDir = (args.forgeDir as string) ?? resolve(context.workingDirectory, "forge");

		if (!moduleName) {
			return {
				success: false,
				output: "Missing required parameter: moduleName",
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

		// Step 0: Auto-fix known LLM encoding artifacts (HTML entities in TS files)
		const sanitizedFiles = await sanitizeLlmArtifacts(moduleDir);

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

		// Steps 3 & 4: Typecheck + Lint (independent — run concurrently)
		const decoder = new TextDecoder();

		const typecheckP = (async (): Promise<ForgeValidationStep> => {
			try {
				// Pass compiler flags explicitly — tsc ignores tsconfig.json when
				// input files are specified on the command line.
				const proc = Bun.spawn(
					[
						"bunx", "tsc", "--noEmit", "--pretty",
						"--target", "esnext",
						"--moduleResolution", "bundler",
						"--module", "preserve",
						"--allowImportingTsExtensions",
						"--verbatimModuleSyntax",
						"--skipLibCheck",
						"--strict",
						indexPath,
					],
					{ cwd: context.workingDirectory, stdout: "pipe", stderr: "pipe" },
				);
				const [, stderrBuf] = await Promise.all([
					new Response(proc.stdout).arrayBuffer(),
					new Response(proc.stderr).arrayBuffer(),
				]);
				const exitCode = await proc.exited;
				if (exitCode === 0) return { name: "typecheck", passed: true };
				const stderr = decoder.decode(stderrBuf);
				return { name: "typecheck", passed: false, error: stderr.slice(0, 500) };
			} catch {
				return { name: "typecheck", passed: false, error: "bunx not found — check skipped" };
			}
		})();

		const lintP = (async (): Promise<ForgeValidationStep> => {
			try {
				const proc = Bun.spawn(["bunx", "biome", "check", moduleDir], {
					cwd: context.workingDirectory, stdout: "pipe", stderr: "pipe",
				});
				const [stdoutBuf] = await Promise.all([
					new Response(proc.stdout).arrayBuffer(),
					new Response(proc.stderr).arrayBuffer(),
				]);
				const exitCode = await proc.exited;
				if (exitCode === 0) return { name: "lint", passed: true };
				const stdout = decoder.decode(stdoutBuf);
				return { name: "lint", passed: false, error: stdout.slice(0, 500) };
			} catch {
				return { name: "lint", passed: false, error: "bunx not found — check skipped" };
			}
		})();

		const [typecheckStep, lintStep] = await Promise.all([typecheckP, lintP]);
		steps.push(typecheckStep, lintStep);

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

		const sanitizeNote = sanitizedFiles.length > 0
			? `\n\nAuto-fixed HTML entities in: ${sanitizedFiles.join(", ")}`
			: "";

		return {
			success: allPassed,
			output: `Validation ${allPassed ? "passed" : "FAILED"} for "${moduleName}":\n${report}${sanitizeNote}${allPassed ? "\n\nReady for forge_restart." : "\n\nUse fs.read to inspect the failing files, fs.write to fix them, then forge_validate again."}`,
			artifacts: { ...result },
		};
	},
};
