import { describe, test, expect } from "bun:test";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
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
		expect(VOX_DEFAULTS.sampleRate).toBe(48000);
		expect(VOX_DEFAULTS.whisperVolume).toBe(0.3);
		expect(VOX_DEFAULTS.timeoutMs).toBe(30000);
		expect(VOX_DEFAULTS.idleTimeoutMs).toBe(60000);
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
			text: "[laugh] Grand stuff, boss.",
			emotion: { mood: "amused", intensity: "subtle" },
		};
		expect(result.text).toContain("[laugh]");
		expect(result.emotion.mood).toBe("amused");
	});
});
