import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import webFetchModule from "../../src/modules/web-fetch/index.ts";
import { webFetch } from "../../src/modules/web-fetch/fetch.ts";
import { webSearch } from "../../src/modules/web-fetch/search.ts";
import type { ToolContext } from "../../src/modules/types.ts";

let testServer: ReturnType<typeof Bun.serve>;
let testServerUrl: string;

beforeAll(() => {
	testServer = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/json") {
				return new Response(JSON.stringify({ ok: true, data: "test" }), {
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.pathname === "/large") {
				return new Response("x".repeat(2_000_000));
			}
			return new Response("Hello from test server", {
				headers: { "X-Custom": "friday" },
			});
		},
	});
	testServerUrl = `http://localhost:${testServer.port}`;
});

afterAll(() => {
	testServer.stop();
});

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

	test("blocks requests to localhost (SSRF)", async () => {
		const result = await webFetch.execute({ url: testServerUrl }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("localhost");
	});

	test("blocks requests to 127.0.0.1 (SSRF)", async () => {
		const ipUrl = testServerUrl.replace("localhost", "127.0.0.1");
		const result = await webFetch.execute({ url: ipUrl }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("private");
	});

	test("blocks requests to 169.254.169.254 metadata endpoint (SSRF)", async () => {
		const result = await webFetch.execute({ url: "http://169.254.169.254/latest/meta-data/" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("private");
	});

	test("blocks requests to 10.x.x.x (SSRF)", async () => {
		const result = await webFetch.execute({ url: "http://10.0.0.1" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("private");
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
