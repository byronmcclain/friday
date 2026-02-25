import { describe, expect, test } from "bun:test";
import { gmailSearch } from "../../src/modules/gmail/tools/search.ts";
import { gmailRead } from "../../src/modules/gmail/tools/read.ts";
import { gmailListLabels } from "../../src/modules/gmail/tools/labels.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const ctx: ToolContext = {
	workingDirectory: "/tmp",
	audit: new AuditLogger(),
	signal: { emit: async () => {} },
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

describe("gmail.search", () => {
	test("declares network clearance", () => {
		expect(gmailSearch.clearance).toEqual(["network"]);
	});

	test("has query parameter required", () => {
		const query = gmailSearch.parameters.find((p) => p.name === "query");
		expect(query).toBeDefined();
		expect(query!.required).toBe(true);
	});

	test("fails without query parameter", async () => {
		const result = await gmailSearch.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("query");
	});

	test("fails when not authenticated", async () => {
		const result = await gmailSearch.execute({ query: "is:unread" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("auth");
	});
});

describe("gmail.read", () => {
	test("declares network clearance", () => {
		expect(gmailRead.clearance).toEqual(["network"]);
	});

	test("fails without id parameter", async () => {
		const result = await gmailRead.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("id");
	});
});

describe("gmail.list_labels", () => {
	test("declares network clearance", () => {
		expect(gmailListLabels.clearance).toEqual(["network"]);
	});

	test("has no required parameters", () => {
		const required = gmailListLabels.parameters.filter((p) => p.required);
		expect(required).toHaveLength(0);
	});
});
