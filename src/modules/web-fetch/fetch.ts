import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertAllowedProtocol, assertNotPrivateIP } from "../validation.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000; // 1MB response body cap

export const webFetch: FridayTool = {
	name: "web.fetch",
	description:
		"Fetch content from a URL via HTTP. Supports GET, POST, PUT, DELETE methods with custom headers and body. Returns response status, headers, and body.",
	parameters: [
		{
			name: "url",
			type: "string",
			description: "URL to fetch",
			required: true,
		},
		{
			name: "method",
			type: "string",
			description: 'HTTP method: "GET", "POST", "PUT", "DELETE" (default: "GET")',
			required: false,
			default: "GET",
		},
		{
			name: "headers",
			type: "object",
			description: "Request headers as key-value pairs",
			required: false,
		},
		{
			name: "body",
			type: "string",
			description: "Request body (for POST/PUT). JSON strings are sent with Content-Type: application/json.",
			required: false,
		},
		{
			name: "timeout",
			type: "number",
			description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
			required: false,
			default: DEFAULT_TIMEOUT_MS,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const url = args.url as string;
		if (!url) {
			return { success: false, output: "Missing required parameter: url" };
		}

		const protocolCheck = assertAllowedProtocol(url);
		if (protocolCheck) return protocolCheck;

		const privateIpCheck = assertNotPrivateIP(url);
		if (privateIpCheck) return privateIpCheck;

		const method = ((args.method as string) ?? "GET").toUpperCase();
		const headers = (args.headers as Record<string, string>) ?? {};
		const body = args.body as string | undefined;
		const timeout = Math.min(
			MAX_TIMEOUT_MS,
			Math.max(1000, (args.timeout as number) ?? DEFAULT_TIMEOUT_MS),
		);

		// Auto-detect JSON body
		if (body && !headers["Content-Type"] && !headers["content-type"]) {
			try {
				JSON.parse(body);
				headers["Content-Type"] = "application/json";
			} catch {
				/* not JSON, leave as-is */
			}
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: method !== "GET" && method !== "HEAD" ? body : undefined,
				signal: controller.signal,
			});

			const rawBody = await response.text();
			const originalLength = rawBody.length;
			let responseBody = rawBody;
			let truncated = false;
			if (originalLength > MAX_BODY_BYTES) {
				responseBody = `${rawBody.slice(0, MAX_BODY_BYTES)}\n... (truncated, ${originalLength} total chars)`;
				truncated = true;
			}

			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});

			const statusLine = `${response.status} ${response.statusText}`;
			const headerLines = Object.entries(responseHeaders)
				.map(([k, v]) => `  ${k}: ${v}`)
				.join("\n");

			const output = `[${method}] ${url}\nStatus: ${statusLine}\nHeaders:\n${headerLines}\n\nBody:\n${responseBody.trim()}`;

			await context.audit.log({
				action: "tool:web.fetch",
				source: "web.fetch",
				detail: `${method} ${url} → ${response.status}`,
				success: response.ok,
			});

			return {
				success: response.ok,
				output,
				artifacts: {
					status: response.status,
					statusText: response.statusText,
					headers: responseHeaders,
					truncated,
					contentLength: originalLength,
				},
			};
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				return {
					success: false,
					output: `Request timed out after ${timeout}ms: ${url}`,
				};
			}
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Fetch failed: ${msg}` };
		} finally {
			clearTimeout(timeoutId);
		}
	},
};
