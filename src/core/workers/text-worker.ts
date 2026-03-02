import type { LanguageModelV3 } from "@ai-sdk/provider";
import { streamText, tool as aiTool, stepCountIs } from "ai";
import { toZodSchema } from "../../providers/schemas.ts";
import type { WorkerRequest, WorkerResult, ToolEvent, CortexWorker } from "./types.ts";

/**
 * TextWorker — AI SDK streamText() agent loop.
 *
 * Converts portable ToolDefinitions to AI SDK tools,
 * delegates tool execution to the shared executor callback,
 * and returns the standard WorkerResult.
 */
export class TextWorker implements CortexWorker {
	constructor(private model: LanguageModelV3) {}

	process(request: WorkerRequest): WorkerResult {
		// Build AI SDK tools from portable definitions
		const aiTools: Record<string, ReturnType<typeof aiTool<any, any>>> = {};
		for (const def of request.tools) {
			aiTools[def.name] = aiTool({
				description: def.description,
				inputSchema: toZodSchema(def.parameters),
				execute: async (args: Record<string, unknown>) =>
					request.executeTool(def.name, args),
			});
		}

		const hasTools = Object.keys(aiTools).length > 0;

		const result = streamText({
			model: this.model,
			system: request.systemPrompt,
			messages: request.messages,
			...(hasTools ? { tools: aiTools } : {}),
			...(hasTools ? { stopWhen: stepCountIs(request.maxToolIterations) } : {}),
			maxOutputTokens: request.maxOutputTokens,
		});

		const fullText = result.text;
		const usage = Promise.resolve(result.usage).then(
			(u: { inputTokens?: number; outputTokens?: number }) => ({
				inputTokens: u?.inputTokens,
				outputTokens: u?.outputTokens,
			}),
		).catch(() => ({ inputTokens: undefined, outputTokens: undefined }));

		// TextWorker does not emit ToolEvents directly — tool execution
		// signals are emitted by the shared executor (createToolExecutor).
		// An empty async iterable satisfies the interface.
		const toolEvents: AsyncIterable<ToolEvent> = {
			[Symbol.asyncIterator]() {
				return {
					async next() { return { done: true, value: undefined }; },
				};
			},
		};

		return {
			textStream: result.textStream,
			audioStream: undefined,
			toolEvents,
			fullText,
			usage,
		};
	}
}
