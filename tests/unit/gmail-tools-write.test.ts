import { describe, expect, test } from "bun:test";
import { gmailSend } from "../../src/modules/gmail/tools/send.ts";
import { gmailReply } from "../../src/modules/gmail/tools/reply.ts";
import { gmailModify } from "../../src/modules/gmail/tools/modify.ts";
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

describe("gmail.send", () => {
	test("declares network and email-send clearance", () => {
		expect(gmailSend.clearance).toEqual(["network", "email-send"]);
	});

	test("fails without to parameter", async () => {
		const result = await gmailSend.execute(
			{ subject: "Hi", body: "Hello" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("to");
	});

	test("fails without subject parameter", async () => {
		const result = await gmailSend.execute(
			{ to: "a@b.com", body: "Hello" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("subject");
	});

	test("fails without body parameter", async () => {
		const result = await gmailSend.execute(
			{ to: "a@b.com", subject: "Hi" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("body");
	});
});

describe("gmail.reply", () => {
	test("declares network and email-send clearance", () => {
		expect(gmailReply.clearance).toEqual(["network", "email-send"]);
	});

	test("fails without thread_id parameter", async () => {
		const result = await gmailReply.execute({ body: "reply" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("thread_id");
	});

	test("fails without body parameter", async () => {
		const result = await gmailReply.execute({ thread_id: "abc" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("body");
	});
});

describe("gmail.modify", () => {
	test("declares network clearance", () => {
		expect(gmailModify.clearance).toEqual(["network"]);
	});

	test("fails without id parameter", async () => {
		const result = await gmailModify.execute({ action: "archive" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("id");
	});

	test("fails without action parameter", async () => {
		const result = await gmailModify.execute({ id: "abc" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("action");
	});

	test("rejects invalid action", async () => {
		const result = await gmailModify.execute(
			{ id: "abc", action: "explode" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid action");
	});

	test("requires label param for label action", async () => {
		const result = await gmailModify.execute(
			{ id: "abc", action: "label" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.output).toContain("label");
	});
});
