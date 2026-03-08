import { describe, test, expect } from "bun:test";
import { VOX_DEFAULTS, VOX_TTS_URL, GROK_REALTIME_URL } from "../../src/core/voice/types.ts";
import type {
	VoiceMode,
	GrokVoice,
	VoxConfig,
	EmotionMood,
	EmotionIntensity,
	EmotionProfile,
	EmotionalRewriteResult,
} from "../../src/core/voice/types.ts";

describe("Vox types", () => {
	test("VOX_DEFAULTS has correct shape", () => {
		expect(VOX_DEFAULTS.defaultVoice).toBe("Eve");
		expect(VOX_DEFAULTS.timeoutMs).toBe(30000);
		// These fields should no longer exist
		expect((VOX_DEFAULTS as any).sampleRate).toBeUndefined();
		expect((VOX_DEFAULTS as any).whisperVolume).toBeUndefined();
		expect((VOX_DEFAULTS as any).idleTimeoutMs).toBeUndefined();
	});

	test("VOX_TTS_URL points to REST TTS endpoint", () => {
		expect(VOX_TTS_URL).toBe("https://api.x.ai/v1/tts");
	});

	test("GROK_REALTIME_URL points to realtime WebSocket endpoint", () => {
		expect(GROK_REALTIME_URL).toBe("wss://api.x.ai/v1/realtime");
	});

	test("VoiceMode type accepts valid modes", () => {
		const modes: VoiceMode[] = ["off", "on", "whisper", "flat"];
		expect(modes).toHaveLength(4);
	});

	test("GrokVoice type accepts valid voices", () => {
		const voices: GrokVoice[] = ["Ara", "Eve", "Rex", "Sal", "Leo"];
		expect(voices).toHaveLength(5);
	});
});

describe("emotion types", () => {
	test("EmotionProfile satisfies the type contract", () => {
		const profile: EmotionProfile = { mood: "warm", intensity: "moderate" };
		expect(profile.mood).toBe("warm");
		expect(profile.intensity).toBe("moderate");
	});

	test("EmotionalRewriteResult satisfies the type contract", () => {
		const result: EmotionalRewriteResult = {
			text: "[chuckle] Grand stuff, boss.",
			emotion: { mood: "amused", intensity: "subtle" },
		};
		expect(result.text).toContain("[chuckle]");
		expect(result.emotion.mood).toBe("amused");
	});
});
