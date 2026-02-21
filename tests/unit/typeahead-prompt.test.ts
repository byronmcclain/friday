import { describe, test, expect } from "bun:test";
import {
	filterCommands,
	formatSuggestionLine,
	type TypeaheadEntry,
} from "../../src/cli/typeahead-prompt.ts";

const testCommands: TypeaheadEntry[] = [
	{
		name: "smart",
		description: "Manage Friday's SMARTS knowledge base",
		aliases: ["smarts", "knowledge"],
	},
	{
		name: "deploy",
		description: "Deploy to production environment",
		aliases: ["ship"],
	},
	{
		name: "security-scan",
		description: "Run security audit",
		aliases: ["scan", "sec"],
	},
];

describe("filterCommands", () => {
	test("empty query returns all commands", () => {
		expect(filterCommands(testCommands, "")).toHaveLength(3);
	});

	test("filters by name prefix", () => {
		const results = filterCommands(testCommands, "sm");
		expect(results).toHaveLength(1);
		expect(results[0]!.name).toBe("smart");
	});

	test("filters by alias prefix", () => {
		const results = filterCommands(testCommands, "know");
		expect(results).toHaveLength(1);
		expect(results[0]!.name).toBe("smart");
	});

	test("is case insensitive", () => {
		expect(filterCommands(testCommands, "SM")).toHaveLength(1);
		expect(filterCommands(testCommands, "DEPLOY")).toHaveLength(1);
	});

	test("returns empty for no matches", () => {
		expect(filterCommands(testCommands, "zzz")).toHaveLength(0);
	});

	test("matches multiple commands", () => {
		const results = filterCommands(testCommands, "s");
		expect(results).toHaveLength(3); // smart, security-scan, deploy (via "ship" alias)
		const names = results.map((r) => r.name);
		expect(names).toContain("smart");
		expect(names).toContain("security-scan");
		expect(names).toContain("deploy");
	});

	test("alias match includes the parent command", () => {
		const results = filterCommands(testCommands, "sec");
		expect(results).toHaveLength(1);
		expect(results[0]!.name).toBe("security-scan");
	});

	test("exact name match works", () => {
		const results = filterCommands(testCommands, "deploy");
		expect(results).toHaveLength(1);
		expect(results[0]!.name).toBe("deploy");
	});

	test("handles empty commands array", () => {
		expect(filterCommands([], "test")).toHaveLength(0);
	});
});

describe("formatSuggestionLine", () => {
	const entry: TypeaheadEntry = {
		name: "smart",
		description: "Manage Friday's SMARTS knowledge base",
		aliases: ["smarts"],
	};

	test("unselected line contains command name", () => {
		const line = formatSuggestionLine(entry, false, 80);
		expect(line).toContain("/smart");
	});

	test("unselected line contains description", () => {
		const line = formatSuggestionLine(entry, false, 80);
		// Strip ANSI for content check
		const stripped = stripAnsi(line);
		expect(stripped).toContain("Manage Friday");
	});

	test("selected line contains command name", () => {
		const line = formatSuggestionLine(entry, true, 80);
		const stripped = stripAnsi(line);
		expect(stripped).toContain("/smart");
	});

	test("truncates long descriptions", () => {
		const longEntry: TypeaheadEntry = {
			name: "test",
			description: "A".repeat(200),
			aliases: [],
		};
		const line = formatSuggestionLine(longEntry, false, 40);
		const stripped = stripAnsi(line);
		expect(stripped.length).toBeLessThanOrEqual(40 + 20); // Allow for ANSI overhead
		expect(stripped).toContain("…");
	});

	test("handles very narrow width gracefully", () => {
		const line = formatSuggestionLine(entry, false, 10);
		// Should not throw, just show prefix
		expect(line).toBeDefined();
	});
});

function stripAnsi(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code stripping requires matching control characters
		/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
		"",
	);
}
