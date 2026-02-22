import { resolve } from "node:path";
import { FridayRuntime, type RuntimeConfig } from "../core/runtime.ts";
import { WebSocketHandler, type SendFn } from "./handler.ts";
import type { ServerMessage } from "./protocol.ts";
import type { ServerWebSocket } from "bun";

export interface FridayServerConfig {
	port: number;
	staticDir?: string;
	runtimeConfig?: Partial<RuntimeConfig>;
}

interface WSData {
	handler: WebSocketHandler;
	runtime: FridayRuntime;
	pushInterval?: ReturnType<typeof setInterval>;
}

export function createFridayServer(config: FridayServerConfig) {
	const staticDir = config.staticDir ?? resolve("web/dist");
	const allowedOrigins = new Set([
		`http://localhost:${config.port}`,
		"http://localhost:5173",
		`http://127.0.0.1:${config.port}`,
		"http://127.0.0.1:5173",
	]);

	const server = Bun.serve<WSData>({
		port: config.port,
		async fetch(req, server) {
			const url = new URL(req.url);

			// WebSocket upgrade
			if (url.pathname === "/ws") {
				const origin = req.headers.get("origin");
				if (origin && !allowedOrigins.has(origin)) {
					return new Response("Forbidden: invalid origin", {
						status: 403,
					});
				}

				const runtime = new FridayRuntime();
				const handler = new WebSocketHandler(runtime, config.runtimeConfig);
				const upgraded = server.upgrade(req, {
					data: { handler, runtime },
				});
				if (upgraded) return undefined;
				return new Response("WebSocket upgrade failed", { status: 400 });
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

			// SPA fallback: serve index.html for all non-file routes
			const index = Bun.file(resolve(staticDir, "index.html"));
			if (await index.exists()) {
				return new Response(index);
			}

			// Dev mode placeholder when web/dist doesn't exist
			return new Response(
				"<html><body><h1>Friday Web UI</h1><p>Run <code>cd web && bun run build</code> first.</p></body></html>",
				{ headers: { "Content-Type": "text/html" } },
			);
		},
		websocket: {
			open(_ws: ServerWebSocket<WSData>) {
				// Connection opened — nothing to do until client sends session:boot
			},
			async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
				const raw =
					typeof message === "string" ? message : message.toString();
				const send: SendFn = (msg: ServerMessage) => {
					ws.send(JSON.stringify(msg));
				};
				await ws.data.handler.handle(raw, send);

				// After handling, check if runtime just booted and set up Sensorium push
				if (
					ws.data.runtime.isBooted &&
					ws.data.runtime.sensorium &&
					!ws.data.pushInterval
				) {
					ws.data.pushInterval = setInterval(() => {
						try {
							if (ws.readyState === 1) {
								ws.data.handler.pushSensoriumUpdate(
									(msg: ServerMessage) => {
										ws.send(JSON.stringify(msg));
									},
								);
							}
						} catch {
							// Connection may have closed between check and send
						}
					}, 5000);
				}
			},
			close(ws: ServerWebSocket<WSData>) {
				// Clean up Sensorium push interval
				if (ws.data.pushInterval) {
					clearInterval(ws.data.pushInterval);
				}
				// Auto-shutdown runtime if still booted
				if (ws.data.runtime.isBooted) {
					ws.data.runtime.shutdown().catch(() => {});
				}
			},
		},
	});

	return server;
}
