import type { TelegramClient } from "./client.ts";
import type { TelegramListener } from "./listener.ts";

let client: TelegramClient | null = null;
let listener: TelegramListener | null = null;

export function getTelegramClient(): TelegramClient | null {
	return client;
}
export function setTelegramClient(c: TelegramClient | null): void {
	client = c;
}
export function getTelegramListener(): TelegramListener | null {
	return listener;
}
export function setTelegramListener(l: TelegramListener | null): void {
	listener = l;
}
