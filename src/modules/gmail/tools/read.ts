import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailRead: FridayTool = {
	name: "gmail.read",
	description:
		"Read a specific email from Friday's Gmail by message ID. Returns full body, headers, and attachment metadata.",
	parameters: [
		{
			name: "id",
			type: "string",
			description: "Message ID (from gmail.search results)",
			required: true,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const id = args.id as string;
		if (!id) {
			return { success: false, output: "Missing required parameter: id" };
		}

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return {
				success: false,
				output: "Gmail not authenticated. Run /gmail auth to set up.",
			};
		}

		try {
			const message = await client.getMessage(id);

			await context.audit.log({
				action: "tool:gmail.read",
				source: "gmail.read",
				detail: `Read message: ${message.subject}`,
				success: true,
			});

			const header = [
				`From: ${message.from}`,
				`To: ${message.to.join(", ")}`,
				message.cc.length ? `Cc: ${message.cc.join(", ")}` : "",
				`Subject: ${message.subject}`,
				`Date: ${message.date}`,
				`Labels: ${message.labels.join(", ")}`,
			]
				.filter(Boolean)
				.join("\n");

			return {
				success: true,
				output: `${header}\n${"─".repeat(60)}\n${message.body}`,
				artifacts: { message },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail read failed: ${msg}` };
		}
	},
};
