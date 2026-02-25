import type {
	FridayProtocol,
	ProtocolContext,
	ProtocolResult,
} from "../types.ts";
import { GmailClient } from "./client.ts";
import { getGmailClient, getGmailAuth, setGmailClient } from "./state.ts";

export const gmailProtocol: FridayProtocol = {
	name: "gmail",
	description:
		"Manage Friday's Gmail — inbox, search, read, send, labels, auth.",
	aliases: ["mail", "email"],
	parameters: [
		{
			name: "subcommand",
			type: "string",
			description:
				"Subcommand: inbox, unread, search, read, send, reply, labels, auth",
			required: true,
		},
		{
			name: "args",
			type: "string",
			description: "Arguments for the subcommand",
			required: false,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		_context: ProtocolContext,
	): Promise<ProtocolResult> {
		const rawArgs = (args.rawArgs as string) ?? "";
		const parts = rawArgs.trim().split(/\s+/);
		const subcommand = parts[0] ?? "inbox";
		const rest = parts.slice(1).join(" ");

		const client = getGmailClient();

		switch (subcommand) {
			case "auth": {
				if (rest === "status") {
					const auth = getGmailAuth();
					if (!auth) {
						return {
							success: false,
							summary:
								"Gmail auth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.",
						};
					}
					const authenticated = auth.isAuthenticated();
					return {
						success: true,
						summary: authenticated
							? "Gmail: authenticated"
							: "Gmail: not authenticated. Run /gmail auth",
					};
				}

				const auth = getGmailAuth();
				if (!auth) {
					return {
						success: false,
						summary:
							"Gmail auth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.",
					};
				}

				const url = auth.generateAuthUrl();
				auth.startLocalCallback()
					.then(async (code) => {
						await auth.exchangeCode(code);
						const newClient = new GmailClient(auth);
						await newClient.initialize();
						setGmailClient(newClient);
					})
					.catch((err) => {
						console.warn("[Gmail] OAuth callback failed:", err instanceof Error ? err.message : err);
					});

				return {
					success: true,
					summary: `Open this URL to authorize Friday's Gmail access:\n\n${url}\n\nWaiting for authorization callback on localhost:3847...`,
					details:
						"After authorizing, the browser will redirect back and tokens will be saved automatically.",
				};
			}

			case "inbox": {
				if (!client?.isAuthenticated()) {
					return {
						success: false,
						summary: "Gmail not authenticated. Run /gmail auth",
					};
				}
				const count = Number.parseInt(rest) || 10;
				const result = await client.listMessages("in:inbox", count);
				const lines = result.messages.map((m) => {
					const u = m.isUnread ? "[U]" : "   ";
					return `${u} ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}  ${m.date}`;
				});
				return {
					success: true,
					summary: `Inbox (${result.messages.length} messages):`,
					details: lines.join("\n"),
				};
			}

			case "unread": {
				if (!client?.isAuthenticated()) {
					return {
						success: false,
						summary: "Gmail not authenticated. Run /gmail auth",
					};
				}
				const result = await client.listMessages("is:unread", 20);
				if (result.messages.length === 0) {
					return { success: true, summary: "No unread messages." };
				}
				const lines = result.messages.map(
					(m) =>
						`  ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}`,
				);
				return {
					success: true,
					summary: `${result.messages.length} unread messages:`,
					details: lines.join("\n"),
				};
			}

			case "search": {
				if (!client?.isAuthenticated()) {
					return {
						success: false,
						summary: "Gmail not authenticated. Run /gmail auth",
					};
				}
				if (!rest) {
					return {
						success: false,
						summary: "Usage: /gmail search <query>",
					};
				}
				const result = await client.listMessages(rest, 20);
				const lines = result.messages.map((m) => {
					const u = m.isUnread ? "[U]" : "   ";
					return `${u} ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}`;
				});
				return {
					success: true,
					summary: `Search "${rest}" — ${result.messages.length} results:`,
					details: lines.join("\n"),
				};
			}

			case "read": {
				if (!client?.isAuthenticated()) {
					return {
						success: false,
						summary: "Gmail not authenticated. Run /gmail auth",
					};
				}
				if (!rest) {
					return {
						success: false,
						summary: "Usage: /gmail read <message-id>",
					};
				}
				const message = await client.getMessage(rest);
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
					summary: `Message ${message.id}:`,
					details: `${header}\n${"─".repeat(60)}\n${message.body}`,
				};
			}

			case "send": {
				return {
					success: false,
					summary:
						"Use the gmail.send tool via natural language (e.g., 'Send an email to...'). Interactive send via protocol is not yet supported.",
				};
			}

			case "reply": {
				return {
					success: false,
					summary:
						"Use the gmail.reply tool via natural language (e.g., 'Reply to thread...'). Interactive reply via protocol is not yet supported.",
				};
			}

			case "labels": {
				if (!client?.isAuthenticated()) {
					return {
						success: false,
						summary: "Gmail not authenticated. Run /gmail auth",
					};
				}
				const labels = await client.listLabels();
				const lines = labels.map((l) => {
					const unread =
						l.messagesUnread > 0
							? ` (${l.messagesUnread} unread)`
							: "";
					return `  ${l.name} [${l.type}] — ${l.messagesTotal} messages${unread}`;
				});
				return {
					success: true,
					summary: `Labels (${labels.length}):`,
					details: lines.join("\n"),
				};
			}

			default:
				return {
					success: false,
					summary: `Unknown subcommand: ${subcommand}. Available: inbox, unread, search, read, send, reply, labels, auth`,
				};
		}
	},
};
