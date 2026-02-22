import { describe, test, expect } from "bun:test";
import { PALETTE, FRIDAY_SYNTAX_STYLE } from "../../src/cli/tui/theme.ts";

describe("TUI theme", () => {
	test("PALETTE contains all required color roles", () => {
		const required = [
			"background",
			"surface",
			"amberPrimary",
			"amberGlow",
			"amberDim",
			"copperAccent",
			"textPrimary",
			"textMuted",
			"success",
			"error",
			"warning",
		];
		for (const role of required) {
			expect(PALETTE).toHaveProperty(role);
			expect((PALETTE as Record<string, string>)[role]).toMatch(
				/^#[0-9A-Fa-f]{6}$/,
			);
		}
	});

	test("PALETTE colors match design spec", () => {
		expect(PALETTE.background).toBe("#0D1117");
		expect(PALETTE.amberPrimary).toBe("#F0A030");
		expect(PALETTE.textPrimary).toBe("#E6EDF3");
		expect(PALETTE.error).toBe("#F85149");
	});

	test("FRIDAY_SYNTAX_STYLE is defined", () => {
		expect(FRIDAY_SYNTAX_STYLE).toBeDefined();
	});
});
