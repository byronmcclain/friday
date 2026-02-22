import type { FridayTool, ToolContext, ToolResult } from "../types.ts";

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 500_000;

export const webSearch: FridayTool = {
	name: "web.search",
	description:
		"Search the web using a search engine. Returns raw HTML/text from the search results page. Useful for finding up-to-date information, documentation links, or verifying facts.",
	parameters: [
		{
			name: "query",
			type: "string",
			description: "Search query string",
			required: true,
		},
		{
			name: "engine",
			type: "string",
			description:
				'Search engine to use: "duckduckgo" (default: "duckduckgo")',
			required: false,
			default: "duckduckgo",
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const query = args.query as string;
		if (!query) {
			return { success: false, output: "Missing required parameter: query" };
		}

		const engine = (args.engine as string) ?? "duckduckgo";

		let searchUrl: string;
		switch (engine) {
			case "duckduckgo":
				searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
				break;
			default:
				return {
					success: false,
					output: `Unsupported search engine: ${engine}. Supported: duckduckgo`,
				};
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

		try {
			const response = await fetch(searchUrl, {
				headers: {
					"User-Agent": "Friday-AI-Assistant/1.0",
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				return {
					success: false,
					output: `Search request failed: ${response.status} ${response.statusText}`,
				};
			}

			let body = await response.text();
			if (body.length > MAX_BODY_BYTES) {
				body = `${body.slice(0, MAX_BODY_BYTES)}\n... (truncated)`;
			}

			// Extract text content — strip HTML tags for readability
			const textContent = body
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 50_000); // Cap final output

			await context.audit.log({
				action: "tool:web.search",
				source: "web.search",
				detail: `Searched "${query}" via ${engine}`,
				success: true,
			});

			return {
				success: true,
				output: `[Search: "${query}" via ${engine}]\n\n${textContent}`,
				artifacts: { query, engine, url: searchUrl },
			};
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				return {
					success: false,
					output: `Search timed out for: ${query}`,
				};
			}
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Search failed: ${msg}` };
		} finally {
			clearTimeout(timeoutId);
		}
	},
};
