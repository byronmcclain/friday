import type { ModelMessage } from "ai";

export type { ToolDefinition } from "../tool-bridge.ts";
export type { TokenUsage } from "../stream-types.ts";

/** Tool execution event — emitted during agent loop */
export interface ToolEvent {
	type: "start" | "result" | "error";
	toolName: string;
	args?: Record<string, unknown>;
	result?: string;
}

/** What Cortex hands to a Worker */
export interface WorkerRequest {
	systemPrompt: string;
	messages: ModelMessage[];
	tools: import("../tool-bridge.ts").ToolDefinition[];
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
	usage: PromiseLike<import("../stream-types.ts").TokenUsage>;
}

/** The contract all workers implement */
export interface CortexWorker {
	process(request: WorkerRequest): WorkerResult;
}
