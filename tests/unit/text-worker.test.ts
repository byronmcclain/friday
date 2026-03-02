import { describe, test, expect } from "bun:test";
import { TextWorker } from "../../src/core/workers/text-worker.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { WorkerRequest } from "../../src/core/workers/types.ts";

function makeRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
	return {
		systemPrompt: "You are Friday.",
		messages: [{ role: "user" as const, content: "Hello" }],
		tools: [],
		executeTool: async () => "mock result",
		maxToolIterations: 10,
		maxOutputTokens: 4096,
		...overrides,
	};
}

describe("TextWorker", () => {
	test("streams text from model", async () => {
		const model = createMockModel({ text: "Hello from TextWorker" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toBe("Hello from TextWorker");
	});

	test("resolves fullText", async () => {
		const model = createMockModel({ text: "Full text here" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		const full = await result.fullText;
		expect(full).toBe("Full text here");
	});

	test("resolves usage", async () => {
		const model = createMockModel({
			text: "hi",
			usage: { inputTokens: 100, outputTokens: 50 },
		});
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		const usage = await result.usage;
		expect(usage.inputTokens).toBe(100);
		expect(usage.outputTokens).toBe(50);
	});

	test("passes system prompt to model", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest({ systemPrompt: "Custom system prompt" }));

		// Consume stream to trigger doStream call
		await result.fullText;

		const call = model.doStreamCalls[0]!;
		const systemPart = (call.prompt as Array<{ role: string; content: string }>).find(
			(p) => p.role === "system",
		);
		expect(systemPart?.content).toBe("Custom system prompt");
	});

	test("passes tools to model when provided", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest({
			tools: [{
				name: "test-tool",
				description: "A test",
				parameters: [{ name: "input", type: "string", description: "x", required: true }],
			}],
		}));

		// Consume stream to trigger doStream call
		await result.fullText;

		const call = model.doStreamCalls[0]!;
		expect(call.tools).toBeDefined();
		expect(call.tools!.length).toBeGreaterThan(0);
	});

	test("does not pass tools when list is empty", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest({ tools: [] }));

		// Consume stream to trigger doStream call
		await result.fullText;

		const call = model.doStreamCalls[0]!;
		const toolCount = call.tools ? call.tools.length : 0;
		expect(toolCount).toBe(0);
	});

	test("audioStream is undefined (text mode)", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());
		expect(result.audioStream).toBeUndefined();
	});
});
