import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailListLabels: FridayTool = {
	name: "gmail.list_labels",
	description: "List all Gmail labels with message counts.",
	parameters: [],
	clearance: ["network"],

	async execute(
		_args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return {
				success: false,
				output: "Gmail not authenticated. Run /gmail auth to set up.",
			};
		}

		try {
			const labels = await client.listLabels();

			await context.audit.log({
				action: "tool:gmail.list_labels",
				source: "gmail.list_labels",
				detail: `Listed ${labels.length} labels`,
				success: true,
			});

			const lines = labels.map((l) => {
				const unread =
					l.messagesUnread > 0 ? ` (${l.messagesUnread} unread)` : "";
				return `  ${l.name} [${l.type}] — ${l.messagesTotal} messages${unread}`;
			});

			return {
				success: true,
				output: `Labels (${labels.length}):\n${lines.join("\n")}`,
				artifacts: { labels },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail labels failed: ${msg}` };
		}
	},
};
