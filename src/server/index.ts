import { resolve } from "node:path";
import { FridayRuntime, type RuntimeConfig, type BootStep } from "../core/runtime.ts";
import { WebSocketHandler, type SendFn } from "./handler.ts";
import { SessionHub } from "./session-hub.ts";
import type { ServerMessage } from "./protocol.ts";
import type { ServerWebSocket } from "bun";
import { getTelegramListener } from "../modules/telegram/state.ts";

export interface FridayServerConfig {
	port: number;
	staticDir?: string;
	runtimeConfig?: Partial<RuntimeConfig>;
	onBootProgress?: (step: BootStep, label: string) => void;
}

interface WSData {
	clientId: string;
	handler: WebSocketHandler;
}

const MAX_CONNECTIONS = 10;

export async function createFridayServer(config: FridayServerConfig) {
	const staticDir = config.staticDir ?? resolve("web/dist");
	const allowedOrigins = new Set([
		`http://localhost:${config.port}`,
		"http://localhost:5173",
		`http://127.0.0.1:${config.port}`,
		"http://127.0.0.1:5173",
	]);

	// Boot singleton runtime BEFORE starting the server.
	// Always boot fresh — SessionHub owns session lifecycle (start/save/clear),
	// so loading previous history at boot would leak stale conversations to clients.
	const runtime = new FridayRuntime();
	await runtime.boot(
		{ ...config.runtimeConfig, fresh: true },
		config.onBootProgress,
	);

	const hub = new SessionHub({
		runtime,
		summarizer: runtime.summarizer,
		curator: runtime.curator,
	});
	const pushIntervals = new Map<string, ReturnType<typeof setInterval>>();

	const server = Bun.serve<WSData>({
		port: config.port,
		async fetch(req, server) {
			const url = new URL(req.url);

			// WebSocket upgrade
			if (url.pathname === "/ws") {
				const origin = req.headers.get("origin");
				if (origin && !allowedOrigins.has(origin)) {
					return new Response("Forbidden: invalid origin", { status: 403 });
				}

				if (hub.clientCount >= MAX_CONNECTIONS) {
					return new Response("Service Unavailable: connection limit reached", { status: 503 });
				}

				const clientId = crypto.randomUUID();
				const handler = new WebSocketHandler(runtime, hub, clientId);
				const upgraded = server.upgrade(req, {
					data: { clientId, handler },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			// Telegram webhook handler
			if (req.method === "POST" && url.pathname === "/hooks/telegram") {
				const handler = getTelegramListener()?.getWebhookHandler();
				if (handler) return handler(req);
				return new Response("Telegram webhook not active", { status: 503 });
			}

			// Static file serving (SPA) — guard against path traversal
			const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
			const resolvedPath = resolve(staticDir, `.${filePath}`);
			if (!resolvedPath.startsWith(`${staticDir}/`)) {
				return new Response("Forbidden", { status: 403 });
			}
			const file = Bun.file(resolvedPath);
			if (await file.exists()) {
				return new Response(file);
			}

			// SPA fallback
			const index = Bun.file(resolve(staticDir, "index.html"));
			if (await index.exists()) {
				return new Response(index);
			}

			return new Response(
				"<html><body><h1>Friday Web UI</h1><p>Run <code>cd web && bun run build</code> first.</p></body></html>",
				{ headers: { "Content-Type": "text/html" } },
			);
		},
		websocket: {
			open(_ws: ServerWebSocket<WSData>) {
				// Client registered when they send session:identify
			},
			async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
				if (message instanceof Buffer) {
					// Binary frame = audio data from voice client
					ws.data.handler.handleAudio(message);
					return;
				}

				const raw = typeof message === "string" ? message : message.toString();
				const send: SendFn = (msg: ServerMessage) => {
					try {
						if (ws.readyState === 1) {
							ws.send(JSON.stringify(msg));
						}
					} catch { /* connection may have closed */ }
				};
				await ws.data.handler.handle(raw, send);

				// Set up Sensorium push after identify
				if (
					runtime.isBooted &&
					runtime.sensorium &&
					!pushIntervals.has(ws.data.clientId) &&
					hub.getClientById(ws.data.clientId)
				) {
					const interval = setInterval(() => {
						try {
							if (ws.readyState === 1) {
								ws.data.handler.pushSensoriumUpdate(
									(msg: ServerMessage) => {
										ws.send(JSON.stringify(msg));
									},
								);
							}
						} catch {
							// Connection may have closed
						}
					}, 5000);
					pushIntervals.set(ws.data.clientId, interval);
				}
			},
			close(ws: ServerWebSocket<WSData>) {
				const interval = pushIntervals.get(ws.data.clientId);
				if (interval) {
					clearInterval(interval);
					pushIntervals.delete(ws.data.clientId);
				}
				ws.data.handler.disconnect();
				void hub.unregisterClient(ws.data.clientId);
				// Do NOT shutdown runtime — it's shared!
			},
		},
	});

	return { server, runtime, hub };
}
