import type { LanguageModelV3 } from "@ai-sdk/provider";
import { streamText, tool as aiTool, stepCountIs } from "ai";
import { toZodSchema } from "../../providers/schemas.ts";
import type { WorkerRequest, WorkerResult, ToolEvent, CortexWorker } from "./types.ts";
import type { ToolDefinition, ToolExecutor } from "../tool-bridge.ts";

/** Empty async iterable — TextWorker delegates tool event signaling to createToolExecutor */
const EMPTY_TOOL_EVENTS: AsyncIterable<ToolEvent> = {
	[Symbol.asyncIterator]() {
		return {
			async next() { return { done: true, value: undefined }; },
		};
	},
};

/**
 * TextWorker — AI SDK streamText() agent loop.
 *
 * Converts portable ToolDefinitions to AI SDK tools,
 * delegates tool execution to the shared executor callback,
 * and returns the standard WorkerResult.
 */
export class TextWorker implements CortexWorker {
	private _lastDefs: ToolDefinition[] | null = null;
	private _lastExecutor: ToolExecutor | null = null;
	private _cachedAiTools: Record<string, ReturnType<typeof aiTool<any, any>>> | null = null;
	private _cachedHasTools = false;

	constructor(private readonly model: LanguageModelV3) {}

	process(request: WorkerRequest): WorkerResult {
		// Cache AI SDK tools — rebuild only when defs or executor change
		if (request.tools !== this._lastDefs || request.executeTool !== this._lastExecutor) {
			const executeTool = request.executeTool;
			const aiTools: Record<string, ReturnType<typeof aiTool<any, any>>> = {};
			for (const def of request.tools) {
				aiTools[def.name] = aiTool({
					description: def.description,
					inputSchema: toZodSchema(def.parameters),
					execute: async (args: Record<string, unknown>) =>
						executeTool(def.name, args),
				});
			}
			this._cachedAiTools = aiTools;
			this._cachedHasTools = Object.keys(aiTools).length > 0;
			this._lastDefs = request.tools;
			this._lastExecutor = request.executeTool;
		}

		const hasTools = this._cachedHasTools;

		// Three-layer timeout defense:
		// 1. stepMs — AI SDK per-step abort (may not fire reliably with reasoning models)
		// 2. chunkMs — abort if no text chunk received for 60s (catches silent hangs)
		// 3. Manual AbortController — hard 5-minute total kill switch
		const stepMs = request.stepTimeoutMs;
		const hardAbort = stepMs !== undefined ? new AbortController() : undefined;
		let hardTimeoutId: ReturnType<typeof setTimeout> | undefined;
		if (hardAbort && stepMs !== undefined) {
			hardTimeoutId = setTimeout(
				() => hardAbort.abort(new Error(`Inference hard timeout (${stepMs * 3}ms total)`)),
				stepMs * 3,
			);
		}

		const result = streamText({
			model: this.model,
			system: request.systemPrompt,
			messages: request.messages,
			...(hasTools ? { tools: this._cachedAiTools! } : {}),
			...(hasTools ? { stopWhen: stepCountIs(request.maxToolIterations) } : {}),
			maxOutputTokens: request.maxOutputTokens,
			...(stepMs !== undefined ? { timeout: { stepMs, chunkMs: 60_000 } } : {}),
			...(hardAbort ? { abortSignal: hardAbort.signal } : {}),
		});

		const fullText = result.text;
		const usage = Promise.resolve(result.usage).then(
			(u: { inputTokens?: number; outputTokens?: number }) => ({
				inputTokens: u?.inputTokens,
				outputTokens: u?.outputTokens,
			}),
		).catch(() => ({ inputTokens: undefined, outputTokens: undefined }));

		// Clear hard timeout when stream finishes (success or error)
		if (hardTimeoutId !== undefined) {
			const clearHard = () => clearTimeout(hardTimeoutId);
			fullText.then(clearHard, clearHard);
		}

		return {
			textStream: result.textStream,
			audioStream: undefined,
			toolEvents: EMPTY_TOOL_EVENTS,
			fullText,
			usage,
		};
	}
}
