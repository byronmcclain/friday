import type { FridayRuntime } from "../core/runtime.ts";
import {
	parseClientMessage,
	type ClientMessage,
	type ServerMessage,
} from "./protocol.ts";
import { ClientRegistry } from "./client-registry.ts";
import { WebSocketNotificationChannel } from "./ws-channel.ts";
import { VoiceBridge, type VoiceBridgeConfig } from "../core/voice/bridge.ts";
import { FRIDAY_VOICE_IDENTITY } from "../core/voice/prompt.ts";
import type { GrokVoice } from "../core/voice/types.ts";

export type SendFn = (msg: ServerMessage) => void;

export class WebSocketHandler {
	private runtime: FridayRuntime;
	private registry: ClientRegistry;
	private clientId: string;
	private defaultSend?: SendFn;
	private voiceBridge: VoiceBridge | null = null;
	private assistantTranscriptBuffer = "";

	constructor(runtime: FridayRuntime, registry: ClientRegistry, clientId: string) {
		this.runtime = runtime;
		this.registry = registry;
		this.clientId = clientId;
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
				case "session:identify":
					this.handleIdentify(msg, send);
					return;
				case "session:boot":
					// Runtime is already booted (singleton). Respond with ready.
					this.handleLegacyBoot(msg, send);
					return;
				case "session:shutdown":
					// Don't actually shut down the singleton. Just acknowledge.
					send({ type: "session:closed", requestId: msg.id });
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

	handleAudio(audioData: Buffer): void {
		if (!this.voiceBridge?.isActive) return;
		const base64 = audioData.toString("base64");
		this.voiceBridge.appendAudio(base64);
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

	private handleIdentify(
		msg: Extract<ClientMessage, { type: "session:identify" }>,
		send: SendFn,
	): void {
		const capabilities = new Set<string>(["text"]);
		if (msg.clientType === "voice") {
			capabilities.add("audio-in");
			capabilities.add("audio-out");
		}

		this.registry.register({
			id: this.clientId,
			clientType: msg.clientType,
			send,
			capabilities,
		});

		this.defaultSend = send;

		// Wire notification channel for this client
		if (this.runtime.notifications) {
			this.runtime.notifications.addChannel(
				new WebSocketNotificationChannel(send),
			);
		}

		send({
			type: "session:ready",
			requestId: msg.id,
			provider: this.runtime.cortex.providerName,
			model: this.runtime.cortex.modelName,
			capabilities: [...capabilities],
		});
	}

	private handleLegacyBoot(
		msg: Extract<ClientMessage, { type: "session:boot" }>,
		send: SendFn,
	): void {
		// Singleton is already booted. Register client implicitly and respond.
		if (!this.registry.getById(this.clientId)) {
			this.registry.register({
				id: this.clientId,
				clientType: "chat",
				send,
				capabilities: new Set(["text"]),
			});
			this.defaultSend = send;
		}

		send({
			type: "session:booted",
			requestId: msg.id,
			provider: this.runtime.cortex.providerName,
			model: this.runtime.cortex.modelName,
			fastModel: this.runtime.fastModel,
		});
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
				message: "Runtime not booted. Send session:identify first.",
			});
			return;
		}

		switch (msg.type) {
			case "chat": {
				if (this.runtime.protocols.isProtocol(msg.content)) {
					const result = await this.runtime.process(msg.content);
					send({
						type: "chat:response",
						requestId: msg.id,
						content: result.output,
						source: result.source,
					});

					// Broadcast to other clients
					this.registry.broadcast(
						{
							type: "conversation:message",
							role: "user",
							content: msg.content,
							source: "chat",
						},
						(c) => c.id !== this.clientId,
					);
					break;
				}

				try {
					const stream = await this.runtime.cortex.chatStream(msg.content);

					// Broadcast user message to other clients
					this.registry.broadcast(
						{
							type: "conversation:message",
							role: "user",
							content: msg.content,
							source: "chat",
						},
						(c) => c.id !== this.clientId,
					);

					for await (const chunk of stream.textStream) {
						send({
							type: "chat:chunk",
							requestId: msg.id,
							text: chunk,
						});
					}
					const fullText = await stream.fullText;
					send({
						type: "chat:response",
						requestId: msg.id,
						content: fullText,
						source: "cortex",
					});

					// Broadcast assistant response to other clients
					this.registry.broadcast(
						{
							type: "conversation:message",
							role: "assistant",
							content: fullText,
							source: "chat",
						},
						(c) => c.id !== this.clientId,
					);
				} catch (streamErr) {
					const message =
						streamErr instanceof Error
							? streamErr.message
							: String(streamErr);
					send({
						type: "error",
						requestId: msg.id,
						code: "STREAM_ERROR",
						message,
					});
				}
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
			case "voice:start": {
				if (this.voiceBridge?.isActive) {
					send({
						type: "voice:error",
						code: "SESSION_IN_USE",
						message: "Voice session already active",
					});
					break;
				}

				this.assistantTranscriptBuffer = "";

				const voiceConfig: VoiceBridgeConfig = {
					voice: ((msg as any).voice ?? "Eve") as GrokVoice,
					sampleRate: 48000,
					instructions: FRIDAY_VOICE_IDENTITY,
				};

				this.voiceBridge = new VoiceBridge(
					this.runtime.cortex,
					voiceConfig,
					{
						onAudioDelta: (base64) =>
							send({ type: "voice:audio", delta: base64 }),
						onTranscriptDelta: (delta, done) => {
							if (!done) {
								this.assistantTranscriptBuffer += delta;
							}
							send({
								type: "voice:transcript",
								role: "assistant",
								delta,
								done,
							});
							if (done) {
								this.registry.broadcast(
									{
										type: "conversation:message",
										role: "assistant",
										content: this.assistantTranscriptBuffer,
										source: "voice",
									},
									(c) => c.id !== this.clientId,
								);
								this.assistantTranscriptBuffer = "";
							}
						},
						onStateChange: (state) =>
							send({ type: "voice:state", state }),
						onUserTranscript: (text) => {
							send({
								type: "voice:transcript",
								role: "user",
								delta: text,
								done: true,
							});
							this.registry.broadcast(
								{
									type: "conversation:message",
									role: "user",
									content: text,
									source: "voice",
								},
								(c) => c.id !== this.clientId,
							);
						},
					},
				);

				try {
					await this.voiceBridge.start();
					send({ type: "voice:started", requestId: msg.id });
				} catch (err) {
					send({
						type: "voice:error",
						code: "START_FAILED",
						message:
							err instanceof Error
								? err.message
								: "Failed to start voice",
					});
				}
				break;
			}
			case "voice:stop": {
				if (this.voiceBridge) {
					await this.voiceBridge.stop();
					this.voiceBridge = null;
				}
				send({ type: "voice:stopped", requestId: msg.id });
				break;
			}
			case "voice:mode": {
				// Voice mode switching handled by the client-side session
				break;
			}
			case "history:list": {
				if (!this.runtime.memory) {
					send({ type: "error", requestId: msg.id, code: "NO_MEMORY", message: "Memory not configured" });
					return;
				}
				const sessions = await this.runtime.memory.getConversationHistory(msg.count ?? 20);
				send({ type: "history:result", requestId: msg.id, data: sessions });
				break;
			}
			case "history:load": {
				if (!this.runtime.memory) {
					send({ type: "error", requestId: msg.id, code: "NO_MEMORY", message: "Memory not configured" });
					return;
				}
				const session = await this.runtime.memory.getConversationById(msg.sessionId);
				send({ type: "history:result", requestId: msg.id, data: session });
				break;
			}
			case "smarts:list": {
				if (!this.runtime.smarts) {
					send({ type: "error", requestId: msg.id, code: "NO_SMARTS", message: "SMARTS not configured" });
					return;
				}
				const entries = this.runtime.smarts.all();
				send({ type: "smarts:result", requestId: msg.id, data: entries });
				break;
			}
			case "smarts:search": {
				if (!this.runtime.smarts) {
					send({ type: "error", requestId: msg.id, code: "NO_SMARTS", message: "SMARTS not configured" });
					return;
				}
				const results = await this.runtime.smarts.findRelevant(msg.query);
				send({ type: "smarts:result", requestId: msg.id, data: results });
				break;
			}
		}
	}
}
