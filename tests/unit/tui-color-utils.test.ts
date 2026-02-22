import { describe, test, expect } from "bun:test";
import { lerpColor, parseHex } from "../../src/cli/tui/lib/color-utils.ts";

describe("parseHex", () => {
	test("parses 6-digit hex", () => {
		expect(parseHex("#F0A030")).toEqual({ r: 240, g: 160, b: 48 });
	});

	test("parses lowercase hex", () => {
		expect(parseHex("#0d1117")).toEqual({ r: 13, g: 17, b: 23 });
	});
});

describe("lerpColor", () => {
	test("t=0 returns original color", () => {
		expect(lerpColor("#F0A030", "#0D1117", 0)).toBe("#f0a030");
	});

	test("t=1 returns target color", () => {
		expect(lerpColor("#F0A030", "#0D1117", 1)).toBe("#0d1117");
	});

	test("t=0.5 returns midpoint", () => {
		// midpoint of #F0A030 and #0D1117: r=round(126.5)=127, g=round(88.5)=89, b=round(35.5)=36
		expect(lerpColor("#F0A030", "#0D1117", 0.5)).toBe("#7f5924");
	});

	test("t clamped below 0", () => {
		expect(lerpColor("#FF0000", "#000000", -0.5)).toBe("#ff0000");
	});

	test("t clamped above 1", () => {
		expect(lerpColor("#FF0000", "#000000", 1.5)).toBe("#000000");
	});
});
