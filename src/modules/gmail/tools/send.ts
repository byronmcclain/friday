import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailSend: FridayTool = {
	name: "gmail.send",
	description: "Send an email from Friday's Gmail account.",
	parameters: [
		{
			name: "to",
			type: "string",
			description: "Recipient email address",
			required: true,
		},
		{
			name: "subject",
			type: "string",
			description: "Email subject",
			required: true,
		},
		{
			name: "body",
			type: "string",
			description: "Email body (plain text)",
			required: true,
		},
		{
			name: "cc",
			type: "string",
			description: "CC recipients (comma-separated)",
			required: false,
		},
		{
			name: "bcc",
			type: "string",
			description: "BCC recipients (comma-separated)",
			required: false,
		},
	],
	clearance: ["network", "email-send"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const to = args.to as string;
		if (!to)
			return { success: false, output: "Missing required parameter: to" };
		const subject = args.subject as string;
		if (!subject)
			return {
				success: false,
				output: "Missing required parameter: subject",
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
			const result = await client.sendMessage(
				to,
				subject,
				body,
				args.cc as string,
				args.bcc as string,
			);

			await context.audit.log({
				action: "tool:gmail.send",
				source: "gmail.send",
				detail: `Sent email to ${to}: ${subject}`,
				success: true,
			});

			return {
				success: true,
				output: `Email sent to ${to}: "${subject}" (id: ${result.id})`,
				artifacts: { id: result.id, threadId: result.threadId },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail send failed: ${msg}` };
		}
	},
};
