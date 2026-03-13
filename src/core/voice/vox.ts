import type { SignalBus } from "../events.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { AuditLogger } from "../../audit/logger.ts";
import { type VoiceMode, type GrokVoice, type VoxConfig, type VoxOptions, VOX_TTS_URL } from "./types.ts";
import { playAudio, cleanupTempFile, detectPlayer } from "./audio.ts";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { emotionalRewrite } from "./emotion.ts";

interface VoxStatus {
	mode: VoiceMode;
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
	private _activeProc: { kill(): void } | null = null;
	private _activeTmpFile: string | null = null;
	private _activeController: AbortController | null = null;
	private _speaking = false;
	private _playerAvailable: boolean | null = null;
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
			voice: this._config.defaultVoice,
			apiKeyAvailable: this.apiKeyAvailable,
			emotionEngine: this.hasEmotionEngine,
		};
	}

	/**
	 * Speak text aloud via the Grok TTS REST API. Fire-and-forget — never rejects.
	 */
	async speak(text: string): Promise<void> {
		if (this._mode === "off") return;
		if (this._clearance) {
			const check = this._clearance.check("audio-output");
			if (!check.granted) {
				this.logAudit("vox:blocked", check.reason ?? "Clearance denied for audio output", false);
				return;
			}
		}
		if (!this.apiKeyAvailable) return;
		if (!text.trim()) return;

		const textPreview = text.length > 80 ? `${text.slice(0, 80)}...` : text;
		this.logAudit("vox:speak", `Speaking (${this._mode} mode): ${textPreview}`, true);

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

		// Cancel any in-progress playback
		this.cancelPlayback();

		let spokenText = text;
		const activeMode = this._mode as Exclude<VoiceMode, "off">;

		// Emotional rewrite for on/whisper modes when engine is available
		if (
			(activeMode === "on" || activeMode === "whisper") &&
			this._fastModel &&
			this._getRecentHistory
		) {
			try {
				const history = this._getRecentHistory();
				const result = await emotionalRewrite(
					text,
					history,
					activeMode,
					this._fastModel,
				);
				spokenText = result.text;
				this.logAudit("vox:rewrite", `Emotional rewrite applied (mood: ${result.emotion?.mood ?? "neutral"})`, true);
			} catch {
				// Fallback: use original text
			}
		}

		try {
			this._speaking = true;

			// Call the Grok TTS REST API
			const controller = new AbortController();
			this._activeController = controller;
			const timeoutId = setTimeout(() => controller.abort(), this._config.timeoutMs);

			let response: Response;
			try {
				response = await fetch(VOX_TTS_URL, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${process.env.XAI_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						text: spokenText,
						voice_id: this._config.defaultVoice.toLowerCase(),
						language: "en",
						output_format: { codec: "wav", sample_rate: 24000 },
					}),
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timeoutId);
				this._activeController = null;
			}

			if (!response.ok) {
				const errText = await response.text().catch(() => "unknown error");
				throw new Error(`TTS API error ${response.status}: ${errText}`);
			}

			const audioBuffer = Buffer.from(await response.arrayBuffer());
			this.logAudit("vox:tts-complete", `TTS audio received (${audioBuffer.length} bytes)`, true);

			if (!this._speaking) return; // cancelled while waiting for API

			// Play audio
			const { proc, tmpFile } = await playAudio(audioBuffer, 1.0);
			this._activeProc = proc;
			this._activeTmpFile = tmpFile;

			await proc.exited;

			this._activeProc = null;
			if (this._activeTmpFile) {
				void cleanupTempFile(this._activeTmpFile);
				this._activeTmpFile = null;
			}
			this._speaking = false;

			this.logAudit("vox:playback", `Audio playback complete (${audioBuffer.length} bytes)`, true);
			void this._signals.emit("custom:vox-spoke", "vox", {
				length: audioBuffer.length,
			});
		} catch (err) {
			this._speaking = false;
			const msg = err instanceof Error ? err.message : String(err);
			this.logAudit("vox:error", `Speak failed: ${msg}`, false);
			void this._signals.emit("custom:vox-error", "vox", { error: msg });
		}
	}

	/**
	 * Cancel in-progress playback.
	 */
	cancel(): void {
		this.cancelPlayback();
	}

	/**
	 * Full shutdown: cancel playback + set mode off.
	 */
	stop(): void {
		this._mode = "off";
		this.cancelPlayback();
	}

	private cancelPlayback(): void {
		this._speaking = false;
		if (this._activeController) {
			this._activeController.abort();
			this._activeController = null;
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

	private logAudit(action: string, detail: string, success: boolean): void {
		this._audit?.log({ action, source: "vox", detail, success });
	}
}
