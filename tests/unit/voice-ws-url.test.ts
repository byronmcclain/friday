import { afterEach, describe, expect, test } from "bun:test";
import {
	GROK_REALTIME_URL,
	GROK_VOICE_MODEL_DEFAULT,
	VOICE_SILENCE_MS_DEFAULT,
	buildGrokRealtimeUrl,
	resolveVoiceModel,
	resolveVoiceSilenceMs,
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

describe("resolveVoiceSilenceMs", () => {
	const prev = process.env.FRIDAY_VOICE_SILENCE_MS;
	afterEach(() => {
		if (prev === undefined) delete process.env.FRIDAY_VOICE_SILENCE_MS;
		else process.env.FRIDAY_VOICE_SILENCE_MS = prev;
	});

	test("defaults to 800", () => {
		delete process.env.FRIDAY_VOICE_SILENCE_MS;
		expect(resolveVoiceSilenceMs()).toBe(VOICE_SILENCE_MS_DEFAULT);
	});

	test("parses valid env", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "600";
		expect(resolveVoiceSilenceMs()).toBe(600);
	});

	test("falls back on invalid env", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "nope";
		expect(resolveVoiceSilenceMs()).toBe(VOICE_SILENCE_MS_DEFAULT);
	});

	test("clamps above 10000", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "99999";
		expect(resolveVoiceSilenceMs()).toBe(10000);
	});
});
