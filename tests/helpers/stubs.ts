import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

/** Helper to create a text ChatResponse */
export function textResponse(text: string): ChatResponse {
	return { type: "text", text, truncated: false };
}

export const stubProvider: LLMProvider = {
	name: "stub",
	defaultModel: "stub-model",
	defaultFastModel: "stub-fast-model",
	chat: async () => textResponse("stub response"),
};

export const grokStub: LLMProvider = {
	name: "grok",
	defaultModel: PROVIDER_DEFAULTS.grok.model,
	defaultFastModel: PROVIDER_DEFAULTS.grok.fastModel,
	chat: async () => textResponse("grok response"),
};

// --- AI SDK v6 mock model ---
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type {
	LanguageModelV3,
	LanguageModelV3Usage,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

export interface MockModelOptions {
	text?: string;
	toolCalls?: Array<{
		name: string;
		args: Record<string, unknown>;
	}>;
	usage?: { inputTokens: number; outputTokens: number };
}

function buildUsage(opts?: {
	inputTokens: number;
	outputTokens: number;
}): LanguageModelV3Usage {
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

export function createMockModel(
	options: MockModelOptions = {},
): LanguageModelV3 {
	const text = options.text ?? "stub response";
	const usage = buildUsage(options.usage);

	return new MockLanguageModelV3({
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
		doStream: {
			stream: simulateReadableStream<LanguageModelV3StreamPart>({
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
			}),
		},
	});
}
