export interface GmailMessage {
	id: string;
	threadId: string;
	from: string;
	to: string[];
	cc: string[];
	subject: string;
	date: string;
	snippet: string;
	body: string;
	labels: string[];
	isUnread: boolean;
}

export interface GmailMessageList {
	messages: GmailMessage[];
	nextPageToken?: string;
	resultSizeEstimate: number;
}

export interface GmailLabel {
	id: string;
	name: string;
	type: "system" | "user";
	messagesTotal: number;
	messagesUnread: number;
}
