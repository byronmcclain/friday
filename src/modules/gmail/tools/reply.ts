import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailReply: FridayTool = {
	name: "gmail.reply",
	description:
		"Reply to an email thread from Friday's Gmail account. Auto-sets In-Reply-To and References headers.",
	parameters: [
		{
			name: "thread_id",
			type: "string",
			description: "Thread ID to reply to",
			required: true,
		},
		{
			name: "body",
			type: "string",
			description: "Reply body (plain text)",
			required: true,
		},
	],
	clearance: ["network", "email-send"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const threadId = args.thread_id as string;
		if (!threadId)
			return {
				success: false,
				output: "Missing required parameter: thread_id",
			};
		const body = args.body as string;
		if (!body)
			return { success: false, output: "Missing required parameter: body" };

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return {
				success: false,
				output: "Gmail not authenticated. Run /gmail auth to set up.",
			};
		}

		try {
			const result = await client.replyToThread(threadId, body);

			await context.audit.log({
				action: "tool:gmail.reply",
				source: "gmail.reply",
				detail: `Replied to thread ${threadId}`,
				success: true,
			});

			return {
				success: true,
				output: `Reply sent in thread ${threadId} (id: ${result.id})`,
				artifacts: { id: result.id, threadId: result.threadId },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail reply failed: ${msg}` };
		}
	},
};
