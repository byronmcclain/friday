import type { GmailClient } from "./client.ts";
import type { GmailAuth } from "./auth.ts";

let client: GmailClient | null = null;
let auth: GmailAuth | null = null;

export function getGmailClient(): GmailClient | null {
	return client;
}

export function setGmailClient(c: GmailClient | null): void {
	client = c;
}

export function getGmailAuth(): GmailAuth | null {
	return auth;
}

export function setGmailAuth(a: GmailAuth | null): void {
	auth = a;
}
