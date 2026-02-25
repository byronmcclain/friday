import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

export type ContainmentResult =
	| { ok: true; resolved: string }
	| { ok: false; reason: string };

/**
 * Verify that a resolved path is contained within a base directory.
 * Resolves symlinks via realpath() to prevent symlink escapes.
 * Falls back to resolve() if realpath() fails (e.g., file doesn't exist yet for writes).
 */
export async function assertContained(
	resolved: string,
	baseDir: string,
): Promise<ContainmentResult> {
	let real: string;
	try {
		real = await realpath(resolved);
	} catch {
		// File may not exist yet (e.g., for writes) — use resolve() as fallback
		real = resolve(resolved);
	}

	let realBase: string;
	try {
		realBase = await realpath(baseDir);
	} catch {
		realBase = resolve(baseDir);
	}

	if (real === realBase || real.startsWith(`${realBase}/`)) {
		return { ok: true, resolved: real };
	}

	return { ok: false, reason: "Access denied: path escapes working directory" };
}

/** Paths that cannot be written/deleted by Friday's tools */
let protectedPaths: string[] = [];

/** Set the list of protected paths (called at boot) */
export function setProtectedPaths(paths: string[]): void {
	protectedPaths = paths.map((p) => resolve(p));
}

/** Check if a resolved path matches a protected path */
export function isProtectedPath(path: string): boolean {
	if (path.endsWith("/")) return false;
	const resolved = resolve(path);
	return protectedPaths.some((pp) => resolved === pp);
}

/** Get the current list of protected paths (for best-effort shell command checking) */
export function getProtectedPaths(): readonly string[] {
	return protectedPaths;
}
