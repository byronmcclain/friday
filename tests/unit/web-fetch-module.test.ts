import { describe, expect, test } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import webFetchModule from "../../src/modules/web-fetch/index.ts";
import { webFetch } from "../../src/modules/web-fetch/fetch.ts";
import { webSearch } from "../../src/modules/web-fetch/search.ts";
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

// ─── Module manifest ────────────────────────────────────────────────
describe("web-fetch module", () => {
	test("exports valid module manifest", () => {
		expect(webFetchModule.name).toBe("web-fetch");
		expect(webFetchModule.version).toBe("1.0.0");
		expect(webFetchModule.tools).toHaveLength(2);
	});

	test("includes all expected tools", () => {
		const names = webFetchModule.tools.map((t) => t.name);
		expect(names).toContain("web.fetch");
		expect(names).toContain("web.search");
	});

	test("declares network clearance", () => {
		expect(webFetchModule.clearance).toEqual(["network"]);
	});
});

// ─── web.fetch ──────────────────────────────────────────────────────
describe("web.fetch", () => {
	test("fails without url parameter", async () => {
		const result = await webFetch.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("rejects invalid URL", async () => {
		const result = await webFetch.execute({ url: "not-a-url" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid URL");
	});

	test("declares network clearance", () => {
		expect(webFetch.clearance).toEqual(["network"]);
	});

	test("has expected parameters", () => {
		const names = webFetch.parameters.map((p) => p.name);
		expect(names).toContain("url");
		expect(names).toContain("method");
		expect(names).toContain("headers");
		expect(names).toContain("body");
		expect(names).toContain("timeout");
	});

	test("rejects file: protocol (SSRF)", async () => {
		const result = await webFetch.execute({ url: "file:///etc/passwd" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});

	test("rejects data: protocol (SSRF)", async () => {
		const result = await webFetch.execute({ url: "data:text/html,hello" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});
});

// ─── web.search ─────────────────────────────────────────────────────
describe("web.search", () => {
	test("fails without query parameter", async () => {
		const result = await webSearch.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("rejects unsupported engine", async () => {
		const result = await webSearch.execute(
			{ query: "test", engine: "bing" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Unsupported");
	});

	test("declares network clearance", () => {
		expect(webSearch.clearance).toEqual(["network"]);
	});

	test("has expected parameters", () => {
		const names = webSearch.parameters.map((p) => p.name);
		expect(names).toContain("query");
		expect(names).toContain("engine");
	});
});
