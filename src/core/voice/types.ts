import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";
import type { ClearanceManager } from "../clearance.ts";

export type VoiceMode = "off" | "on" | "whisper";

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
}

export const VOX_WS_URL = "wss://api.x.ai/v1/realtime";

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	sampleRate: 48000,
	whisperVolume: 0.3,
	timeoutMs: 30000,
	idleTimeoutMs: 60000,
};
