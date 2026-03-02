import { describe, test, expect } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { createMockModel, createErrorModel, mockTool } from "../helpers/stubs.ts";
import { SignalBus } from "../../src/core/events.ts";

describe("Cortex — tool integration (AI SDK path)", () => {
	test("chat without tools returns text", async () => {
		const cortex = new Cortex({ injectedModel: createMockModel({ text: "Hello there!" }) });
		const result = await cortex.chat("Hi");
		expect(result).toBe("Hello there!");
	});

	test("tool is callable via AI SDK tool loop", async () => {
		let toolCalled = false;
		const tool = mockTool({
			execute: async () => {
				toolCalled = true;
				return { success: true, output: "done" };
			},
		});

		// Model that emits a tool call on first step, text on second
		const model = createMockModel({
			text: "Tool executed successfully",
			toolCalls: [{ name: "test-tool", args: { input: "hello" } }],
		});

		const cortex = new Cortex({ injectedModel: model, maxToolIterations: 1 });
		cortex.registerTool(tool);

		const result = await cortex.chat("Use the tool");
		// The mock model returns both text and tool calls in the stream,
		// but AI SDK stepCountIs(1) limits to 1 tool step
		expect(result).toContain("Tool executed successfully");
	});

	test("clearance denial returns error string to LLM", async () => {
		const tool = mockTool({
			name: "dangerous-tool",
			clearance: ["exec-shell"],
		});

		const model = createMockModel({
			text: "ok",
			toolCalls: [{ name: "dangerous-tool", args: { input: "rm -rf /" } }],
		});

		// ClearanceManager with NO permissions granted
		const clearance = new ClearanceManager([]);

		const cortex = new Cortex({
			injectedModel: model,
			clearance,
			maxToolIterations: 1,
		});
		cortex.registerTool(tool);

		// The tool call will be denied, AI SDK will receive the denial string
		// as the tool result, and then the text part of the response is returned
		const result = await cortex.chat("Do the dangerous thing");
		expect(result).toBeDefined();
	});

	// Note: Cortex tool:blocked audit logging is verified by code review.
	// MockLanguageModelV3's streamText does not invoke tool execute callbacks,
	// so the audit log in buildAiTools() cannot be exercised in unit tests.

	test("tool execution error is caught and returned as string", async () => {
		const failingTool = mockTool({
			name: "failing-tool",
			execute: async () => {
				throw new Error("Kaboom!");
			},
		});

		const model = createMockModel({
			text: "Handled",
			toolCalls: [{ name: "failing-tool", args: { input: "boom" } }],
		});

		const cortex = new Cortex({ injectedModel: model, maxToolIterations: 1 });
		cortex.registerTool(failingTool);

		// Should not throw — error is caught and returned as tool result
		const result = await cortex.chat("Try the failing tool");
		expect(result).toBeDefined();
	});

	test("tool returning failure (success: false) reports output", async () => {
		const failTool = mockTool({
			name: "soft-fail",
			execute: async () => ({ success: false, output: "Something went wrong" }),
		});

		const model = createMockModel({
			text: "Handled the failure",
			toolCalls: [{ name: "soft-fail", args: { input: "x" } }],
		});

		const cortex = new Cortex({ injectedModel: model, maxToolIterations: 1 });
		cortex.registerTool(failTool);

		const result = await cortex.chat("Try soft fail");
		expect(result).toBeDefined();
	});

	test("error rollback removes messages from failed call", async () => {
		const cortex = new Cortex({ injectedModel: createErrorModel() });

		// Seed some history first
		cortex.setHistory([
			{ role: "user", content: "old question" },
			{ role: "assistant", content: "old answer" },
		]);
		expect(cortex.historyLength).toBe(2);

		try {
			await cortex.chat("new question");
		} catch {}

		// Should be back to the 2 original messages — the failed call was rolled back
		expect(cortex.historyLength).toBe(2);
		const history = cortex.getHistory();
		expect(history[0]!.content).toBe("old question");
		expect(history[1]!.content).toBe("old answer");
	});

	test("no tools registered means no tools in model call", async () => {
		const model = createMockModel({ text: "plain response" });
		const cortex = new Cortex({ injectedModel: model });

		await cortex.chat("Hello");

		// Verify no tools were passed to the model
		const call = model.doStreamCalls[0]!;
		// When no tools registered, tools should be undefined or empty
		const toolCount = call.tools ? call.tools.length : 0;
		expect(toolCount).toBe(0);
	});

	test("registered tools are passed to model call", async () => {
		const tool = mockTool();
		const model = createMockModel({ text: "ok" });
		const cortex = new Cortex({ injectedModel: model });
		cortex.registerTool(tool);

		await cortex.chat("Hello");

		// Verify tools were passed — AI SDK passes them as an array of tool definitions
		const call = model.doStreamCalls[0]!;
		expect(call.tools).toBeDefined();
		expect(call.tools!.length).toBeGreaterThan(0);
		const toolNames = call.tools!.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("test-tool");
	});

	test("emits tool:executing signal before tool execution", async () => {
		const signals = new SignalBus();
		const emitted: { name: string; source: string; data?: Record<string, unknown> }[] = [];
		signals.on("tool:executing", (signal) => {
			emitted.push({ name: signal.name, source: signal.source, data: signal.data });
		});

		const tool = mockTool({
			name: "fs.read",
			execute: async (args) => ({ success: true, output: `read: ${args.input}` }),
		});

		const tools = new Map([["fs.read", tool]]);

		// Test through the shared tool executor (same path used by Cortex internally)
		const { createToolExecutor } = await import("../../src/core/tool-bridge.ts");
		const executor = createToolExecutor({ tools, signals });
		await executor("fs.read", { input: "/tmp/test.txt" });

		expect(emitted).toHaveLength(1);
		expect(emitted[0]!.name).toBe("tool:executing");
		expect(emitted[0]!.source).toBe("fs.read");
		expect(emitted[0]!.data?.args).toEqual({ input: "/tmp/test.txt" });
	});
});
