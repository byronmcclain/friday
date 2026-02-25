import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

const VALID_ACTIONS = [
	"archive",
	"trash",
	"delete",
	"mark_read",
	"mark_unread",
	"label",
	"unlabel",
] as const;
type ModifyAction = (typeof VALID_ACTIONS)[number];

export const gmailModify: FridayTool = {
	name: "gmail.modify",
	description:
		'Modify a Gmail message: archive, trash, delete, mark_read, mark_unread, label, or unlabel.',
	parameters: [
		{
			name: "id",
			type: "string",
			description: "Message ID",
			required: true,
		},
		{
			name: "action",
			type: "string",
			description:
				'Action: "archive", "trash", "delete", "mark_read", "mark_unread", "label", "unlabel"',
			required: true,
		},
		{
			name: "label",
			type: "string",
			description: 'Label name (required for "label" and "unlabel" actions)',
			required: false,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const id = args.id as string;
		if (!id)
			return { success: false, output: "Missing required parameter: id" };
		const action = args.action as string;
		if (!action)
			return {
				success: false,
				output: "Missing required parameter: action",
			};

		if (!VALID_ACTIONS.includes(action as ModifyAction)) {
			return {
				success: false,
				output: `Invalid action: "${action}". Use one of: ${VALID_ACTIONS.join(", ")}`,
			};
		}

		if ((action === "label" || action === "unlabel") && !args.label) {
			return {
				success: false,
				output: `Missing required parameter: label (required for "${action}" action)`,
			};
		}

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return {
				success: false,
				output: "Gmail not authenticated. Run /gmail auth to set up.",
			};
		}

		try {
			const label = args.label as string;

			switch (action as ModifyAction) {
				case "archive":
					await client.modifyMessage(id, {
						removeLabels: ["INBOX"],
					});
					break;
				case "trash":
					await client.trashMessage(id);
					break;
				case "delete":
					await client.deleteMessage(id);
					break;
				case "mark_read":
					await client.modifyMessage(id, {
						removeLabels: ["UNREAD"],
					});
					break;
				case "mark_unread":
					await client.modifyMessage(id, { addLabels: ["UNREAD"] });
					break;
				case "label":
					await client.modifyMessage(id, { addLabels: [label] });
					break;
				case "unlabel":
					await client.modifyMessage(id, {
						removeLabels: [label],
					});
					break;
			}

			await context.audit.log({
				action: "tool:gmail.modify",
				source: "gmail.modify",
				detail: `Modified message ${id}: ${action}${label ? ` (${label})` : ""}`,
				success: true,
			});

			return {
				success: true,
				output: `Message ${id}: ${action} applied${label ? ` (label: ${label})` : ""}`,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail modify failed: ${msg}` };
		}
	},
};
