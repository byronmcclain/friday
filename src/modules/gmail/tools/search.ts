import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailSearch: FridayTool = {
	name: "gmail.search",
	description:
		"Search Friday's Gmail inbox using Gmail query syntax. Returns message summaries with id, from, subject, date, snippet, labels, and unread status.",
	parameters: [
		{
			name: "query",
			type: "string",
			description:
				'Gmail search query (e.g., "is:unread", "from:github.com", "subject:invoice after:2026/01/01")',
			required: true,
		},
		{
			name: "max_results",
			type: "number",
			description: "Maximum number of results (default: 10)",
			required: false,
			default: 10,
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

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return {
				success: false,
				output: "Gmail not authenticated. Run /gmail auth to set up.",
			};
		}

		try {
			const maxResults =
				typeof args.max_results === "number" ? args.max_results : 10;
			const result = await client.listMessages(query, maxResults);

			await context.audit.log({
				action: "tool:gmail.search",
				source: "gmail.search",
				detail: `Searched: "${query}" — ${result.messages.length} results`,
				success: true,
			});

			const summary = result.messages
				.map((m) => {
					const unread = m.isUnread ? "[U] " : "    ";
					return `${unread}${m.id} | ${m.from} | ${m.subject} | ${m.date}`;
				})
				.join("\n");

			return {
				success: true,
				output:
					result.messages.length > 0
						? `Found ${result.messages.length} messages:\n${summary}`
						: "No messages found.",
				artifacts: {
					messages: result.messages,
					resultSizeEstimate: result.resultSizeEstimate,
				},
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail search failed: ${msg}` };
		}
	},
};
