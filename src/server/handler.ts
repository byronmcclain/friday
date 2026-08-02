import type { SignalHandler } from "../core/events.ts";
import type { FridayRuntime } from "../core/runtime.ts";
import { FRIDAY_VOICE_IDENTITY } from "../core/voice/prompt.ts";
import { type VoiceSessionConfig, VoiceSessionManager } from "../core/voice/session-manager.ts";
import { type GrokVoice, isGrokVoice, resolveVoiceSilenceMs } from "../core/voice/types.ts";
import { type ClientMessage, parseClientMessage, type ServerMessage } from "./protocol.ts";
import { PushNotificationChannel } from "./push-channel.ts";
import type { SessionHub } from "./session-hub.ts";

export type SendFn = (msg: ServerMessage) => void;

export class WebSocketHandler {
	private runtime: FridayRuntime;
	private hub: SessionHub;
	private clientId: string;
	private channelName: string;
	private defaultSend?: SendFn;
	private voiceSession: VoiceSessionManager | null = null;
	private toolSignalHandler: SignalHandler | null = null;

	constructor(runtime: FridayRuntime, hub: SessionHub, clientId: string) {
		this.runtime = runtime;
		this.hub = hub;
		this.clientId = clientId;
		this.channelName = `websocket-${clientId}`;
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

	disconnect(): void {
		// Remove per-client notification channel on disconnect
		if (this.runtime.notifications) {
			this.runtime.notifications.removeChannel(this.channelName);
		}
		// Unsubscribe tool signal handlers
		if (this.toolSignalHandler && this.runtime.signals) {
			this.runtime.signals.off("tool:executing", this.toolSignalHandler);
			this.runtime.signals.off("tool:completed", this.toolSignalHandler);
			this.toolSignalHandler = null;
		}
		// Stop voice session to close Grok WebSocket on browser disconnect
		if (this.voiceSession) {
			void this.voiceSession.stop();
			this.voiceSession = null;
		}
	}

	handleAudio(audioData: Buffer): void {
		if (!this.voiceSession?.isActive) return;
		const base64 = audioData.toString("base64");
		this.voiceSession.appendAudio(base64);
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
								? Math.round((snapshot.machine.memory.used / snapshot.machine.memory.total) * 100)
								: 0,
					},
					containers: snapshot.containers,
					git: snapshot.dev.git,
					ports: snapshot.dev.ports,
				},
			});
		}
	}

	private wireNotificationChannel(send: SendFn): void {
		if (!this.runtime.notifications) return;
		const channel = new PushNotificationChannel(send);
		channel.name = this.channelName;
		this.runtime.notifications.addChannel(channel);
	}

	private handleIdentify(
		msg: Extract<ClientMessage, { type: "session:identify" }>,
		send: SendFn,
	): void {
		// Clean up prior registrations to prevent signal handler leaks on re-identify
		if (this.toolSignalHandler && this.runtime.signals) {
			this.runtime.signals.off("tool:executing", this.toolSignalHandler);
			this.runtime.signals.off("tool:completed", this.toolSignalHandler);
			this.toolSignalHandler = null;
		}

		const capabilities = new Set<string>(["text"]);
		if (msg.clientType === "voice") {
			capabilities.add("audio-in");
			capabilities.add("audio-out");
		}

		this.defaultSend = send;

		this.hub.registerClient({
			id: this.clientId,
			clientType: msg.clientType,
			send,
			capabilities,
		});

		this.wireNotificationChannel(send);

		// Forward tool signals to this client for TUI thinking indicator
		if (this.runtime.signals) {
			this.toolSignalHandler = (signal) => {
				send({
					type: "signal",
					name: signal.name,
					source: signal.source,
					data: signal.data,
				});
			};
			this.runtime.signals.on("tool:executing", this.toolSignalHandler);
			this.runtime.signals.on("tool:completed", this.toolSignalHandler);
		}

		send({
			type: "session:ready",
			requestId: msg.id,
			model: this.runtime.cortex.modelName,
			capabilities: [...capabilities],
		});
	}

	private handleLegacyBoot(
		msg: Extract<ClientMessage, { type: "session:boot" }>,
		send: SendFn,
	): void {
		// Singleton is already booted. Register client implicitly and respond.
		if (!this.hub.getClientById(this.clientId)) {
			this.defaultSend = send;
			this.hub.registerClient({
				id: this.clientId,
				clientType: "chat",
				send,
				capabilities: new Set(["text"]),
			});

			this.wireNotificationChannel(send);
		}

		send({
			type: "session:booted",
			requestId: msg.id,
			model: this.runtime.cortex.modelName,
			fastModel: this.runtime.fastModel,
		});
	}

	private async handleRuntimeMessage(msg: ClientMessage, send: SendFn): Promise<void> {
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
					this.hub.broadcast(
						{
							type: "conversation:message",
							role: "user",
							content: msg.content,
							source: "chat",
						},
						this.clientId,
					);
					break;
				}

				try {
					const stream = await this.runtime.cortex.chatStream(msg.content);

					// Broadcast user message to other clients
					this.hub.broadcast(
						{
							type: "conversation:message",
							role: "user",
							content: msg.content,
							source: "chat",
						},
						this.clientId,
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
					this.hub.broadcast(
						{
							type: "conversation:message",
							role: "assistant",
							content: fullText,
							source: "chat",
						},
						this.clientId,
					);
				} catch (streamErr) {
					const message = streamErr instanceof Error ? streamErr.message : String(streamErr);
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
				if (this.voiceSession?.isActive) {
					send({
						type: "voice:error",
						code: "SESSION_IN_USE",
						message: "Voice session already active",
					});
					break;
				}

				const requestedVoice = msg.voice;
				const voice: GrokVoice =
					requestedVoice && isGrokVoice(requestedVoice) ? requestedVoice : "Eve";

				const sessionConfig: VoiceSessionConfig = {
					voice,
					sampleRate: 48000,
					instructions: FRIDAY_VOICE_IDENTITY,
					silenceDurationMs: resolveVoiceSilenceMs(),
				};

				this.voiceSession = new VoiceSessionManager(this.runtime.cortex, sessionConfig, {
					onAudioDelta: (base64) => send({ type: "voice:audio", delta: base64 }),
					onTranscriptDelta: (delta, done) => {
						send({
							type: "voice:transcript",
							role: "assistant",
							delta,
							done,
						});
					},
					onStateChange: (state) => send({ type: "voice:state", state }),
					onUserTranscript: (text) => {
						send({
							type: "voice:transcript",
							role: "user",
							delta: text,
							done: true,
						});
						this.hub.broadcast(
							{
								type: "conversation:message",
								role: "user",
								content: text,
								source: "voice",
							},
							this.clientId,
						);
					},
					onAssistantMessage: (text) => {
						this.hub.broadcast(
							{
								type: "conversation:message",
								role: "assistant",
								content: text,
								source: "voice",
							},
							this.clientId,
						);
					},
				});

				try {
					await this.voiceSession.start();
					send({ type: "voice:started", requestId: msg.id });
				} catch (err) {
					send({
						type: "voice:error",
						code: "START_FAILED",
						message: err instanceof Error ? err.message : "Failed to start voice",
					});
				}
				break;
			}
			case "voice:stop": {
				if (this.voiceSession) {
					await this.voiceSession.stop();
					this.voiceSession = null;
				}
				send({ type: "voice:stopped", requestId: msg.id });
				break;
			}
			case "voice:mode": {
				console.warn("[Handler] voice:mode not implemented server-side");
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
				const sessions = await this.runtime.memory.getConversationHistory(msg.count ?? 20);
				send({ type: "history:result", requestId: msg.id, data: sessions });
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
				const session = await this.runtime.memory.getConversationById(msg.sessionId);
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
