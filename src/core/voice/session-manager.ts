import type { Cortex } from "../cortex.ts";
import type { GrokVoice } from "./types.ts";
import { VoiceWorker } from "../workers/voice-worker.ts";
import { openGrokWebSocket } from "./ws.ts";

export type VoiceState =
	| "idle"
	| "listening"
	| "thinking"
	| "speaking"
	| "error";

export interface VoiceSessionConfig {
	voice: GrokVoice;
	sampleRate: number;
	instructions: string;
	debug?: boolean;
}

export interface VoiceSessionCallbacks {
	onAudioDelta: (base64: string) => void;
	onTranscriptDelta: (text: string, done: boolean) => void;
	onStateChange: (state: VoiceState) => void;
	onUserTranscript: (text: string) => void;
	onAssistantMessage?: (fullText: string) => void;
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

	constructor(
		cortex: Cortex,
		config: VoiceSessionConfig,
		callbacks: VoiceSessionCallbacks,
	) {
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

		this.active = true;
		this._generation++;
		const gen = this._generation;
		this._lastState = "idle";
		this.callbacks.onStateChange("idle");

		const ws = await openGrokWebSocket(apiKey);
		this.grokWs = ws;

		// Initial session config: voice, VAD, audio format
		// Tools and instructions are sent per-turn by VoiceWorker via session.update
		ws.send(
			JSON.stringify({
				type: "session.update",
				session: {
					voice: this.config.voice,
					instructions: this.config.instructions,
					turn_detection: {
						type: "server_vad",
						create_response: false,
					},
					input_audio_transcription: { model: "whisper-1" },
					audio: {
						input: {
							format: {
								type: "audio/pcm",
								rate: this.config.sampleRate,
							},
						},
						output: {
							format: {
								type: "audio/pcm",
								rate: this.config.sampleRate,
							},
						},
					},
				},
			}),
		);

		// Create VoiceWorker with send bound to this WebSocket
		this.voiceWorker = new VoiceWorker({
			send: (data) => this.sendToGrok(data),
		});

		ws.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				void this.handleGrokMessage(event.data);
			}
		});

		ws.addEventListener("error", () => {
			if (this._generation !== gen) return;
			this.active = false;
			this._lastState = "error";
			this.callbacks.onStateChange("error");
		});

		ws.addEventListener("close", () => {
			if (this._generation !== gen) return;
			this.grokWs = null;
			if (this.active) {
				this.active = false;
				this._lastState = "idle";
				this.callbacks.onStateChange("idle");
			}
		});
	}

	appendAudio(pcmBase64: string): void {
		if (!this.active) return;
		// Template literal avoids JSON.stringify on every audio frame (~50-100Hz).
		// Base64 chars [A-Za-z0-9+/=] need no JSON escaping.
		this.sendToGrok(
			`{"type":"input_audio_buffer.append","audio":"${pcmBase64}"}`,
		);
	}

	async stop(): Promise<void> {
		this.active = false;
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
				if (!this.voiceWorker?.isProcessing) {
					this.log("AUTO_RESPONSE", "cancelling unexpected auto-response");
					this.sendToGrok(CANCEL_RESPONSE_MSG);
				}
				break;
			}

			// -- Session lifecycle (no-op events)
			case "session.updated":
			case "input_audio_buffer.committed":
			case "conversation.item.created": {
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
					const status = data.response?.status ?? "completed";
					if (
						status !== "cancelled" &&
						!this.voiceWorker?.isProcessing
					) {
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
			const stream = await this.cortex.chatStreamVoice(
				transcript,
				this.voiceWorker,
			);
			await stream.fullText;
		} catch (err) {
			this.log(
				"ERROR",
				err instanceof Error ? err.message : String(err),
			);
			this.emitStateChange("error");
		} finally {
			this._activeTurn = null;
		}
	}
}
