import { FridayRuntime, type RuntimeConfig } from "../core/runtime.ts";
import {
	parseClientMessage,
	type ClientMessage,
	type ServerMessage,
} from "./protocol.ts";
import { WebSocketNotificationChannel } from "./ws-channel.ts";

export type SendFn = (msg: ServerMessage) => void;

export class WebSocketHandler {
	private runtime: FridayRuntime;
	private bootConfigDefaults: Partial<RuntimeConfig>;
	private defaultSend?: SendFn;

	constructor(
		runtime: FridayRuntime,
		bootConfigDefaults: Partial<RuntimeConfig> = {},
	) {
		this.runtime = runtime;
		this.bootConfigDefaults = bootConfigDefaults;
	}

	async handle(raw: string, send: SendFn): Promise<void> {
		const msg = parseClientMessage(raw);
		if (!msg) {
			send({
				type: "error",
				code: "INVALID_MESSAGE",
				message: "Failed to parse message",
			});
			return;
		}

		try {
			switch (msg.type) {
				case "session:boot":
					await this.handleBoot(msg, send);
					return;
				case "session:shutdown":
					await this.handleShutdown(msg, send);
					return;
				default:
					await this.handleRuntimeMessage(msg, send);
					return;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			send({
				type: "error",
				requestId: msg.id,
				code: "INTERNAL_ERROR",
				message,
			});
		}
	}

	pushSensoriumUpdate(send?: SendFn): void {
		const sensorium = this.runtime.sensorium;
		if (!sensorium?.currentSnapshot) return;
		const snapshot = sensorium.currentSnapshot;
		const target = send ?? this.defaultSend;
		if (target) {
			target({
				type: "sensorium:update",
				snapshot: {
					timestamp: snapshot.timestamp.toISOString(),
					cpu: snapshot.machine.cpus.usage,
					memory: {
						used: snapshot.machine.memory.used,
						total: snapshot.machine.memory.total,
						percent:
							snapshot.machine.memory.total > 0
								? Math.round(
										(snapshot.machine.memory.used /
											snapshot.machine.memory.total) *
											100,
									)
								: 0,
					},
					containers: snapshot.containers,
					git: snapshot.dev.git,
					ports: snapshot.dev.ports,
				},
			});
		}
	}

	private async handleBoot(
		msg: Extract<ClientMessage, { type: "session:boot" }>,
		send: SendFn,
	): Promise<void> {
		if (this.runtime.isBooted) {
			send({
				type: "error",
				requestId: msg.id,
				code: "ALREADY_BOOTED",
				message: "Runtime already booted",
			});
			return;
		}
		const config: RuntimeConfig = {
			...this.bootConfigDefaults,
			provider: msg.provider ?? this.bootConfigDefaults.provider,
			model: msg.model,
			fastModel: msg.fastModel,
			fresh: msg.fresh,
		};
		await this.runtime.boot(config);
		this.defaultSend = send;
		if (this.runtime.notifications) {
			this.runtime.notifications.addChannel(
				new WebSocketNotificationChannel(send),
			);
		}
		send({
			type: "session:booted",
			requestId: msg.id,
			provider: this.runtime.cortex.providerName,
			model: this.runtime.cortex.modelName,
			fastModel: this.runtime.fastModel,
		});
	}

	private async handleShutdown(
		msg: Extract<ClientMessage, { type: "session:shutdown" }>,
		send: SendFn,
	): Promise<void> {
		if (!this.runtime.isBooted) {
			send({
				type: "error",
				requestId: msg.id,
				code: "NOT_BOOTED",
				message: "Runtime not booted",
			});
			return;
		}
		await this.runtime.shutdown();
		this.defaultSend = undefined;
		send({ type: "session:closed", requestId: msg.id });
	}

	private async handleRuntimeMessage(
		msg: ClientMessage,
		send: SendFn,
	): Promise<void> {
		if (!this.runtime.isBooted) {
			send({
				type: "error",
				requestId: msg.id,
				code: "NOT_BOOTED",
				message: "Runtime not booted. Send session:boot first.",
			});
			return;
		}

		switch (msg.type) {
			case "chat": {
				const result = await this.runtime.process(msg.content);
				send({
					type: "chat:response",
					requestId: msg.id,
					content: result.output,
					source: result.source,
				});
				break;
			}
			case "protocol": {
				const result = await this.runtime.process(msg.command);
				send({
					type: "protocol:response",
					requestId: msg.id,
					content: result.output,
					success: result.source === "protocol",
				});
				break;
			}
			case "history:list": {
				if (!this.runtime.memory) {
					send({
						type: "error",
						requestId: msg.id,
						code: "NO_MEMORY",
						message: "Memory not configured",
					});
					return;
				}
				const sessions = await this.runtime.memory.getConversationHistory(
					msg.count ?? 20,
				);
				send({
					type: "history:result",
					requestId: msg.id,
					data: sessions,
				});
				break;
			}
			case "history:load": {
				if (!this.runtime.memory) {
					send({
						type: "error",
						requestId: msg.id,
						code: "NO_MEMORY",
						message: "Memory not configured",
					});
					return;
				}
				const session = await this.runtime.memory.getConversationById(
					msg.sessionId,
				);
				send({ type: "history:result", requestId: msg.id, data: session });
				break;
			}
			case "smarts:list": {
				if (!this.runtime.smarts) {
					send({
						type: "error",
						requestId: msg.id,
						code: "NO_SMARTS",
						message: "SMARTS not configured",
					});
					return;
				}
				const entries = this.runtime.smarts.all();
				send({ type: "smarts:result", requestId: msg.id, data: entries });
				break;
			}
			case "smarts:search": {
				if (!this.runtime.smarts) {
					send({
						type: "error",
						requestId: msg.id,
						code: "NO_SMARTS",
						message: "SMARTS not configured",
					});
					return;
				}
				const results = await this.runtime.smarts.findRelevant(msg.query);
				send({ type: "smarts:result", requestId: msg.id, data: results });
				break;
			}
		}
	}
}
