import type { ToolResult } from "./types.ts";

/**
 * Reject CLI argument values starting with "-" to prevent flag injection.
 * Returns null if safe, or a ToolResult rejection to early-return.
 */
export function assertSafeArg(value: string, label: string): ToolResult | null {
	if (!value || !value.trim()) {
		return { success: false, output: `Invalid ${label}: must not be empty` };
	}
	if (value.trim().startsWith("-")) {
		return {
			success: false,
			output: `Invalid ${label}: must not start with "-"`,
		};
	}
	return null;
}

/**
 * Allowlist http: and https: protocols only. Prevents SSRF via file:, data:, ftp:, etc.
 * Returns null if safe, or a ToolResult rejection to early-return.
 */
export function assertAllowedProtocol(url: string): ToolResult | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { success: false, output: `Invalid URL: ${url}` };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { success: false, output: `Disallowed protocol: ${parsed.protocol}. Only http: and https: are permitted.` };
	}
	return null;
}

/**
 * Validate and coerce a value to a non-negative integer.
 * Prevents type confusion from `as number` casts on LLM-provided args.
 * Returns { value: number } on success, or a ToolResult rejection.
 */
export function assertInteger(value: unknown, label: string): { value: number } | ToolResult {
	const num = Number(value);
	if (!Number.isFinite(num) || num < 0) {
		return { success: false, output: `Invalid ${label}: must be a non-negative integer` };
	}
	return { value: Math.floor(num) };
}
