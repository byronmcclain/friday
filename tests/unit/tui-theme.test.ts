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

	test("FRIDAY_SYNTAX_STYLE registers all required style groups", () => {
		const names = FRIDAY_SYNTAX_STYLE.getRegisteredNames();
		const required = [
			"markup.heading.1",
			"markup.heading.2",
			"markup.heading.3",
			"markup.heading.4",
			"markup.heading.5",
			"markup.heading.6",
			"markup.heading",
			"markup.list",
			"markup.raw",
			"markup.strong",
			"markup.italic",
			"markup.strikethrough",
			"markup.link.label",
			"markup.link.url",
			"markup.link",
			"punctuation.special",
			"conceal",
			"keyword",
			"string",
			"comment",
			"function",
			"number",
			"type",
			"operator",
			"default",
		];
		for (const name of required) {
			expect(names).toContain(name);
		}
	});

	test("markup.strong has bold attribute", () => {
		const style = FRIDAY_SYNTAX_STYLE.getStyle("markup.strong");
		expect(style).toBeDefined();
		expect(style!.bold).toBe(true);
	});

	test("markup.italic has italic attribute", () => {
		const style = FRIDAY_SYNTAX_STYLE.getStyle("markup.italic");
		expect(style).toBeDefined();
		expect(style!.italic).toBe(true);
	});

	test("markup.strikethrough has dim attribute", () => {
		const style = FRIDAY_SYNTAX_STYLE.getStyle("markup.strikethrough");
		expect(style).toBeDefined();
		expect(style!.dim).toBe(true);
	});

	test("markup.link.label has underline attribute", () => {
		const style = FRIDAY_SYNTAX_STYLE.getStyle("markup.link.label");
		expect(style).toBeDefined();
		expect(style!.underline).toBe(true);
	});

	test("heading levels 1-2 use amberPrimary, 3-6 use amberGlow", () => {
		const h1 = FRIDAY_SYNTAX_STYLE.getStyle("markup.heading.1");
		const h2 = FRIDAY_SYNTAX_STYLE.getStyle("markup.heading.2");
		const h3 = FRIDAY_SYNTAX_STYLE.getStyle("markup.heading.3");
		const h5 = FRIDAY_SYNTAX_STYLE.getStyle("markup.heading.5");

		// h1 and h2 should both be bold
		expect(h1!.bold).toBe(true);
		expect(h2!.bold).toBe(true);

		// h3 should be bold, h5 should not
		expect(h3!.bold).toBe(true);
		expect(h5!.bold).toBeUndefined();
	});
});
