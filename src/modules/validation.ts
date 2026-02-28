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
 * Block requests to private/loopback/link-local IP addresses (SSRF protection).
 * Returns null if safe, or a ToolResult rejection to early-return.
 */
export function assertNotPrivateIP(url: string): ToolResult | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { success: false, output: `Invalid URL: ${url}` };
	}
	const host = parsed.hostname;

	// IPv6 loopback
	if (host === "[::1]" || host === "::1") {
		return {
			success: false,
			output: "Requests to loopback addresses are not permitted",
		};
	}

	// IPv4 private/reserved ranges
	const ipMatch = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ipMatch) {
		const a = Number(ipMatch[1]);
		const b = Number(ipMatch[2]);
		if (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254) ||
			a === 0
		) {
			return {
				success: false,
				output:
					"Requests to private/link-local addresses are not permitted",
			};
		}
	}

	// DNS-based loopback
	if (host === "localhost" || host.endsWith(".local")) {
		return {
			success: false,
			output: "Requests to localhost are not permitted",
		};
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
	if (!Number.isInteger(num)) {
		return { success: false, output: `Invalid ${label}: must be an integer, got ${num}` };
	}
	return { value: num };
}
