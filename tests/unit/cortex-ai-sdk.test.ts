import { describe, test, expect, mock } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel, buildUsage } from "../helpers/stubs.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

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

// Helper: creates a mock model that returns different text per call
function createSequencingModel(responses: string[]): MockLanguageModelV3 {
	let callCount = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			const text = responses[callCount] ?? "";
			callCount++;
			const usage = buildUsage();
			return {
				stream: simulateReadableStream<LanguageModelV3StreamPart>({
					chunks: [
						{ type: "text-start" as const, id: "text-0" },
						...(text
							? [{ type: "text-delta" as const, id: "text-0", delta: text }]
							: []),
						{ type: "text-end" as const, id: "text-0" },
						{
							type: "finish" as const,
							finishReason: { unified: "stop" as const, raw: undefined },
							usage,
						},
					],
					initialDelayInMs: null,
					chunkDelayInMs: null,
				}),
			};
		},
	});
}

describe("Cortex — empty response guard", () => {
	test("retries on empty response and returns retry text", async () => {
		// First call returns empty, second returns real text
		const model = createSequencingModel(["", "Retry worked"]);
		const cortex = new Cortex({ injectedModel: model });
		const result = await cortex.chat("test");
		expect(result).toBe("Retry worked");
	});

	test("returns fallback after all retries exhausted", async () => {
		// All calls return empty
		const model = createSequencingModel(["", "", ""]);
		const cortex = new Cortex({ injectedModel: model });
		const result = await cortex.chat("test");
		expect(result).toContain("empty response");
	});

	test("does not push empty assistant text to history", async () => {
		const model = createSequencingModel(["", "Recovered"]);
		const cortex = new Cortex({ injectedModel: model });
		await cortex.chat("test");
		const history = cortex.getHistory();
		// user + assistant (retried text), no empty entry
		expect(history).toHaveLength(2);
		expect(history[1]!.content).toBe("Recovered");
	});

	test("audit logs inference:empty on empty response", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string; detail: string }> = [];
		audit.log = (entry: any) => { entries.push(entry); };

		const model = createSequencingModel(["", "ok"]);
		const cortex = new Cortex({ injectedModel: model, audit });
		await cortex.chat("test");

		expect(entries.some(e => e.action === "inference:empty")).toBe(true);
	});

	test("audit logs retry-success when retry recovers", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string; detail: string }> = [];
		audit.log = (entry: any) => { entries.push(entry); };

		const model = createSequencingModel(["", "recovered"]);
		const cortex = new Cortex({ injectedModel: model, audit });
		await cortex.chat("test");

		expect(entries.some(e => e.action === "inference:retry-success")).toBe(true);
	});

	test("audit logs empty-fallback when all retries fail", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string; detail: string }> = [];
		audit.log = (entry: any) => { entries.push(entry); };

		const model = createSequencingModel(["", "", ""]);
		const cortex = new Cortex({ injectedModel: model, audit });
		await cortex.chat("test");

		expect(entries.some(e => e.action === "inference:empty-fallback")).toBe(true);
	});

	test("normal non-empty response is unaffected", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "Normal response" }),
		});
		const result = await cortex.chat("test");
		expect(result).toBe("Normal response");
	});

	test("chatStream.textStream yields retry text when first attempt is empty", async () => {
		const model = createSequencingModel(["", "Retry text flows through stream"]);
		const cortex = new Cortex({ injectedModel: model });
		const stream = await cortex.chatStream("test");

		let streamed = "";
		for await (const chunk of stream.textStream) {
			streamed += chunk;
		}
		const full = await stream.fullText;

		expect(streamed).toBe("Retry text flows through stream");
		expect(full).toBe("Retry text flows through stream");
	});

	test("chatStream.textStream yields fallback when all retries fail", async () => {
		const model = createSequencingModel(["", "", "", ""]);
		const cortex = new Cortex({ injectedModel: model });
		const stream = await cortex.chatStream("test");

		let streamed = "";
		for await (const chunk of stream.textStream) {
			streamed += chunk;
		}
		const full = await stream.fullText;

		expect(streamed).toContain("empty response");
		expect(full).toContain("empty response");
		expect(streamed).toBe(full);
	});
});
