import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import notifyModule from "../../src/modules/notify/index.ts";
import { notifySend } from "../../src/modules/notify/send.ts";
import type { ToolContext } from "../../src/modules/types.ts";

let mockWebhookServer: ReturnType<typeof Bun.serve>;
let mockWebhookUrl: string;

beforeAll(() => {
	mockWebhookServer = Bun.serve({
		port: 0,
		fetch() {
			return new Response("ok", { status: 200 });
		},
	});
	mockWebhookUrl = `http://localhost:${mockWebhookServer.port}`;
});

afterAll(() => {
	mockWebhookServer.stop();
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
describe("notify module", () => {
	test("exports valid module manifest", () => {
		expect(notifyModule.name).toBe("notify");
		expect(notifyModule.version).toBe("1.0.0");
		expect(notifyModule.tools).toHaveLength(1);
	});

	test("includes notify.send tool", () => {
		const names = notifyModule.tools.map((t) => t.name);
		expect(names).toContain("notify.send");
	});

	test("declares network clearance", () => {
		expect(notifyModule.clearance).toEqual(["network"]);
	});
});

// ─── notify.send ────────────────────────────────────────────────────
describe("notify.send", () => {
	test("fails without title parameter", async () => {
		const result = await notifySend.execute({ body: "test" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("fails without body parameter", async () => {
		const result = await notifySend.execute({ title: "test" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("rejects invalid level", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", level: "critical" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid level");
	});

	test("rejects unsupported channel", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "sms" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Unsupported channel");
	});

	test("fails for webhook without URL configured", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "webhook" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("No webhook URL");
	});

	test("fails for slack without URL configured", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "slack" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("No Slack webhook URL");
	});

	test("fails for email without URL configured", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "email" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("No email webhook URL");
	});

	test("declares network clearance", () => {
		expect(notifySend.clearance).toEqual(["network"]);
	});

	test("has expected parameters", () => {
		const names = notifySend.parameters.map((p) => p.name);
		expect(names).toContain("title");
		expect(names).toContain("body");
		expect(names).toContain("level");
		expect(names).toContain("channel");
		expect(names).toContain("url");
	});

	test("rejects non-http webhook URL (SSRF)", async () => {
		const result = await notifySend.execute(
			{ title: "test", body: "test", channel: "webhook", url: "file:///etc/passwd" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Disallowed protocol");
	});

	test("sends webhook notification successfully", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = Object.assign(async () => new Response("ok", { status: 200 }), { preconnect: globalThis.fetch.preconnect }) as typeof fetch;
		try {
			const result = await notifySend.execute(
				{ title: "Test Alert", body: "Something happened", channel: "webhook", url: "https://hooks.example.com/webhook" },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.output).toContain("Webhook notification sent");
			expect(result.artifacts?.channel).toBe("Webhook");
			expect(result.artifacts?.title).toBe("Test Alert");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("sends slack notification successfully", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = Object.assign(async () => new Response("ok", { status: 200 }), { preconnect: globalThis.fetch.preconnect }) as typeof fetch;
		try {
			const result = await notifySend.execute(
				{ title: "Slack Test", body: "Hello Slack", channel: "slack", url: "https://hooks.slack.com/test" },
				ctx,
			);
			expect(result.success).toBe(true);
			expect(result.output).toContain("Slack notification sent");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
