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

export interface VoxConfig {
	defaultVoice: GrokVoice;
	sampleRate: number;
	whisperVolume: number;
	timeoutMs: number;
	idleTimeoutMs: number;
}

export interface VoxOptions {
	config: VoxConfig;
	signals: SignalBus;
	notifications: NotificationManager;
	clearance?: ClearanceManager;
	audit?: AuditLogger;
}

export const VOX_WS_URL = "wss://api.x.ai/v1/realtime";

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	sampleRate: 48000,
	whisperVolume: 0.3,
	timeoutMs: 30000,
	idleTimeoutMs: 60000,
};
