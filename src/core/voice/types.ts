import type { AuditLogger } from "../../audit/logger.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";

export type VoiceMode = "off" | "on" | "whisper" | "flat";

export type EmotionMood =
	| "neutral"
	| "warm"
	| "excited"
	| "concerned"
	| "amused"
	| "serious"
	| "frustrated"
	| "proud";

export type EmotionIntensity = "subtle" | "moderate" | "strong";

export interface EmotionProfile {
	mood: EmotionMood;
	intensity: EmotionIntensity;
}

export interface EmotionalRewriteResult {
	text: string;
	emotion: EmotionProfile;
}

export type GrokVoice = "Ara" | "Eve" | "Rex" | "Sal" | "Leo";

const GROK_VOICES = new Set<string>(["Ara", "Eve", "Rex", "Sal", "Leo"] satisfies GrokVoice[]);

export function isGrokVoice(v: string): v is GrokVoice {
	return GROK_VOICES.has(v);
}

export interface VoxConfig {
	defaultVoice: GrokVoice;
	timeoutMs: number;
}

export interface VoxOptions {
	config: VoxConfig;
	signals: SignalBus;
	notifications: NotificationManager;
	clearance?: ClearanceManager;
	audit?: AuditLogger;
}

export const GROK_REALTIME_URL = "wss://api.x.ai/v1/realtime";

export const GROK_VOICE_MODEL_DEFAULT = "grok-voice-latest";

export function resolveVoiceModel(): string {
	const fromEnv = process.env.FRIDAY_VOICE_MODEL?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : GROK_VOICE_MODEL_DEFAULT;
}

export const VOICE_SILENCE_MS_DEFAULT = 800;

export function resolveVoiceSilenceMs(): number {
	const raw = process.env.FRIDAY_VOICE_SILENCE_MS?.trim();
	if (!raw) return VOICE_SILENCE_MS_DEFAULT;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return VOICE_SILENCE_MS_DEFAULT;
	return Math.min(n, 10_000);
}

export function buildGrokRealtimeUrl(opts?: {
	model?: string;
	conversationId?: string;
}): string {
	const model = opts?.model?.trim() || resolveVoiceModel();
	const url = new URL(GROK_REALTIME_URL);
	url.searchParams.set("model", model);
	if (opts?.conversationId) {
		url.searchParams.set("conversation_id", opts.conversationId);
	}
	return url.toString();
}

export const VOX_TTS_URL = "https://api.x.ai/v1/tts";

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	timeoutMs: 30000,
};
