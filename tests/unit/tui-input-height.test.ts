import { describe, expect, test } from "bun:test";
import { computeInputHeight } from "../../src/cli/tui/components/command-typeahead.tsx";

describe("computeInputHeight", () => {
	test("returns 1 for empty string", () => {
		expect(computeInputHeight("")).toBe(1);
	});

	test("returns 1 for single-line content", () => {
		expect(computeInputHeight("hello world")).toBe(1);
	});

	test("returns line count for multi-line content", () => {
		expect(computeInputHeight("line 1\nline 2\nline 3")).toBe(3);
	});

	test("caps at MAX_INPUT_LINES (10)", () => {
		const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
		expect(computeInputHeight(lines)).toBe(10);
	});

	test("counts trailing newline as extra line", () => {
		expect(computeInputHeight("line 1\nline 2\n")).toBe(3);
	});

	test("handles content with tabs", () => {
		expect(computeInputHeight("col1\tcol2\ncol3\tcol4")).toBe(2);
	});

	test("without availableWidth, ignores soft wrapping", () => {
		// 100 chars on a single line — no \n, so still 1 row without width info
		expect(computeInputHeight("a".repeat(100))).toBe(1);
	});

	test("wraps long line into multiple rows when availableWidth given", () => {
		// 100 chars at width 40 → ceil(100/40) = 3 visual rows
		expect(computeInputHeight("a".repeat(100), 40)).toBe(3);
	});

	test("line exactly at availableWidth does not add extra row", () => {
		expect(computeInputHeight("a".repeat(80), 80)).toBe(1);
	});

	test("line one char over availableWidth wraps to 2 rows", () => {
		expect(computeInputHeight("a".repeat(81), 80)).toBe(2);
	});

	test("combines hard wraps and soft wraps", () => {
		// Line 1: 100 chars at width 50 → 2 rows
		// Line 2: 10 chars → 1 row
		// Total: 3 rows
		const content = "a".repeat(100) + "\n" + "b".repeat(10);
		expect(computeInputHeight(content, 50)).toBe(3);
	});

	test("soft wrapping still caps at MAX_INPUT_LINES", () => {
		// 500 chars at width 10 → 50 visual rows, capped at 10
		expect(computeInputHeight("a".repeat(500), 10)).toBe(10);
	});

	test("availableWidth of 0 or negative treated as no-wrap", () => {
		expect(computeInputHeight("a".repeat(100), 0)).toBe(1);
		expect(computeInputHeight("a".repeat(100), -5)).toBe(1);
	});
});
