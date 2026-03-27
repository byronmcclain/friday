import { describe, test, expect } from "bun:test";
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
});
