import { describe, test, expect } from "bun:test";
import {
	parseAnsiLine,
	parseAnsiOutput,
} from "../../src/cli/tui/lib/ansi-parser.ts";

describe("parseAnsiLine", () => {
	test("plain text returns single span", () => {
		const spans = parseAnsiLine("hello");
		expect(spans).toEqual([{ text: "hello" }]);
	});

	test("truecolor foreground", () => {
		const spans = parseAnsiLine("\x1b[38;2;240;160;48mhello\x1b[0m");
		expect(spans).toEqual([{ text: "hello", fg: "#f0a030" }]);
	});

	test("truecolor fg + bg", () => {
		const spans = parseAnsiLine(
			"\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mAB\x1b[0m",
		);
		expect(spans).toEqual([{ text: "AB", fg: "#ff0000", bg: "#0000ff" }]);
	});

	test("reset clears colors", () => {
		const spans = parseAnsiLine("\x1b[38;2;255;0;0mA\x1b[0mB");
		expect(spans).toHaveLength(2);
		expect(spans[0]).toEqual({ text: "A", fg: "#ff0000" });
		expect(spans[1]).toEqual({ text: "B" });
	});

	test("strips DEC private mode sequences", () => {
		const spans = parseAnsiLine("\x1b[?25lhello\x1b[?25h");
		expect(spans).toEqual([{ text: "hello" }]);
	});

	test("merges adjacent spans with same colors", () => {
		const spans = parseAnsiLine(
			"\x1b[38;2;255;0;0mA\x1b[38;2;255;0;0mB\x1b[0m",
		);
		expect(spans).toEqual([{ text: "AB", fg: "#ff0000" }]);
	});

	test("256-color foreground", () => {
		const spans = parseAnsiLine("\x1b[38;5;196mred\x1b[0m");
		expect(spans).toHaveLength(1);
		expect(spans[0]!.text).toBe("red");
		expect(spans[0]!.fg).toBeDefined();
	});

	test("empty line returns empty array", () => {
		expect(parseAnsiLine("")).toEqual([]);
	});
});

describe("parseAnsiOutput", () => {
	test("parses multiple lines", () => {
		const result = parseAnsiOutput([
			"hello",
			"\x1b[38;2;255;0;0mworld\x1b[0m",
		]);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual([{ text: "hello" }]);
		expect(result[1]).toEqual([{ text: "world", fg: "#ff0000" }]);
	});
});
