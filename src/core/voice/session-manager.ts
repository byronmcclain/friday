import type { Cortex } from "../cortex.ts";
import { VoiceWorker } from "../workers/voice-worker.ts";
import { buildForceMessagePayload, VOICE_SESSION_GREETING } from "./force-message.ts";
import type { GrokVoice } from "./types.ts";
import { openGrokWebSocket } from "./ws.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "reconnecting" | "error";

export interface VoiceSessionConfig {
	voice: GrokVoice;
	sampleRate: number;
	instructions: string;
	silenceDurationMs: number;
	debug?: boolean;
}

export function buildInitialSessionPayload(config: VoiceSessionConfig) {
	return {
		type: "session.update" as const,
		session: {
			voice: config.voice,
			instructions: config.instructions,
			resumption: { enabled: true },
			turn_detection: {
				type: "server_vad" as const,
				create_response: false,
				silence_duration_ms: config.silenceDurationMs,
			},
			input_audio_transcription: { model: "whisper-1" },
			audio: {
				input: { format: { type: "audio/pcm", rate: config.sampleRate } },
				output: { format: { type: "audio/pcm", rate: config.sampleRate } },
			},
		},
	};
}

export interface VoiceSessionCallbacks {
	onAudioDelta: (base64: string) => void;
	onTranscriptDelta: (text: string, done: boolean) => void;
	onStateChange: (state: VoiceState) => void;
	onUserTranscript: (text: string) => void;
	onAssistantMessage?: (fullText: string) => void;
	/** Fired when the session dies permanently (e.g. reconnect attempts exhausted). */
	onSessionError?: (code: string, message: string) => void;
}

const CANCEL_RESPONSE_MSG = JSON.stringify({ type: "response.cancel" });

/**
 * VoiceSessionManager -- thin audio I/O + lifecycle layer.
 *
 * Replaces VoiceBridge. Manages the Grok WebSocket, handles VAD events,
 * and routes transcripts through Cortex.chatStreamVoice() for native
 * Grok agent processing (reasoning + tool calling + speech).
 */
export class VoiceSessionManager {
	private grokWs: WebSocket | null = null;
	private cortex: Cortex;
	private config: VoiceSessionConfig;
	private callbacks: VoiceSessionCallbacks;
	private active = false;
	private _generation = 0;
	private _lastState: VoiceState = "idle";
	private _activeTurn: Promise<void> | null = null;
	private _assistantBuffer = "";
	private voiceWorker: VoiceWorker | null = null;
	private debug: boolean;
	private _conversationId: string | null = null;
	private _greeted = false;
	/** True from the moment the greeting force_message is sent until Grok acks it with response.created. */
	private _pendingGreeting = false;
	/** Response id of the in-flight greeting turn, so response.done can clear it precisely. */
	private _pendingGreetingResponseId: string | null = null;
	private _reconnectDelaysMs = [500, 1000, 2000, 4000, 8000];
	private _apiKey = "";
	private _openSocket = (opts?: { conversationId?: string }) =>
		openGrokWebSocket(this._apiKey, 10_000, {
			conversationId: opts?.conversationId,
		});

	constructor(cortex: Cortex, config: VoiceSessionConfig, callbacks: VoiceSessionCallbacks) {
		this.cortex = cortex;
		this.config = config;
		this.callbacks = callbacks;
		this.debug = config.debug ?? false;
	}

	private log(tag: string, ...args: unknown[]): void {
		if (!this.debug) return;
		console.log(`[VoiceSession:${tag}]`, ...args);
	}

	get isActive(): boolean {
		return this.active;
	}

	/** Emit state change only on transitions (prevents flooding on audio deltas). */
	private emitStateChange(state: VoiceState): void {
		if (state === this._lastState) return;
		this._lastState = state;
		this.callbacks.onStateChange(state);
	}

	private sendToGrok(payload: string): void {
		if (this.grokWs && this.grokWs.readyState === 1) {
			this.grokWs.send(payload);
		}
	}

	async start(): Promise<void> {
		if (this.active) throw new Error("Voice session already active");

		const apiKey = process.env.XAI_API_KEY;
		if (!apiKey) throw new Error("XAI_API_KEY not set");
		this._apiKey = apiKey;

		this._conversationId = null;
		this._greeted = false;
		this._pendingGreeting = false;
		this._pendingGreetingResponseId = null;
		this.active = true;
		this._generation++;
		const gen = this._generation;
		this._lastState = "idle";
		this.callbacks.onStateChange("idle");

		const ws = await openGrokWebSocket(apiKey);
		this.grokWs = ws;

		// Initial session config: voice, VAD, audio format
		// Tools and instructions are sent per-turn by VoiceWorker via session.update
		ws.send(JSON.stringify(buildInitialSessionPayload(this.config)));

		// Create VoiceWorker with send bound to this WebSocket
		this.voiceWorker = new VoiceWorker({
			send: (data) => this.sendToGrok(data),
		});

		this.bindSocketHandlers(ws, gen);
	}

	/** Wire message/error/close listeners for a Grok WebSocket. Shared by start() and reconnect. */
	private bindSocketHandlers(ws: WebSocket, gen: number): void {
		ws.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				void this.handleGrokMessage(event.data);
			}
		});

		ws.addEventListener("error", () => {
			if (this._generation !== gen) return;
			// Chosen approach: do nothing here (and, crucially, do NOT set
			// `active = false`). Per the WHATWG WebSocket spec, an "error"
			// event is always followed by a "close" event, and all
			// reconnect-with-backoff logic lives in handleSocketClose().
			// Killing `active` here would make handleSocketClose() bail out
			// immediately, so a typical network failure (which surfaces as
			// error -> close) would never trigger reconnection.
			this.log("WS_ERROR", "socket error; deferring to close handler for reconnect");
		});

		ws.addEventListener("close", () => {
			void this.handleSocketClose(gen);
		});
	}

	/**
	 * Handle an unexpected (or intentional) socket close for generation `gen`.
	 * If the session is still active, attempt to reconnect with backoff,
	 * re-establishing the session and opting back into resumption.
	 */
	private async handleSocketClose(gen: number): Promise<void> {
		if (this._generation !== gen) return;
		this.grokWs = null;
		if (!this.active) return;

		// The socket is gone, so any in-flight VoiceWorker turn is now orphaned:
		// it will never receive the remaining Grok events (e.g. response.done)
		// needed to resolve its promise, since handleGrokMessage will route
		// future events to whatever VoiceWorker we create after reconnecting.
		// Abort it now — mirrors what stop() does for the worker — so its
		// push streams close out, `_activeTurn` settles, and a later stop()
		// can't hang forever awaiting a promise that will never resolve.
		if (this.voiceWorker) {
			this.voiceWorker.abort();
			this.voiceWorker = null;
		}
		this._activeTurn = null;
		this._assistantBuffer = "";

		this.emitStateChange("reconnecting");
		for (const delay of this._reconnectDelaysMs) {
			if (this._generation !== gen || !this.active) return;
			if (delay > 0) await Bun.sleep(delay);
			if (this._generation !== gen || !this.active) return;
			this.log("RECONNECT", "attempting reconnect", {
				hasConversationId: this._conversationId != null,
			});
			try {
				const ws = await this._openSocket({
					conversationId: this._conversationId ?? undefined,
				});
				if (this._generation !== gen || !this.active) {
					try {
						ws.close();
					} catch {}
					return;
				}
				this.grokWs = ws;
				this.bindSocketHandlers(ws, gen);
				ws.send(JSON.stringify(buildInitialSessionPayload(this.config)));
				this.voiceWorker = new VoiceWorker({ send: (d) => this.sendToGrok(d) });
				this.emitStateChange("listening");
				return;
			} catch {
				// Drop a potentially stale/rejected conversation id so the next
				// attempt opens a fresh session instead of retrying with the
				// same id for every remaining attempt.
				this._conversationId = null;
			}
		}
		this.active = false;
		this.emitStateChange("error");
		this.callbacks.onSessionError?.(
			"RECONNECT_FAILED",
			"Unable to reconnect to voice session after multiple attempts",
		);
	}

	appendAudio(pcmBase64: string): void {
		if (!this.active) return;
		// Template literal avoids JSON.stringify on every audio frame (~50-100Hz).
		// Base64 chars [A-Za-z0-9+/=] need no JSON escaping.
		this.sendToGrok(`{"type":"input_audio_buffer.append","audio":"${pcmBase64}"}`);
	}

	async stop(): Promise<void> {
		this.active = false;
		this._greeted = false;
		this._pendingGreeting = false;
		this._pendingGreetingResponseId = null;
		if (this.voiceWorker) {
			this.voiceWorker.abort();
			this.voiceWorker = null;
		}
		// Wait for in-flight turn to drain before closing the WebSocket
		if (this._activeTurn) {
			await this._activeTurn;
			this._activeTurn = null;
		}
		if (this.grokWs) {
			try {
				this.grokWs.close();
			} catch {}
			this.grokWs = null;
		}
		this._assistantBuffer = "";
		this._lastState = "idle";
		this.callbacks.onStateChange("idle");
	}

	private async handleGrokMessage(raw: string): Promise<void> {
		let data: Record<string, any>;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		if (this.debug && data.type !== "response.output_audio.delta") {
			this.log("EVENT", data.type, raw.slice(0, 500));
		}

		switch (data.type) {
			// -- VAD events (barge-in: cancel current response immediately)
			case "input_audio_buffer.speech_started": {
				if (this.voiceWorker?.isProcessing) {
					this.sendToGrok(CANCEL_RESPONSE_MSG);
					this.voiceWorker.abort();
				}
				this.emitStateChange("listening");
				break;
			}
			case "input_audio_buffer.speech_stopped": {
				this.emitStateChange("thinking");
				break;
			}

			// -- Transcript -> Cortex voice pathway
			case "conversation.item.input_audio_transcription.completed": {
				const transcript = data.transcript?.trim();
				if (transcript && !this.voiceWorker?.isProcessing) {
					this.callbacks.onUserTranscript(transcript);
					// Cancel any auto-response (create_response:false is unreliable)
					this.sendToGrok(CANCEL_RESPONSE_MSG);
					this._activeTurn = this.processVoiceTurn(transcript);
					await this._activeTurn;
				}
				break;
			}

			// -- Auto-response suppression
			case "response.created": {
				if (this._pendingGreeting) {
					// This is Grok's response to our own force_message greeting, not
					// an unexpected auto-response -- let it play out uncancelled.
					this._pendingGreeting = false;
					this._pendingGreetingResponseId = data.response?.id ?? null;
					break;
				}
				if (!this.voiceWorker?.isProcessing) {
					this.log("AUTO_RESPONSE", "cancelling unexpected auto-response");
					this.sendToGrok(CANCEL_RESPONSE_MSG);
				}
				break;
			}

			// -- Session lifecycle
			case "session.updated": {
				if (!this._greeted) {
					this._greeted = true;
					this._pendingGreeting = true;
					this.sendToGrok(
						JSON.stringify(
							buildForceMessagePayload(VOICE_SESSION_GREETING, { interruptible: true }),
						),
					);
				}
				break;
			}
			case "input_audio_buffer.committed":
			case "conversation.item.created": {
				break;
			}

			case "conversation.created": {
				const id = data.conversation?.id;
				if (typeof id === "string" && id.length > 0) this._conversationId = id;
				break;
			}

			// -- Audio + transcript (from Grok agent response)
			case "response.output_audio.delta": {
				if (data.delta) {
					this.emitStateChange("speaking");
					this.callbacks.onAudioDelta(data.delta);
				}
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.delta": {
				if (data.delta) {
					this._assistantBuffer += data.delta;
					this.callbacks.onTranscriptDelta(data.delta, false);
				}
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.done": {
				this.callbacks.onTranscriptDelta("", true);
				if (this._assistantBuffer) {
					this.callbacks.onAssistantMessage?.(this._assistantBuffer);
				}
				this._assistantBuffer = "";
				break;
			}

			// -- Function calls + response lifecycle
			case "response.function_call_arguments.done":
			case "response.done": {
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				if (data.type === "response.done") {
					if (
						this._pendingGreetingResponseId &&
						data.response?.id === this._pendingGreetingResponseId
					) {
						this._pendingGreetingResponseId = null;
					}
					const status = data.response?.status ?? "completed";
					if (status !== "cancelled" && !this.voiceWorker?.isProcessing) {
						this.emitStateChange("idle");
					}
				}
				break;
			}

			case "error": {
				this.log("ERROR", JSON.stringify(data));
				this.emitStateChange("error");
				break;
			}
		}
	}

	private async processVoiceTurn(transcript: string): Promise<void> {
		if (!this.voiceWorker) return;
		this.emitStateChange("thinking");

		try {
			const stream = await this.cortex.chatStreamVoice(transcript, this.voiceWorker);
			await stream.fullText;
		} catch (err) {
			this.log("ERROR", err instanceof Error ? err.message : String(err));
			this.emitStateChange("error");
		} finally {
			this._activeTurn = null;
		}
	}
}
