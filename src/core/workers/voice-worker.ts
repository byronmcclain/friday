import type {
	WorkerRequest,
	WorkerResult,
	ToolEvent,
	CortexWorker,
} from "./types.ts";
import { createPushIterable, type PushIterable } from "./push-iterable.ts";
import { toGrokTools, type ToolDefinition, type GrokToolDefinition } from "../tool-bridge.ts";

export interface VoiceWorkerConfig {
	send: (data: string) => void;
}

/**
 * VoiceWorker — Grok realtime WebSocket agent loop.
 *
 * Uses Grok as a native agent: reasoning + tool calling + speech.
 * No sentence splitting. No TTS pipe. Grok speaks directly.
 *
 * The session manager calls handleGrokEvent() for each incoming
 * WebSocket message during an active turn.
 */
export class VoiceWorker implements CortexWorker {
	private send: (data: string) => void;
	private textPush: PushIterable<string> | null = null;
	private audioPush: PushIterable<string> | null = null;
	private toolPush: PushIterable<ToolEvent> | null = null;
	private activeRequest: WorkerRequest | null = null;
	private toolIterationCount = 0;
	private _lastDefs: ToolDefinition[] | null = null;
	private _cachedGrokTools: GrokToolDefinition[] | null = null;

	constructor(config: VoiceWorkerConfig) {
		this.send = config.send;
	}

	get isProcessing(): boolean {
		return this.activeRequest !== null;
	}

	process(request: WorkerRequest): WorkerResult {
		this.activeRequest = request;
		this.toolIterationCount = 0;

		// Create push-based streams (only text needs fullValue collection)
		this.textPush = createPushIterable<string>({ collect: true });
		this.audioPush = createPushIterable<string>();
		this.toolPush = createPushIterable<ToolEvent>();

		// 1. Send session.update with enriched system prompt + tools
		if (request.tools !== this._lastDefs) {
			this._cachedGrokTools = toGrokTools(request.tools);
			this._lastDefs = request.tools;
		}
		const grokTools = this._cachedGrokTools!;
		this.send(
			JSON.stringify({
				type: "session.update",
				session: {
					instructions: request.systemPrompt,
					...(grokTools.length > 0 ? { tools: grokTools } : {}),
				},
			}),
		);

		// 2. Send response.create — Grok will respond to the latest
		//    conversation context (user audio already committed by VAD)
		this.send(
			JSON.stringify({
				type: "response.create",
				response: { modalities: ["text", "audio"] },
			}),
		);

		const usage = this.textPush.fullValue.then(() => ({
			inputTokens: undefined,
			outputTokens: undefined,
		}));

		return {
			textStream: this.textPush.iterable,
			audioStream: this.audioPush.iterable,
			toolEvents: this.toolPush.iterable,
			fullText: this.textPush.fullValue,
			usage,
		};
	}

	/**
	 * Route incoming Grok WebSocket events during an active turn.
	 * Called by VoiceSessionManager for each message.
	 */
	async handleGrokEvent(data: Record<string, unknown>): Promise<void> {
		if (!this.textPush || !this.audioPush || !this.toolPush) return;

		switch (data.type) {
			case "response.output_audio.delta": {
				if (data.delta) {
					this.audioPush.push(data.delta as string);
				}
				break;
			}

			case "response.output_audio_transcript.delta": {
				if (data.delta) {
					this.textPush.push(data.delta as string);
				}
				break;
			}

			case "response.function_call_arguments.done": {
				const toolName = data.name as string;
				const callId = data.call_id as string;
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(
						(data.arguments as string) ?? "{}",
					) as Record<string, unknown>;
				} catch {
					this.toolPush.push({ type: "error", toolName, result: "Malformed tool arguments" });
					this.closeTurn();
					break;
				}

				this.toolPush.push({ type: "start", toolName, args });

				// Execute through the shared tool executor
				const result = await this.activeRequest!.executeTool(
					toolName,
					args,
				);

				this.toolPush.push({ type: "result", toolName, result });
				this.toolIterationCount++;

				// Send result back to Grok
				this.send(
					JSON.stringify({
						type: "conversation.item.create",
						item: {
							type: "function_call_output",
							call_id: callId,
							output: result,
						},
					}),
				);

				// Request Grok to continue (with tool result)
				if (
					this.toolIterationCount <
					(this.activeRequest?.maxToolIterations ?? 10)
				) {
					this.send(
						JSON.stringify({
							type: "response.create",
							response: { modalities: ["text", "audio"] },
						}),
					);
				} else {
					// Max iterations reached — close turn
					this.closeTurn();
				}
				break;
			}

			case "response.done": {
				const response = data.response as
					| { status?: string }
					| undefined;
				const status = response?.status ?? "completed";
				if (status === "cancelled") break; // ignore cancelled responses
				// Only close if no pending tool calls
				if (this.activeRequest) {
					this.closeTurn();
				}
				break;
			}
		}
	}

	/** Force-terminate all streams (e.g., on disconnect). */
	abort(): void {
		this.closeTurn();
	}

	private closeTurn(): void {
		this.textPush?.done();
		this.audioPush?.done();
		this.toolPush?.done();
		this.activeRequest = null;
	}
}
