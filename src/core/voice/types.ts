import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { AuditLogger } from "../../audit/logger.ts";

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

export const VOX_TTS_URL = "https://api.x.ai/v1/tts";

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	timeoutMs: 30000,
};
