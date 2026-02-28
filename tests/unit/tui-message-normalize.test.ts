import { describe, test, expect } from "bun:test";
import { _normalizeContent } from "../../src/cli/tui/components/message.tsx";

describe("normalizeContent", () => {
	test("converts <br> tags to newlines", () => {
		expect(_normalizeContent("hello<br>world")).toBe("hello\nworld");
		expect(_normalizeContent("a<br/>b")).toBe("a\nb");
		expect(_normalizeContent("a<br />b")).toBe("a\nb");
		expect(_normalizeContent("a<BR>b")).toBe("a\nb");
	});

	test("inserts blank line before table after paragraph", () => {
		const input = "Some text\n| A | B |\n| --- | --- |\n| 1 | 2 |";
		const expected = "Some text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(_normalizeContent(input)).toBe(expected);
	});

	test("inserts blank line before table after list item", () => {
		const input = "- item\n| Col1 | Col2 |\n| --- | --- |\n| a | b |";
		const expected = "- item\n\n| Col1 | Col2 |\n| --- | --- |\n| a | b |";
		expect(_normalizeContent(input)).toBe(expected);
	});

	test("does not double-insert for already-separated tables", () => {
		const input = "Some text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(_normalizeContent(input)).toBe(input);
	});

	test("inserts blank line before opening fenced code blocks", () => {
		const input = "Some text\n```js\nconsole.log('hi')\n```";
		const expected = "Some text\n\n```js\nconsole.log('hi')\n```";
		expect(_normalizeContent(input)).toBe(expected);
	});

	test("does not double-insert for already-separated code blocks", () => {
		const input = "Some text\n\n```js\nconsole.log('hi')\n```";
		expect(_normalizeContent(input)).toBe(input);
	});

	test("does not insert blank line before closing fences", () => {
		const input = "Some text\n\n```js\nconsole.log('hi')\n```";
		// Closing ``` should NOT get a blank line before it
		expect(_normalizeContent(input)).toBe(input);
	});

	test("handles multiple tables in one message", () => {
		const input = [
			"First section",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"Second section",
			"| X | Y |",
			"| --- | --- |",
			"| 3 | 4 |",
		].join("\n");
		const expected = [
			"First section",
			"",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"Second section",
			"",
			"| X | Y |",
			"| --- | --- |",
			"| 3 | 4 |",
		].join("\n");
		expect(_normalizeContent(input)).toBe(expected);
	});

	test("passes through plain text unchanged", () => {
		const input = "Hello, world!";
		expect(_normalizeContent(input)).toBe(input);
	});

	test("passes through empty string unchanged", () => {
		expect(_normalizeContent("")).toBe("");
	});

	test("handles table with colon-aligned delimiter", () => {
		const input = "text\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
		const expected =
			"text\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
		expect(_normalizeContent(input)).toBe(expected);
	});
});
