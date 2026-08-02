import { afterEach, describe, expect, test } from "bun:test";
import {
	GROK_REALTIME_URL,
	GROK_VOICE_MODEL_DEFAULT,
	buildGrokRealtimeUrl,
	resolveVoiceModel,
} from "../../src/core/voice/types.ts";

describe("buildGrokRealtimeUrl", () => {
	const prev = process.env.FRIDAY_VOICE_MODEL;
	afterEach(() => {
		if (prev === undefined) delete process.env.FRIDAY_VOICE_MODEL;
		else process.env.FRIDAY_VOICE_MODEL = prev;
	});

	test("defaults to grok-voice-latest query param", () => {
		delete process.env.FRIDAY_VOICE_MODEL;
		expect(buildGrokRealtimeUrl()).toBe(
			`${GROK_REALTIME_URL}?model=${GROK_VOICE_MODEL_DEFAULT}`,
		);
	});

	test("FRIDAY_VOICE_MODEL overrides default", () => {
		process.env.FRIDAY_VOICE_MODEL = "grok-voice-think-fast-2.0";
		expect(resolveVoiceModel()).toBe("grok-voice-think-fast-2.0");
		expect(buildGrokRealtimeUrl()).toBe(
			`${GROK_REALTIME_URL}?model=grok-voice-think-fast-2.0`,
		);
	});

	test("explicit model option wins over env", () => {
		process.env.FRIDAY_VOICE_MODEL = "from-env";
		expect(buildGrokRealtimeUrl({ model: "explicit" })).toBe(
			`${GROK_REALTIME_URL}?model=explicit`,
		);
	});

	test("appends conversation_id when provided", () => {
		expect(buildGrokRealtimeUrl({ conversationId: "conv_abc" })).toBe(
			`${GROK_REALTIME_URL}?model=${GROK_VOICE_MODEL_DEFAULT}&conversation_id=conv_abc`,
		);
	});
});
