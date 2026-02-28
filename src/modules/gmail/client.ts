import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { GmailAuth } from "./auth.ts";
import type { GmailMessage, GmailMessageList, GmailLabel } from "./types.ts";

export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

interface MimePart {
	mimeType: string;
	body: { data?: string; size: number };
	parts?: MimePart[];
}

export function decodeMessageBody(parts: MimePart[]): string {
	// Walk MIME tree to find text parts
	const flatParts: MimePart[] = [];
	const walk = (p: MimePart[]) => {
		for (const part of p) {
			if (part.parts) walk(part.parts);
			else flatParts.push(part);
		}
	};
	walk(parts);

	// Prefer text/plain
	const plain = flatParts.find((p) => p.mimeType === "text/plain");
	if (plain?.body?.data) {
		return Buffer.from(plain.body.data, "base64url").toString("utf-8");
	}

	// Fall back to text/html stripped
	const html = flatParts.find((p) => p.mimeType === "text/html");
	if (html?.body?.data) {
		const raw = Buffer.from(html.body.data, "base64url").toString("utf-8");
		return stripHtml(raw);
	}

	return "";
}

function extractHeader(
	headers: gmail_v1.Schema$MessagePartHeader[],
	name: string,
): string {
	return (
		headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
			?.value ?? ""
	);
}

function parseMessage(msg: gmail_v1.Schema$Message): GmailMessage {
	const headers = msg.payload?.headers ?? [];
	const parts: MimePart[] = msg.payload?.parts?.length
		? (msg.payload.parts as MimePart[])
		: msg.payload?.body?.data
			? [
					{
						mimeType: msg.payload.mimeType ?? "text/plain",
						body: msg.payload.body as { data: string; size: number },
					},
				]
			: [];

	return {
		id: msg.id ?? "",
		threadId: msg.threadId ?? "",
		from: extractHeader(headers, "From"),
		to: extractHeader(headers, "To")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		cc: extractHeader(headers, "Cc")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		subject: extractHeader(headers, "Subject"),
		date: extractHeader(headers, "Date"),
		snippet: msg.snippet ?? "",
		body: decodeMessageBody(parts),
		labels: msg.labelIds ?? [],
		isUnread: msg.labelIds?.includes("UNREAD") ?? false,
	};
}

export class GmailClient {
	private auth: GmailAuth;
	private gmail: gmail_v1.Gmail | null = null;

	constructor(auth: GmailAuth) {
		this.auth = auth;
	}

	async initialize(): Promise<boolean> {
		const loaded = await this.auth.loadTokens();
		if (!loaded) return false;
		this.gmail = google.gmail({
			version: "v1",
			auth: this.auth.getClient(),
		});
		return true;
	}

	isAuthenticated(): boolean {
		return this.auth.isAuthenticated() && this.gmail !== null;
	}

	private assertReady(): gmail_v1.Gmail {
		if (!this.gmail) {
			throw new Error(
				"Gmail client not initialized. Run /gmail auth to authenticate.",
			);
		}
		return this.gmail;
	}

	async getMessage(
		id: string,
		format: "full" | "metadata" | "minimal" = "full",
	): Promise<GmailMessage> {
		const gmail = this.assertReady();
		const res = await gmail.users.messages.get({
			userId: "me",
			id,
			format,
		});
		return parseMessage(res.data);
	}

	async listMessages(
		query: string,
		maxResults = 10,
	): Promise<GmailMessageList> {
		const gmail = this.assertReady();
		const listRes = await gmail.users.messages.list({
			userId: "me",
			q: query,
			maxResults,
		});

		const messageIds = listRes.data.messages ?? [];
		const messages: GmailMessage[] = [];

		for (const ref of messageIds) {
			if (!ref.id) continue;
			const res = await gmail.users.messages.get({
				userId: "me",
				id: ref.id,
				format: "metadata",
			});
			const headers = res.data.payload?.headers ?? [];
			messages.push({
				id: res.data.id ?? "",
				threadId: res.data.threadId ?? "",
				from: extractHeader(headers, "From"),
				to: extractHeader(headers, "To")
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean),
				cc: [],
				subject: extractHeader(headers, "Subject"),
				date: extractHeader(headers, "Date"),
				snippet: res.data.snippet ?? "",
				body: "",
				labels: res.data.labelIds ?? [],
				isUnread: res.data.labelIds?.includes("UNREAD") ?? false,
			});
		}

		return {
			messages,
			nextPageToken: listRes.data.nextPageToken ?? undefined,
			resultSizeEstimate: listRes.data.resultSizeEstimate ?? 0,
		};
	}

	async sendMessage(
		to: string,
		subject: string,
		body: string,
		cc?: string,
		bcc?: string,
	): Promise<{ id: string; threadId: string }> {
		const gmail = this.assertReady();
		const lines = [
			`To: ${to}`,
			cc ? `Cc: ${cc}` : "",
			bcc ? `Bcc: ${bcc}` : "",
			`Subject: ${subject}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body,
		].filter(Boolean);

		const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
		const res = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw },
		});
		return {
			id: res.data.id ?? "",
			threadId: res.data.threadId ?? "",
		};
	}

	async replyToThread(
		threadId: string,
		body: string,
	): Promise<{ id: string; threadId: string }> {
		const gmail = this.assertReady();

		// Fetch thread to get headers for In-Reply-To
		const thread = await gmail.users.threads.get({
			userId: "me",
			id: threadId,
		});
		const messages = thread.data.messages ?? [];
		if (messages.length === 0) {
			throw new Error(`Thread "${threadId}" has no messages — cannot reply to an empty thread`);
		}
		const lastMessage = messages[messages.length - 1];
		const headers = lastMessage?.payload?.headers ?? [];
		const messageId = extractHeader(headers, "Message-ID");
		const subject = extractHeader(headers, "Subject");
		const from = extractHeader(headers, "From");

		const lines = [
			`To: ${from}`,
			`Subject: ${subject.startsWith("Re: ") ? subject : `Re: ${subject}`}`,
			`In-Reply-To: ${messageId}`,
			`References: ${messageId}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body,
		];

		const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
		const res = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw, threadId },
		});
		return {
			id: res.data.id ?? "",
			threadId: res.data.threadId ?? "",
		};
	}

	async modifyMessage(
		id: string,
		opts: { addLabels?: string[]; removeLabels?: string[] },
	): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.modify({
			userId: "me",
			id,
			requestBody: {
				addLabelIds: opts.addLabels,
				removeLabelIds: opts.removeLabels,
			},
		});
	}

	async trashMessage(id: string): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.trash({ userId: "me", id });
	}

	async deleteMessage(id: string): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.delete({ userId: "me", id });
	}

	async listLabels(): Promise<GmailLabel[]> {
		const gmail = this.assertReady();
		const res = await gmail.users.labels.list({ userId: "me" });
		return (res.data.labels ?? []).map((l) => ({
			id: l.id ?? "",
			name: l.name ?? "",
			type: l.type === "system" ? ("system" as const) : ("user" as const),
			messagesTotal: l.messagesTotal ?? 0,
			messagesUnread: l.messagesUnread ?? 0,
		}));
	}
}
