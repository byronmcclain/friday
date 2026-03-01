import type { SignalBus } from "../events.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { AuditLogger } from "../../audit/logger.ts";
import { type VoiceMode, type GrokVoice, type VoxConfig, type VoxOptions, type EmotionProfile, VOX_WS_URL } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";
import { pcmToWav, playAudio, cleanupTempFile, detectPlayer } from "./audio.ts";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { emotionalRewrite } from "./emotion.ts";

// FUTURE: Full duplex voice conversation
// This WebSocket connection currently operates in TTS-only mode (text → speech).
// The Grok Voice Agent API supports bidirectional audio (server_vad turn detection,
// audio input streaming). When the web UI adds conversational voice, extend this
// connection to handle audio input + output, enabling real-time voice dialogue.
// The persistent connection with idle eviction pattern is designed with this in mind.

interface VoxStatus {
	mode: VoiceMode;
	connected: boolean;
	voice: GrokVoice;
	apiKeyAvailable: boolean;
	emotionEngine: boolean;
}

export class Vox {
	private _mode: VoiceMode = "off";
	private _config: VoxConfig;
	private _signals: SignalBus;
	private _clearance?: ClearanceManager;
	private _audit?: AuditLogger;
	private _ws: WebSocket | null = null;
	private _connected = false;
	private _idleTimer: ReturnType<typeof setTimeout> | null = null;
	private _speakTimeout: ReturnType<typeof setTimeout> | null = null;
	private _activeProc: { kill(): void } | null = null;
	private _activeTmpFile: string | null = null;
	private _speaking = false;
	private _audioChunks: Buffer[] = [];
	private _speakResolve: (() => void) | null = null;
	private _playerAvailable: boolean | null = null; // null = unchecked
	private _fastModel?: LanguageModelV3;
	private _getRecentHistory?: () => string[];

	constructor(options: VoxOptions) {
		this._config = options.config;
		this._signals = options.signals;
		this._clearance = options.clearance;
		this._audit = options.audit;
	}

	get mode(): VoiceMode {
		return this._mode;
	}

	get isConnected(): boolean {
		return this._connected;
	}

	get apiKeyAvailable(): boolean {
		return Boolean(process.env.XAI_API_KEY);
	}

	get hasEmotionEngine(): boolean {
		return Boolean(this._fastModel && this._getRecentHistory);
	}

	setEmotionEngine(
		fastModel: LanguageModelV3,
		getRecentHistory: () => string[],
	): void {
		this._fastModel = fastModel;
		this._getRecentHistory = getRecentHistory;
	}

	setMode(mode: VoiceMode): void {
		const from = this._mode;
		if (from === mode) return;
		this._mode = mode;
		void this._signals.emit("custom:vox-mode-changed", "vox", { from, to: mode });
		if (mode === "off") {
			this.cancel();
		}
	}

	status(): VoxStatus {
		return {
			mode: this._mode,
			connected: this._connected,
			voice: this._config.defaultVoice,
			apiKeyAvailable: this.apiKeyAvailable,
			emotionEngine: this.hasEmotionEngine,
		};
	}

	/**
	 * Speak text aloud. Fire-and-forget — never rejects.
	 * Cancels any in-progress playback before starting.
	 */
	async speak(text: string): Promise<void> {
		if (this._mode === "off") return;
		if (this._clearance) {
			const check = this._clearance.check("audio-output");
			if (!check.granted) {
				this._audit?.log({
					action: "vox:blocked",
					source: "vox",
					detail: check.reason ?? "Clearance denied for audio output",
					success: false,
				});
				return;
			}
		}
		if (!this.apiKeyAvailable) return;
		if (!text.trim()) return;

		// Check player availability on first call
		if (this._playerAvailable === null) {
			try {
				detectPlayer();
				this._playerAvailable = true;
			} catch {
				this._playerAvailable = false;
				void this._signals.emit("custom:vox-error", "vox", {
					error: `No audio player available for platform: ${process.platform}`,
				});
				return;
			}
		}
		if (!this._playerAvailable) return;

		// Soft cancel: kill current playback, keep WebSocket
		this.cancelPlayback();
		this.resetIdleTimer();

		let spokenText = text;
		let emotionProfile: EmotionProfile | undefined;

		// Emotional rewrite for on/whisper modes when engine is available
		if (
			this._mode !== "flat" &&
			this._fastModel &&
			this._getRecentHistory
		) {
			try {
				const history = this._getRecentHistory();
				const result = await emotionalRewrite(
					text,
					history,
					this._mode as "on" | "whisper",
					this._fastModel,
				);
				spokenText = result.text;
				emotionProfile = result.emotion;
			} catch {
				// Fallback: use original text, no emotion
			}
		}

		const prompt = buildTtsPrompt(
			spokenText,
			this._mode as Exclude<VoiceMode, "off">,
			emotionProfile,
		);

		try {
			if (!this._ws || !this._connected) {
				await this.connect();
			}

			this._audioChunks = [];
			this._speaking = true;

			// Update instructions for this utterance (dynamic prompt per speak)
			this._ws!.send(
				JSON.stringify({
					type: "session.update",
					session: { instructions: prompt },
				}),
			);

			// Send the text to speak
			this._ws!.send(
				JSON.stringify({
					type: "conversation.item.create",
					item: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: spokenText }],
					},
				}),
			);

			// Request audio response
			this._ws!.send(
				JSON.stringify({
					type: "response.create",
					response: { modalities: ["audio"] },
				}),
			);

			// Wait for response.done or timeout
			await new Promise<void>((resolve) => {
				this._speakResolve = () => {
					if (this._speakTimeout) {
						clearTimeout(this._speakTimeout);
						this._speakTimeout = null;
					}
					resolve();
				};

				// Per-utterance timeout
				this._speakTimeout = setTimeout(() => {
					this._speakTimeout = null;
					if (this._speaking) {
						this._speaking = false;
						this._speakResolve = null;
						resolve();
					}
				}, this._config.timeoutMs);
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			void this._signals.emit("custom:vox-error", "vox", { error: msg });
		}
	}

	/**
	 * Cancel in-progress playback (soft cancel). WebSocket stays open.
	 */
	cancel(): void {
		this.cancelPlayback();
	}

	/**
	 * Full shutdown: cancel playback + close WebSocket + clear timers.
	 */
	stop(): void {
		this._mode = "off";
		this.cancelPlayback();
		this.disconnect();
	}

	private cancelPlayback(): void {
		this._speaking = false;
		this._audioChunks = [];
		if (this._speakTimeout) {
			clearTimeout(this._speakTimeout);
			this._speakTimeout = null;
		}
		if (this._speakResolve) {
			this._speakResolve();
			this._speakResolve = null;
		}
		if (this._activeProc) {
			try {
				this._activeProc.kill();
			} catch {
				// process may have already exited
			}
			this._activeProc = null;
		}
		if (this._activeTmpFile) {
			void cleanupTempFile(this._activeTmpFile);
			this._activeTmpFile = null;
		}
	}

	private async connect(): Promise<void> {
		const apiKey = process.env.XAI_API_KEY;
		if (!apiKey) throw new Error("XAI_API_KEY not set");

		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(VOX_WS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			} as any);

			const timeout = setTimeout(() => {
				reject(new Error("WebSocket connection timeout"));
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			}, 10000);

			ws.addEventListener("open", () => {
				clearTimeout(timeout);
				this._ws = ws;
				this._connected = true;

				// Initial session config
				ws.send(
					JSON.stringify({
						type: "session.update",
						session: {
							voice: this._config.defaultVoice,
							turn_detection: { type: null },
							audio: {
								output: {
									format: { type: "audio/pcm", rate: this._config.sampleRate },
								},
							},
						},
					}),
				);

				resolve();
			});

			ws.addEventListener("message", (event) => {
				if (typeof event.data === "string") {
					this.handleMessage(event.data);
				}
			});

			ws.addEventListener("error", () => {
				clearTimeout(timeout);
				this._connected = false;
				this._ws = null;
				reject(new Error("WebSocket connection error"));
			});

			ws.addEventListener("close", () => {
				this._connected = false;
				this._ws = null;
				if (this._speaking && this._speakResolve) {
					this._speakResolve();
					this._speakResolve = null;
					this._speaking = false;
				}
			});
		});
	}

	private handleMessage(raw: string): void {
		let data: { type: string; delta?: string; error?: { message?: string } };
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		switch (data.type) {
			case "response.output_audio.delta": {
				if (this._speaking && data.delta) {
					this._audioChunks.push(Buffer.from(data.delta, "base64"));
				}
				break;
			}

			case "response.done": {
				if (!this._speaking) break;
				this._speaking = false;
				const chunks = this._audioChunks;
				this._audioChunks = [];
				const resolve = this._speakResolve;
				this._speakResolve = null;

				// Play audio async — assign kill handle synchronously so cancel() works immediately
				if (chunks.length > 0) {
					const pcm = Buffer.concat(chunks);
					const wav = pcmToWav(pcm, this._config.sampleRate);
					const volume = this._mode === "whisper" ? this._config.whisperVolume : 1.0;

					// Proxy kill handle set before async playAudio resolves
					let realProc: { kill(): void } | null = null;
					const killHandle: { kill(): void } = {
						kill: () => { realProc?.kill(); },
					};
					this._activeProc = killHandle;

					void playAudio(wav, volume)
						.then(({ proc, tmpFile }) => {
							realProc = proc;
							this._activeProc = proc;
							this._activeTmpFile = tmpFile;
							return proc.exited;
						})
						.then(() => {
							this._activeProc = null;
							if (this._activeTmpFile) {
								void cleanupTempFile(this._activeTmpFile);
								this._activeTmpFile = null;
							}
							void this._signals.emit("custom:vox-spoke", "vox", {
								length: chunks.length,
							});
						})
						.catch((err) => {
							this._activeProc = null;
							const msg = err instanceof Error ? err.message : String(err);
							void this._signals.emit("custom:vox-error", "vox", { error: msg });
						});
				}

				resolve?.();
				break;
			}

			case "error": {
				const msg = data.error?.message ?? "Grok voice error";
				void this._signals.emit("custom:vox-error", "vox", { error: msg });
				if (this._speaking) {
					this._speaking = false;
					this._audioChunks = [];
					this._speakResolve?.();
					this._speakResolve = null;
				}
				break;
			}
		}
	}

	private disconnect(): void {
		if (this._idleTimer) {
			clearTimeout(this._idleTimer);
			this._idleTimer = null;
		}
		if (this._ws) {
			try {
				this._ws.close();
			} catch {
				// ignore close errors
			}
			this._ws = null;
			this._connected = false;
		}
	}

	private resetIdleTimer(): void {
		if (this._idleTimer) clearTimeout(this._idleTimer);
		this._idleTimer = setTimeout(() => this.disconnect(), this._config.idleTimeoutMs);
	}
}
