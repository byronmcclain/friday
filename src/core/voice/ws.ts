import { GROK_REALTIME_URL } from "./types.ts";

/**
 * Open an authenticated WebSocket to the Grok realtime API.
 * Resolves with the connected WebSocket, or rejects on timeout/error.
 */
export function openGrokWebSocket(
	apiKey: string,
	timeoutMs = 10_000,
): Promise<WebSocket> {
	return new Promise<WebSocket>((resolve, reject) => {
		const ws = new WebSocket(GROK_REALTIME_URL, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		} as any);

		const timer = setTimeout(() => {
			try {
				ws.close();
			} catch {}
			reject(new Error("Grok voice connection timeout"));
		}, timeoutMs);

		ws.addEventListener("open", () => {
			clearTimeout(timer);
			resolve(ws);
		});
		ws.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("Grok voice connection error"));
		});
	});
}
