import { describe, test, expect } from "bun:test";
import { formatTimestamp, levelIcon, levelColor } from "../../src/cli/tui/components/log-panel.tsx";
import { PALETTE } from "../../src/cli/tui/theme.ts";

describe("formatTimestamp", () => {
	test("formats as HH:MM:SS", () => {
		const date = new Date("2026-02-24T14:03:05.000Z");
		const result = formatTimestamp(date);
		// Exact output depends on timezone, so just check format pattern
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	test("pads single digits", () => {
		// Create date at 1:02:03 local time
		const date = new Date();
		date.setHours(1, 2, 3, 0);
		const result = formatTimestamp(date);
		expect(result).toBe("01:02:03");
	});
});

describe("levelIcon", () => {
	test("returns ● for info", () => {
		expect(levelIcon("info")).toBe("●");
	});

	test("returns ✓ for success", () => {
		expect(levelIcon("success")).toBe("✓");
	});

	test("returns ⚠ for warning", () => {
		expect(levelIcon("warning")).toBe("⚠");
	});

	test("returns ✗ for error", () => {
		expect(levelIcon("error")).toBe("✗");
	});
});

describe("levelColor", () => {
	test("info returns amberPrimary", () => {
		expect(levelColor("info")).toBe(PALETTE.amberPrimary);
	});

	test("success returns success color", () => {
		expect(levelColor("success")).toBe(PALETTE.success);
	});

	test("warning returns warning color", () => {
		expect(levelColor("warning")).toBe(PALETTE.warning);
	});

	test("error returns error color", () => {
		expect(levelColor("error")).toBe(PALETTE.error);
	});
});
