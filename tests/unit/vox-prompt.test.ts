import { describe, test, expect } from "bun:test";
import {
	buildVoiceSystemPrompt,
	FRIDAY_VOICE_IDENTITY,
	VOICE_DELIVERY_RULES,
} from "../../src/core/voice/prompt.ts";

describe("FRIDAY_VOICE_IDENTITY", () => {
	test("is exported and non-empty", () => {
		expect(FRIDAY_VOICE_IDENTITY.length).toBeGreaterThan(100);
	});

	test("contains key personality traits", () => {
		expect(FRIDAY_VOICE_IDENTITY).toContain("County Tipperary");
		expect(FRIDAY_VOICE_IDENTITY).toContain("Kerry Condon");
		expect(FRIDAY_VOICE_IDENTITY).toContain("dry wit");
	});
});

describe("VOICE_DELIVERY_RULES", () => {
	test("is exported and non-empty", () => {
		expect(VOICE_DELIVERY_RULES.length).toBeGreaterThan(100);
	});

	test("contains key delivery guidance phrases", () => {
		expect(VOICE_DELIVERY_RULES).toContain("SUMMARIZE");
		expect(VOICE_DELIVERY_RULES).toContain("code");
		expect(VOICE_DELIVERY_RULES).toContain("URLs");
		expect(VOICE_DELIVERY_RULES).toContain("speaking aloud");
	});

	test("does NOT contain READING_RULES framing", () => {
		expect(VOICE_DELIVERY_RULES).not.toContain("READING RULES");
		expect(VOICE_DELIVERY_RULES).not.toContain("never add your own analysis");
		expect(VOICE_DELIVERY_RULES).not.toContain("reading prepared text");
	});

	test("includes natural conversation guidance", () => {
		expect(VOICE_DELIVERY_RULES).toContain("speak naturally");
	});

	test("includes guidance for diagnostic/tool output", () => {
		expect(VOICE_DELIVERY_RULES).toContain("tool returns");
		expect(VOICE_DELIVERY_RULES).toContain("never parrot");
	});

	test("explicitly covers system metrics and key-value data", () => {
		expect(VOICE_DELIVERY_RULES).toContain("system metrics");
		expect(VOICE_DELIVERY_RULES).toContain("key-value");
	});
});

describe("buildVoiceSystemPrompt", () => {
	test("preserves base prompt at start", () => {
		const base = "You are FRIDAY. Genesis prompt here.";
		const result = buildVoiceSystemPrompt(base);
		expect(result.startsWith(base)).toBe(true);
	});

	test("appends voice identity", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("County Tipperary");
		expect(result).toContain(FRIDAY_VOICE_IDENTITY);
	});

	test("appends voice delivery rules", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("VOICE DELIVERY RULES");
		expect(result).toContain("SUMMARIZE");
	});

	test("wraps under ## Voice section", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("## Voice");
	});

	test("does NOT contain READING_RULES", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).not.toContain("READING RULES");
	});
});
