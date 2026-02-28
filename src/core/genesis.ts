import { dirname } from "node:path";
import { mkdir, chmod, stat } from "node:fs/promises";
import { GENESIS_TEMPLATE } from "./prompts.ts";

const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";

/** Default directory for Friday's protected config */
export const GENESIS_DEFAULT_DIR = `${home}/.friday`;

/** Default path to GENESIS.md */
export const GENESIS_DEFAULT_PATH = `${GENESIS_DEFAULT_DIR}/GENESIS.md`;

/**
 * Resolve the Genesis file path.
 * Priority: FRIDAY_GENESIS_PATH env var > default ~/.friday/GENESIS.md
 */
export function resolveGenesisPath(): string {
	return process.env.FRIDAY_GENESIS_PATH ?? GENESIS_DEFAULT_PATH;
}

/**
 * Load Genesis content from disk. Fails hard on missing or empty file.
 */
export async function loadGenesis(path: string): Promise<string> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(
			`GENESIS.md not found at ${path}. Run 'friday genesis init' to create it.`,
		);
	}

	const content = await file.text();
	if (content.trim().length === 0) {
		throw new Error(
			`GENESIS.md is empty at ${path}. Friday needs her identity prompt.`,
		);
	}

	return content;
}

/**
 * Seed GENESIS.md from the built-in template. Won't overwrite existing files.
 * Sets directory to 700 and file to 600.
 */
export async function seedGenesis(path: string): Promise<boolean> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true, mode: 0o700 });

	const file = Bun.file(path);
	if (await file.exists()) {
		return false;
	}

	await Bun.write(path, GENESIS_TEMPLATE);
	await chmod(path, 0o600);
	return true;
}

/**
 * Overwrite GENESIS.md with the current built-in template.
 * Creates the file if it doesn't exist. Sets permissions to 600.
 */
export async function updateGenesis(path: string): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await Bun.write(path, GENESIS_TEMPLATE);
	await chmod(path, 0o600);
}

export interface GenesisCheckResult {
	ok: boolean;
	issues?: string[];
}

/**
 * Validate that GENESIS.md exists, is non-empty, and has correct permissions.
 */
export async function checkGenesis(
	path: string,
): Promise<GenesisCheckResult> {
	const issues: string[] = [];

	try {
		const info = await stat(path);

		if (info.size === 0) {
			issues.push("File is empty — Friday needs her identity prompt");
		}

		const perms = info.mode & 0o777;
		if (perms !== 0o600) {
			issues.push(
				`Permissions are ${perms.toString(8)}, expected 600 (owner read/write only)`,
			);
		}
	} catch {
		issues.push("File not found");
	}

	return {
		ok: issues.length === 0,
		issues: issues.length > 0 ? issues : undefined,
	};
}

/**
 * Ensure permissions are correct on an existing Genesis file.
 */
export async function enforceGenesisPermissions(path: string): Promise<void> {
	const dir = dirname(path);
	try {
		await chmod(dir, 0o700);
	} catch (err) {
		console.warn(`[Genesis] Could not enforce permissions on directory ${dir}:`, err instanceof Error ? err.message : err);
	}
	try {
		await chmod(path, 0o600);
	} catch (err) {
		console.warn(`[Genesis] Could not enforce permissions on ${path}:`, err instanceof Error ? err.message : err);
	}
}
