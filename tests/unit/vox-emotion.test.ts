import { describe, test, expect } from "bun:test";
import { emotionalRewrite, EMOTION_REWRITE_PROMPT } from "../../src/core/voice/emotion.ts";
import { createMockModel, createErrorModel } from "../helpers/stubs.ts";
import type { EmotionMood } from "../../src/core/voice/types.ts";

describe("emotionalRewrite", () => {
	test("returns rewritten text and emotion profile from fast model", async () => {
		const mockResponse = JSON.stringify({
			text: "[chuckle] Grand stuff, boss — <emphasis>the build went through</emphasis>.",
			mood: "amused",
			intensity: "moderate",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: How's the build?", "Assistant: Running it now..."],
			"on",
			model,
		);

		expect(result.text).toContain("[chuckle]");
		expect(result.text).toContain("<emphasis>");
		expect(result.emotion.mood).toBe("amused");
		expect(result.emotion.intensity).toBe("moderate");
	});

	test("whisper mode prompt instructs wrapping in <whisper> tag", async () => {
		const mockResponse = JSON.stringify({
			text: "<whisper>Build passed, Boss.</whisper>",
			mood: "warm",
			intensity: "subtle",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: How's the build?"],
			"whisper",
			model,
		);

		expect(result.text).toContain("<whisper>");
		// Verify the model was called with whisper guidance
		expect(model.doGenerateCalls.length).toBe(1);
		const callPrompt = JSON.stringify(model.doGenerateCalls[0]);
		expect(callPrompt).toContain("<whisper>");
	});

	test("falls back to original text on model error", async () => {
		const model = createErrorModel("API timeout");

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: Check the build"],
			"on",
			model,
		);

		expect(result.text).toBe("The build succeeded.");
		expect(result.emotion.mood).toBe("neutral");
		expect(result.emotion.intensity).toBe("moderate");
	});

	test("falls back on invalid JSON from model", async () => {
		const model = createMockModel({ text: "not valid json at all" });

		const result = await emotionalRewrite(
			"Hello boss.",
			[],
			"on",
			model,
		);

		expect(result.text).toBe("Hello boss.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("falls back on missing fields in model JSON", async () => {
		const model = createMockModel({ text: JSON.stringify({ text: "hey" }) });

		const result = await emotionalRewrite(
			"Hello boss.",
			["User: Hi"],
			"on",
			model,
		);

		// Missing mood/intensity → fallback
		expect(result.text).toBe("Hello boss.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("falls back on invalid mood value", async () => {
		const model = createMockModel({
			text: JSON.stringify({
				text: "[laugh] hi",
				mood: "ecstatic",
				intensity: "moderate",
			}),
		});

		const result = await emotionalRewrite("Hi", [], "on", model);
		expect(result.text).toBe("Hi");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("handles empty history gracefully", async () => {
		const mockResponse = JSON.stringify({
			text: "Right so, here we go.",
			mood: "neutral",
			intensity: "subtle",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"Starting up.",
			[],
			"on",
			model,
		);

		expect(result.text).toBe("Right so, here we go.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("EMOTION_REWRITE_PROMPT contains native inline tag reference", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("[pause]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[long-pause]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[chuckle]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[sigh]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[breath]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tsk]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tongue-click]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[hum-tune]");
	});

	test("EMOTION_REWRITE_PROMPT contains native wrapping tag reference", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("<soft>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<whisper>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<emphasis>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<slow>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<fast>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<laugh-speak>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<build-intensity>");
	});

	test("EMOTION_REWRITE_PROMPT contains Friday-specific tag guidelines", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("Less is more");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tsk]");
		expect(EMOTION_REWRITE_PROMPT).toContain("Never use [cry]");
	});

	test("EMOTION_REWRITE_PROMPT is exported and non-empty", () => {
		expect(EMOTION_REWRITE_PROMPT.length).toBeGreaterThan(100);
	});
});
