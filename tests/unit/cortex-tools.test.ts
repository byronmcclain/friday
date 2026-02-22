import { describe, test, expect } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import type {
	LLMProvider,
	ChatResponse,
	ChatOptions,
} from "../../src/providers/types.ts";
import type { FridayTool } from "../../src/modules/types.ts";
import type { ContentBlock } from "../../src/core/types.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { textResponse } from "../helpers/stubs.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTool(overrides: Partial<FridayTool> = {}): FridayTool {
	return {
		name: "test-tool",
		description: "A test tool",
		parameters: [
			{
				name: "input",
				type: "string",
				description: "test input",
				required: true,
			},
		],
		clearance: [],
		execute: async (args) => ({
			success: true,
			output: `result: ${args.input}`,
		}),
		...overrides,
	};
}

/**
 * Provider that returns responses in sequence — one per chat() call.
 * Also captures the options passed to chat() for assertion.
 */
function sequencingProvider(
	responses: ChatResponse[],
): LLMProvider & { capturedOptions: ChatOptions[] } {
	let callIndex = 0;
	const capturedOptions: ChatOptions[] = [];
	return {
		name: "sequencing",
		defaultModel: "seq-model",
		chat: async (_sys, _msgs, opts) => {
			capturedOptions.push(opts);
			return responses[callIndex++]!;
		},
		capturedOptions,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cortex — agentic tool loop", () => {
	test("simple text response (no tools)", async () => {
		const provider = sequencingProvider([textResponse("Hello there!")]);
		const cortex = new Cortex({ injectedProvider: provider });

		const result = await cortex.chat("Hi");

		expect(result).toBe("Hello there!");
		expect(cortex.historyLength).toBe(2);
	});

	test("single tool call -> result -> text", async () => {
		const tool = mockTool();
		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{ id: "call-1", name: "test-tool", input: { input: "hello" } },
				],
			},
			textResponse("Tool says: result: hello"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(tool);

		const result = await cortex.chat("Use the tool");

		expect(result).toBe("Tool says: result: hello");
	});

	test("parallel tool calls — two tools called at once", async () => {
		const executionOrder: string[] = [];

		const toolA = mockTool({
			name: "tool-a",
			execute: async (args) => {
				executionOrder.push("a");
				return { success: true, output: `a-result: ${args.input}` };
			},
		});
		const toolB = mockTool({
			name: "tool-b",
			execute: async (args) => {
				executionOrder.push("b");
				return { success: true, output: `b-result: ${args.input}` };
			},
		});

		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{ id: "call-a", name: "tool-a", input: { input: "x" } },
					{ id: "call-b", name: "tool-b", input: { input: "y" } },
				],
			},
			textResponse("Both done"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(toolA);
		cortex.registerTool(toolB);

		const result = await cortex.chat("Use both tools");

		expect(result).toBe("Both done");
		expect(executionOrder).toContain("a");
		expect(executionOrder).toContain("b");
	});

	test("unknown tool returns error result to LLM", async () => {
		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{
						id: "call-bad",
						name: "nonexistent-tool",
						input: { foo: "bar" },
					},
				],
			},
			textResponse("I see that tool was unknown"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });

		const result = await cortex.chat("Use nonexistent tool");

		expect(result).toBe("I see that tool was unknown");

		// Verify the error result was sent back in history
		const history = cortex.getHistory();
		// user -> assistant (tool_use) -> user (tool_result) -> assistant (text)
		const toolResultMsg = history[2]!;
		expect(toolResultMsg.role).toBe("user");
		const blocks = toolResultMsg.content as ContentBlock[];
		const resultBlock = blocks[0]!;
		expect(resultBlock.type).toBe("tool_result");
		if (resultBlock.type === "tool_result") {
			expect(resultBlock.isError).toBe(true);
			expect(resultBlock.content).toContain("Unknown tool");
		}
	});

	test("clearance denial returns error result to LLM", async () => {
		const tool = mockTool({
			name: "dangerous-tool",
			clearance: ["exec-shell"],
		});

		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{
						id: "call-denied",
						name: "dangerous-tool",
						input: { input: "rm -rf /" },
					},
				],
			},
			textResponse("Clearance denied, understood"),
		]);

		// ClearanceManager with NO permissions granted
		const clearance = new ClearanceManager([]);

		const cortex = new Cortex({
			injectedProvider: provider,
			clearance,
		});
		cortex.registerTool(tool);

		const result = await cortex.chat("Do the dangerous thing");

		expect(result).toBe("Clearance denied, understood");

		// Check that error was reported
		const history = cortex.getHistory();
		const toolResultMsg = history[2]!;
		const blocks = toolResultMsg.content as ContentBlock[];
		const resultBlock = blocks[0]!;
		if (resultBlock.type === "tool_result") {
			expect(resultBlock.isError).toBe(true);
			expect(resultBlock.content).toContain("Clearance denied");
		}
	});

	test("max iterations exceeded throws", async () => {
		// Provider always returns tool_use, never text
		const tool = mockTool();
		const infiniteToolUse: ChatResponse = {
			type: "tool_use",
			toolCalls: [
				{ id: "call-loop", name: "test-tool", input: { input: "loop" } },
			],
		};

		const provider = sequencingProvider(
			Array.from({ length: 15 }, () => infiniteToolUse),
		);

		const cortex = new Cortex({
			injectedProvider: provider,
			maxToolIterations: 3,
		});
		cortex.registerTool(tool);

		await expect(cortex.chat("Loop forever")).rejects.toThrow(
			"Max tool iterations (3) exceeded",
		);
	});

	test("tool execution error reported as error result", async () => {
		const failingTool = mockTool({
			name: "failing-tool",
			execute: async () => {
				throw new Error("Kaboom!");
			},
		});

		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{
						id: "call-fail",
						name: "failing-tool",
						input: { input: "boom" },
					},
				],
			},
			textResponse("Tool failed, I see"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(failingTool);

		const result = await cortex.chat("Try the failing tool");

		expect(result).toBe("Tool failed, I see");

		const history = cortex.getHistory();
		const toolResultMsg = history[2]!;
		const blocks = toolResultMsg.content as ContentBlock[];
		const resultBlock = blocks[0]!;
		if (resultBlock.type === "tool_result") {
			expect(resultBlock.isError).toBe(true);
			expect(resultBlock.content).toContain("Tool execution error");
			expect(resultBlock.content).toContain("Kaboom!");
		}
	});

	test("conversation history includes tool interactions", async () => {
		const tool = mockTool();
		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{ id: "call-1", name: "test-tool", input: { input: "data" } },
				],
			},
			textResponse("Final answer"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(tool);

		await cortex.chat("Do something");

		const history = cortex.getHistory();
		// 4 entries: user, assistant (tool_use), user (tool_result), assistant (text)
		expect(history).toHaveLength(4);

		// Entry 0: user message
		expect(history[0]!.role).toBe("user");
		expect(history[0]!.content).toBe("Do something");

		// Entry 1: assistant with tool_use blocks
		expect(history[1]!.role).toBe("assistant");
		const toolUseBlocks = history[1]!.content as ContentBlock[];
		expect(toolUseBlocks[0]!.type).toBe("tool_use");
		if (toolUseBlocks[0]!.type === "tool_use") {
			expect(toolUseBlocks[0]!.name).toBe("test-tool");
			expect(toolUseBlocks[0]!.id).toBe("call-1");
		}

		// Entry 2: user with tool_result blocks
		expect(history[2]!.role).toBe("user");
		const toolResultBlocks = history[2]!.content as ContentBlock[];
		expect(toolResultBlocks[0]!.type).toBe("tool_result");
		if (toolResultBlocks[0]!.type === "tool_result") {
			expect(toolResultBlocks[0]!.toolCallId).toBe("call-1");
			expect(toolResultBlocks[0]!.content).toBe("result: data");
			expect(toolResultBlocks[0]!.isError).toBe(false);
		}

		// Entry 3: assistant final text
		expect(history[3]!.role).toBe("assistant");
		expect(history[3]!.content).toBe("Final answer");
	});

	test("no tools registered -> no tools in options", async () => {
		const provider = sequencingProvider([textResponse("plain response")]);
		const cortex = new Cortex({ injectedProvider: provider });

		await cortex.chat("Hello");

		expect(provider.capturedOptions[0]!.tools).toBeUndefined();
	});

	test("tools registered -> tools in options", async () => {
		const tool = mockTool();
		const provider = sequencingProvider([textResponse("ok")]);
		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(tool);

		await cortex.chat("Hello");

		const opts = provider.capturedOptions[0]!;
		expect(opts.tools).toBeDefined();
		expect(opts.tools).toHaveLength(1);
		expect(opts.tools![0]!.name).toBe("test-tool");
		expect(opts.tools![0]!.description).toBe("A test tool");
		expect(opts.tools![0]!.parameters).toEqual([
			{
				name: "input",
				type: "string",
				description: "test input",
				required: true,
			},
		]);
	});

	test("error rollback removes all messages from failed call", async () => {
		const failingProvider: LLMProvider = {
			name: "failing",
			defaultModel: "fail-model",
			chat: async () => {
				throw new Error("API error");
			},
		};

		const cortex = new Cortex({ injectedProvider: failingProvider });

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

	test("tool returning failure (success: false) sets isError", async () => {
		const failTool = mockTool({
			name: "soft-fail",
			execute: async () => ({ success: false, output: "Something went wrong" }),
		});

		const provider = sequencingProvider([
			{
				type: "tool_use",
				toolCalls: [
					{ id: "call-sf", name: "soft-fail", input: { input: "x" } },
				],
			},
			textResponse("Handled the failure"),
		]);

		const cortex = new Cortex({ injectedProvider: provider });
		cortex.registerTool(failTool);

		const result = await cortex.chat("Try soft fail");

		expect(result).toBe("Handled the failure");

		const history = cortex.getHistory();
		const toolResultMsg = history[2]!;
		const blocks = toolResultMsg.content as ContentBlock[];
		if (blocks[0]!.type === "tool_result") {
			expect(blocks[0]!.isError).toBe(true);
			expect(blocks[0]!.content).toBe("Something went wrong");
		}
	});
});
