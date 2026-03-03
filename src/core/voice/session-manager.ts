import type { Cortex } from "../cortex.ts";
import { type GrokVoice, VOX_WS_URL } from "./types.ts";
import { VoiceWorker } from "../workers/voice-worker.ts";

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
}

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
	private _processingUtterance = false;
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
		this.callbacks.onStateChange("idle");

		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(VOX_WS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			} as any);

			const timeout = setTimeout(() => {
				reject(new Error("Grok voice connection timeout"));
				try {
					ws.close();
				} catch {}
			}, 10000);

			ws.addEventListener("open", () => {
				clearTimeout(timeout);
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

				this.callbacks.onStateChange("idle");
				resolve();
			});

			ws.addEventListener("message", (event) => {
				if (typeof event.data === "string") {
					void this.handleGrokMessage(event.data);
				}
			});

			ws.addEventListener("error", () => {
				clearTimeout(timeout);
				if (this._generation !== gen) return;
				this.active = false;
				this.callbacks.onStateChange("error");
				reject(new Error("Grok voice connection error"));
			});

			ws.addEventListener("close", () => {
				if (this._generation !== gen) return;
				this.grokWs = null;
				if (this.active) {
					this.active = false;
					this.callbacks.onStateChange("idle");
				}
			});
		});
	}

	appendAudio(pcmBase64: string): void {
		if (!this.grokWs || !this.active) return;
		this.grokWs.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: pcmBase64,
			}),
		);
	}

	async stop(): Promise<void> {
		this.active = false;
		this._processingUtterance = false;
		if (this.voiceWorker) {
			this.voiceWorker.abort();
			this.voiceWorker = null;
		}
		if (this.grokWs) {
			try {
				this.grokWs.close();
			} catch {}
			this.grokWs = null;
		}
		this.callbacks.onStateChange("idle");
	}

	private async handleGrokMessage(raw: string): Promise<void> {
		let data: Record<string, any>;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		if (data.type !== "response.output_audio.delta") {
			this.log("EVENT", data.type, raw.slice(0, 500));
		}

		switch (data.type) {
			// -- VAD events
			case "input_audio_buffer.speech_started": {
				this.callbacks.onStateChange("listening");
				break;
			}
			case "input_audio_buffer.speech_stopped": {
				this.callbacks.onStateChange("thinking");
				break;
			}

			// -- Transcript -> Cortex voice pathway
			case "conversation.item.input_audio_transcription.completed": {
				const transcript = data.transcript?.trim();
				if (transcript && !this._processingUtterance) {
					this.callbacks.onUserTranscript(transcript);
					// Cancel any auto-response (create_response:false is unreliable)
					this.sendToGrok(JSON.stringify({ type: "response.cancel" }));
					await this.processVoiceTurn(transcript);
				}
				break;
			}

			// -- Auto-response suppression
			case "response.created": {
				if (!this.voiceWorker?.isProcessing) {
					this.log("AUTO_RESPONSE", "cancelling unexpected auto-response");
					this.sendToGrok(JSON.stringify({ type: "response.cancel" }));
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
					this.callbacks.onStateChange("speaking");
					this.callbacks.onAudioDelta(data.delta);
				}
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.delta": {
				if (data.delta) {
					this.callbacks.onTranscriptDelta(data.delta, false);
				}
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.done": {
				this.callbacks.onTranscriptDelta("", true);
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
						this._processingUtterance = false;
						this.callbacks.onStateChange("idle");
					}
				}
				break;
			}

			case "error": {
				this.log("ERROR", JSON.stringify(data));
				this.callbacks.onStateChange("error");
				break;
			}
		}
	}

	private async processVoiceTurn(transcript: string): Promise<void> {
		if (!this.voiceWorker) return;
		this._processingUtterance = true;
		this.callbacks.onStateChange("thinking");

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
			this.callbacks.onStateChange("error");
		} finally {
			this._processingUtterance = false;
		}
	}
}
