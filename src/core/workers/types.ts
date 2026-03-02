import type { ModelMessage } from "ai";
import type { ToolDefinition } from "../tool-bridge.ts";

export type { ToolDefinition } from "../tool-bridge.ts";

/** Tool execution event — emitted during agent loop */
export interface ToolEvent {
	type: "start" | "result" | "error";
	toolName: string;
	args?: Record<string, unknown>;
	result?: string;
}

/** Token usage from a worker invocation */
export interface TokenUsage {
	inputTokens: number | undefined;
	outputTokens: number | undefined;
}

/** What Cortex hands to a Worker */
export interface WorkerRequest {
	systemPrompt: string;
	messages: ModelMessage[];
	tools: ToolDefinition[];
	executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	maxToolIterations: number;
	maxOutputTokens: number;
}

/** What a Worker returns */
export interface WorkerResult {
	textStream: AsyncIterable<string>;
	audioStream?: AsyncIterable<string>;
	toolEvents: AsyncIterable<ToolEvent>;
	fullText: PromiseLike<string>;
	usage: PromiseLike<TokenUsage>;
}

/** The contract all workers implement */
export interface CortexWorker {
	process(request: WorkerRequest): WorkerResult;
}
