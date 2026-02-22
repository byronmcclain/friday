import { describe, test, expect } from "bun:test";
import {
	filterCommands,
	type TypeaheadEntry,
} from "../../src/cli/tui/filter-commands.ts";

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
