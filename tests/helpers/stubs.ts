// --- AI SDK v7 mock model ---

import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { FridayTool } from "../../src/modules/types.ts";

export interface MockModelOptions {
	text?: string;
	toolCalls?: Array<{
		name: string;
		args: Record<string, unknown>;
	}>;
	usage?: { inputTokens: number; outputTokens: number };
}

export function buildUsage(opts?: {
	inputTokens: number;
	outputTokens: number;
}): LanguageModelV4Usage {
	const input = opts?.inputTokens ?? 10;
	const output = opts?.outputTokens ?? 20;
	return {
		inputTokens: {
			total: input,
			noCache: input,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: {
			total: output,
			text: output,
			reasoning: undefined,
		},
	};
}

export function createMockModel(options: MockModelOptions = {}): MockLanguageModelV4 {
	const text = options.text ?? "stub response";
	const usage = buildUsage(options.usage);

	const buildStream = () =>
		simulateReadableStream<LanguageModelV4StreamPart>({
			chunks: [
				{ type: "text-start" as const, id: "text-0" },
				{ type: "text-delta" as const, id: "text-0", delta: text },
				{ type: "text-end" as const, id: "text-0" },
				...(options.toolCalls?.flatMap((tc, i) => [
					{
						type: "tool-input-start" as const,
						id: `call_${i}`,
						toolName: tc.name,
					},
					{
						type: "tool-input-delta" as const,
						id: `call_${i}`,
						delta: JSON.stringify(tc.args),
					},
					{
						type: "tool-input-end" as const,
						id: `call_${i}`,
					},
				]) ?? []),
				{
					type: "finish" as const,
					finishReason: {
						unified: "stop" as const,
						raw: undefined,
					},
					usage,
				},
			],
			initialDelayInMs: null,
			chunkDelayInMs: null,
		});

	return new MockLanguageModelV4({
		doGenerate: {
			content: [
				{ type: "text" as const, text },
				...(options.toolCalls?.map((tc, i) => ({
					type: "tool-call" as const,
					toolCallId: `call_${i}`,
					toolName: tc.name,
					input: JSON.stringify(tc.args),
				})) ?? []),
			],
			finishReason: { unified: "stop" as const, raw: undefined },
			usage,
			warnings: [],
		},
		// Factory: ReadableStream is single-consume; recreate per call (AI SDK 7)
		doStream: async () => ({ stream: buildStream() }),
	});
}

export function createErrorModel(msg = "API error"): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: async () => {
			throw new Error(msg);
		},
		doStream: async () => {
			throw new Error(msg);
		},
	});
}

// --- Mock FridayTool factory ---

export function mockTool(overrides: Partial<FridayTool> = {}): FridayTool {
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
