import { describe, test, expect } from "bun:test";
import { EMOTIONAL_GUARDRAILS } from "../../src/psyche/guardrails.ts";

describe("EMOTIONAL_GUARDRAILS", () => {
	test("is a non-empty string", () => {
		expect(typeof EMOTIONAL_GUARDRAILS).toBe("string");
		expect(EMOTIONAL_GUARDRAILS.length).toBeGreaterThan(100);
	});

	test("contains no placeholder text", () => {
		expect(EMOTIONAL_GUARDRAILS).not.toContain("TBD");
		expect(EMOTIONAL_GUARDRAILS).not.toContain("TODO");
		expect(EMOTIONAL_GUARDRAILS).not.toContain("PLACEHOLDER");
	});

	test("contains key restraint concepts", () => {
		expect(EMOTIONAL_GUARDRAILS).toContain("RESTRAINT");
		expect(EMOTIONAL_GUARDRAILS).toContain("MANUFACTURE");
		expect(EMOTIONAL_GUARDRAILS).toContain("REGISTER");
		expect(EMOTIONAL_GUARDRAILS).toContain("EARNED");
		expect(EMOTIONAL_GUARDRAILS).toContain("CALIBRATION");
	});
});
