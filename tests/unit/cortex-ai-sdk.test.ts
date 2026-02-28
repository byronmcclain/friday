import { describe, test, expect, mock } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { AuditLogger } from "../../src/audit/logger.ts";

describe("Cortex (AI SDK)", () => {
	test("chat returns text response", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "Hello from AI SDK" }),
		});
		const result = await cortex.chat("Hi");
		expect(result).toBe("Hello from AI SDK");
	});

	test("chatStream returns streaming response", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "Streamed" }),
		});
		const stream = await cortex.chatStream("Hi");

		let text = "";
		for await (const chunk of stream.textStream) {
			text += chunk;
		}
		expect(text).toBe("Streamed");

		const full = await stream.fullText;
		expect(full).toBe("Streamed");
	});

	test("chat stores user and assistant messages in history", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "reply" }),
		});
		await cortex.chat("hello");
		expect(cortex.historyLength).toBe(2);
		const history = cortex.getHistory();
		expect(history[0]!.role).toBe("user");
		expect(history[1]!.role).toBe("assistant");
	});

	test("clearHistory resets history", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});
		await cortex.chat("hi");
		cortex.clearHistory();
		expect(cortex.historyLength).toBe(0);
	});

	test("setHistory replaces history", () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});
		cortex.setHistory([
			{ role: "user", content: "old" },
			{ role: "assistant", content: "also old" },
		]);
		expect(cortex.historyLength).toBe(2);
	});

	test("registerTool makes tool available", () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});
		cortex.registerTool({
			name: "test.tool",
			description: "A test tool",
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, output: "ok" }),
		});
		expect(cortex.availableTools).toHaveLength(1);
	});

	test("debug mode logs system prompt to audit", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string }> = [];
		const originalLog = audit.log.bind(audit);
		audit.log = (entry: any) => {
			entries.push(entry);
			originalLog(entry);
		};

		const cortex = new Cortex({
			injectedModel: createMockModel(),
			audit,
			debug: true,
			projectRoot: "/tmp",
		});
		await cortex.chat("test");

		const debugEntry = entries.find(
			(e) => e.action === "debug:system-prompt",
		);
		expect(debugEntry).toBeDefined();
	});

	test("modelName returns configured model", () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
			model: "test-model-id",
		});
		expect(cortex.modelName).toBe("test-model-id");
	});
});
