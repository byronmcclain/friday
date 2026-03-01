import { describe, test, expect } from "bun:test";
import { formatToolSummary } from "../../src/cli/tui/components/thinking.tsx";

describe("formatToolSummary", () => {
	test("returns tool name with first string arg", () => {
		expect(formatToolSummary("fs.read", { path: "src/core/cortex.ts" })).toBe(
			"fs.read src/core/cortex.ts",
		);
	});

	test("returns just tool name when no string args", () => {
		expect(formatToolSummary("git.status", {})).toBe("git.status");
	});

	test("returns just tool name when args are non-string", () => {
		expect(formatToolSummary("git.log", { limit: 5 })).toBe("git.log");
	});

	test("truncates long string args at 50 chars", () => {
		const longPath = "a".repeat(60);
		const result = formatToolSummary("fs.read", { path: longPath });
		expect(result).toBe(`fs.read ${"a".repeat(47)}...`);
		expect(result.length).toBe("fs.read ".length + 50);
	});

	test("skips empty string args", () => {
		expect(formatToolSummary("test.tool", { empty: "", name: "hello" })).toBe(
			"test.tool hello",
		);
	});

	test("picks first string arg when multiple exist", () => {
		const result = formatToolSummary("gmail.search", {
			query: "subject:invoice",
			maxResults: "10",
		});
		expect(result).toBe("gmail.search subject:invoice");
	});

	test("does not truncate string args at exactly 50 chars", () => {
		const exactPath = "a".repeat(50);
		const result = formatToolSummary("fs.read", { path: exactPath });
		expect(result).toBe(`fs.read ${exactPath}`);
	});
});
