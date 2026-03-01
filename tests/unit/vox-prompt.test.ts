import { describe, test, expect } from "bun:test";
import {
	classifyContent,
	buildTtsPrompt,
	FRIDAY_VOICE_IDENTITY,
} from "../../src/core/voice/prompt.ts";
import type { VoiceMode, EmotionProfile } from "../../src/core/voice/types.ts";

describe("classifyContent", () => {
	test("detects markdown tables", () => {
		const text = "| Name | Age |\n|------|-----|\n| Alice | 30 |";
		const hints = classifyContent(text);
		expect(hints).toContain("tabular data");
	});

	test("detects code blocks", () => {
		const text = "Here is code:\n```typescript\nconst x = 1;\n```";
		const hints = classifyContent(text);
		expect(hints).toContain("code");
	});

	test("detects JSON objects", () => {
		const text = 'Response: {"status": "ok", "count": 42}';
		const hints = classifyContent(text);
		expect(hints).toContain("structured data");
	});

	test("detects long bullet lists", () => {
		const text = "Items:\n- one\n- two\n- three\n- four\n- five\n- six";
		const hints = classifyContent(text);
		expect(hints).toContain("long list");
	});

	test("detects URLs", () => {
		const text = "Check https://example.com/path/to/resource for details";
		const hints = classifyContent(text);
		expect(hints).toContain("URLs");
	});

	test("detects file paths", () => {
		const text = "The file is at /Users/byron/src/friday/main.ts";
		const hints = classifyContent(text);
		expect(hints).toContain("URLs");
	});

	test("returns empty string for short conversational text", () => {
		const text = "Sure thing, Boss. All systems are online.";
		const hints = classifyContent(text);
		expect(hints).toBe("");
	});

	test("detects multiple content types", () => {
		const text = "Here:\n```js\nx=1\n```\n| A | B |\n|---|---|\n| 1 | 2 |";
		const hints = classifyContent(text);
		expect(hints).toContain("code");
		expect(hints).toContain("tabular data");
	});
});

describe("buildTtsPrompt", () => {
	test("includes base identity", () => {
		const prompt = buildTtsPrompt("Hello Boss", "on");
		expect(prompt).toContain("FRIDAY");
		expect(prompt).toContain("County Tipperary");
	});

	test("on mode includes normal delivery context", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).toContain("Speak clearly and naturally");
	});

	test("whisper mode includes whisper context", () => {
		const prompt = buildTtsPrompt("Hello", "whisper");
		expect(prompt).toContain("whispering");
		expect(prompt).toContain("two sentences maximum");
	});

	test("injects content hints for tables", () => {
		const text = "| Col |\n|-----|\n| val |";
		const prompt = buildTtsPrompt(text, "on");
		expect(prompt).toContain("tabular data");
	});

	test("no content hints for simple text", () => {
		const prompt = buildTtsPrompt("All good, Boss.", "on");
		// Should not contain the CONTENT NOTES section
		expect(prompt).not.toContain("CONTENT NOTES");
	});

	test("includes reading rules", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).toContain("READING RULES");
	});

	test("FRIDAY_VOICE_IDENTITY is exported and non-empty", () => {
		expect(FRIDAY_VOICE_IDENTITY.length).toBeGreaterThan(100);
	});
});

describe("buildTtsPrompt with emotion", () => {
	test("includes EMOTIONAL DELIVERY when emotion provided", () => {
		const emotion: EmotionProfile = { mood: "excited", intensity: "strong" };
		const prompt = buildTtsPrompt("Great news!", "on", emotion);
		expect(prompt).toContain("EMOTIONAL DELIVERY");
		expect(prompt).toContain("genuinely excited");
		expect(prompt).toContain("Don't hold back");
	});

	test("no EMOTIONAL DELIVERY when emotion omitted", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).not.toContain("EMOTIONAL DELIVERY");
	});

	test("warm mood with subtle intensity", () => {
		const emotion: EmotionProfile = { mood: "warm", intensity: "subtle" };
		const prompt = buildTtsPrompt("Nice work.", "on", emotion);
		expect(prompt).toContain("warmth");
		expect(prompt).toContain("understated");
	});

	test("concerned mood with moderate intensity", () => {
		const emotion: EmotionProfile = { mood: "concerned", intensity: "moderate" };
		const prompt = buildTtsPrompt("Tests failed.", "on", emotion);
		expect(prompt).toContain("concern");
		expect(prompt).toContain("naturally");
	});

	test("frustrated mood delivery", () => {
		const emotion: EmotionProfile = { mood: "frustrated", intensity: "strong" };
		const prompt = buildTtsPrompt("Still broken.", "on", emotion);
		expect(prompt).toContain("frustrated");
	});

	test("emotion works with whisper mode", () => {
		const emotion: EmotionProfile = { mood: "amused", intensity: "moderate" };
		const prompt = buildTtsPrompt("Funny.", "whisper", emotion);
		expect(prompt).toContain("whispering");
		expect(prompt).toContain("amused");
	});

	test("emotion works with flat mode (no emotion injected)", () => {
		const prompt = buildTtsPrompt("Data.", "flat");
		expect(prompt).not.toContain("EMOTIONAL DELIVERY");
		expect(prompt).toContain("FRIDAY");
	});
});
