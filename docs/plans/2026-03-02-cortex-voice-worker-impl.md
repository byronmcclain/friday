# Cortex Voice Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace VoiceBridge's shoe-horned TTS pipe with a native Grok realtime agent loop — Grok does reasoning, tool calling, AND speech generation in one unified flow. No more sentence splitting.

**Architecture:** VoiceWorker implements CortexWorker, using the Grok realtime WebSocket for native agent turns. VoiceSessionManager replaces VoiceBridge as a thin audio I/O + lifecycle layer. Cortex gains `chatStreamVoice()` that delegates to VoiceWorker the same way `chatStream()` delegates to TextWorker. Both workers share the portable tool bridge (buildToolDefinitions + createToolExecutor).

**Tech Stack:** TypeScript, Bun, bun:test, Grok Voice Agent API (WebSocket), AI SDK v6 (shared types)

**Design doc:** `docs/plans/2026-03-02-cortex-dual-mode-design.md`

**Baseline:** 1104 tests across 102 files

---

## Phase 3: VoiceWorker + Cortex Voice API

### Task 1: PushIterable Utility — Failing Tests

VoiceWorker needs push-based async iterables (WebSocket events push data into streams that consumers iterate). This utility creates an AsyncIterable that you can `.push(value)` and `.done()` from the producer side.

**Files:**
- Create: `tests/unit/push-iterable.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { createPushIterable } from "../../src/core/workers/push-iterable.ts";

describe("createPushIterable", () => {
	test("yields pushed values in order", async () => {
		const { push, done, iterable } = createPushIterable<string>();
		push("a");
		push("b");
		push("c");
		done();

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual(["a", "b", "c"]);
	});

	test("resolves next() when value pushed after await", async () => {
		const { push, done, iterable } = createPushIterable<number>();
		const iter = iterable[Symbol.asyncIterator]();

		// Push after a microtask delay
		setTimeout(() => {
			push(42);
			done();
		}, 0);

		const first = await iter.next();
		expect(first).toEqual({ value: 42, done: false });
		const last = await iter.next();
		expect(last.done).toBe(true);
	});

	test("done() terminates iteration", async () => {
		const { done, iterable } = createPushIterable<string>();
		done();

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual([]);
	});

	test("push after done is ignored", async () => {
		const { push, done, iterable } = createPushIterable<string>();
		push("before");
		done();
		push("after");

		const values: string[] = [];
		for await (const v of iterable) {
			values.push(v);
		}
		expect(values).toEqual(["before"]);
	});

	test("error() rejects pending next()", async () => {
		const { error, iterable } = createPushIterable<string>();
		const iter = iterable[Symbol.asyncIterator]();

		setTimeout(() => error(new Error("boom")), 0);

		try {
			await iter.next();
			expect(true).toBe(false); // should not reach
		} catch (err) {
			expect((err as Error).message).toBe("boom");
		}
	});

	test("collects fullValue when done", async () => {
		const { push, done, fullValue } = createPushIterable<string>();
		push("hello ");
		push("world");
		done();

		const result = await fullValue;
		expect(result).toBe("hello world");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-iterable.test.ts`
Expected: FAIL — module not found

---

### Task 2: PushIterable Utility — Implementation

**Files:**
- Create: `src/core/workers/push-iterable.ts`

**Step 1: Write the implementation**

```typescript
export interface PushIterable<T> {
	push(value: T): void;
	done(): void;
	error(err: Error): void;
	iterable: AsyncIterable<T>;
	/** Resolves to all pushed values joined (string only). */
	fullValue: Promise<string>;
}

/**
 * Creates a push-based AsyncIterable.
 * Producer calls push()/done()/error(). Consumer iterates with for-await-of.
 */
export function createPushIterable<T>(): PushIterable<T> {
	const queue: T[] = [];
	let resolve: ((result: IteratorResult<T>) => void) | null = null;
	let reject: ((err: Error) => void) | null = null;
	let isDone = false;
	const collected: string[] = [];

	let fullResolve: (value: string) => void;
	let fullReject: (err: Error) => void;
	const fullValue = new Promise<string>((res, rej) => {
		fullResolve = res;
		fullReject = rej;
	});

	return {
		push(value: T) {
			if (isDone) return;
			if (typeof value === "string") collected.push(value);
			if (resolve) {
				const r = resolve;
				resolve = null;
				reject = null;
				r({ value, done: false });
			} else {
				queue.push(value);
			}
		},
		done() {
			isDone = true;
			fullResolve!(collected.join(""));
			if (resolve) {
				const r = resolve;
				resolve = null;
				reject = null;
				r({ value: undefined as T, done: true });
			}
		},
		error(err: Error) {
			isDone = true;
			fullReject!(err);
			if (reject) {
				const rj = reject;
				resolve = null;
				reject = null;
				rj(err);
			}
		},
		iterable: {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<T>> {
						if (queue.length > 0) {
							return Promise.resolve({ value: queue.shift()!, done: false });
						}
						if (isDone) {
							return Promise.resolve({ value: undefined as T, done: true });
						}
						return new Promise<IteratorResult<T>>((res, rej) => {
							resolve = res;
							reject = rej;
						});
					},
				};
			},
		},
		fullValue,
	};
}
```

**Step 2: Run tests**

Run: `bun test tests/unit/push-iterable.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/workers/push-iterable.ts tests/unit/push-iterable.test.ts
git commit -m "feat(cortex): add PushIterable utility for push-based async iterables"
```

---

### Task 3: toGrokTools Converter — Failing Tests

Grok realtime API expects tools in JSON Schema format (not Zod). This converter turns our portable `ToolDefinition[]` into the Grok `session.update` tools array format.

**Files:**
- Modify: `tests/unit/tool-bridge.test.ts`

**Step 1: Add failing tests for toGrokTools**

Append to `tests/unit/tool-bridge.test.ts`:

```typescript
import { toGrokTools } from "../../src/core/tool-bridge.ts";

describe("toGrokTools", () => {
	test("empty definitions returns empty array", () => {
		expect(toGrokTools([])).toEqual([]);
	});

	test("converts single tool to Grok function format", () => {
		const defs = [{
			name: "git.status",
			description: "Get git status",
			parameters: [
				{ name: "path", type: "string" as const, description: "repo path", required: true },
			],
		}];
		const result = toGrokTools(defs);
		expect(result).toHaveLength(1);
		expect(result[0]!.type).toBe("function");
		expect(result[0]!.name).toBe("git.status");
		expect(result[0]!.description).toBe("Get git status");
		expect(result[0]!.parameters.type).toBe("object");
		expect(result[0]!.parameters.properties.path).toEqual({
			type: "string",
			description: "repo path",
		});
		expect(result[0]!.parameters.required).toEqual(["path"]);
	});

	test("optional parameters are not in required array", () => {
		const defs = [{
			name: "test",
			description: "Test",
			parameters: [
				{ name: "a", type: "string" as const, description: "required", required: true },
				{ name: "b", type: "number" as const, description: "optional", required: false },
			],
		}];
		const result = toGrokTools(defs);
		expect(result[0]!.parameters.required).toEqual(["a"]);
		expect(result[0]!.parameters.properties.b).toEqual({
			type: "number",
			description: "optional",
		});
	});

	test("handles all parameter types", () => {
		const defs = [{
			name: "multi",
			description: "Multi-type",
			parameters: [
				{ name: "s", type: "string" as const, description: "str", required: true },
				{ name: "n", type: "number" as const, description: "num", required: true },
				{ name: "b", type: "boolean" as const, description: "bool", required: true },
				{ name: "a", type: "array" as const, description: "arr", required: false },
				{ name: "o", type: "object" as const, description: "obj", required: false },
			],
		}];
		const result = toGrokTools(defs);
		expect(result[0]!.parameters.properties.s.type).toBe("string");
		expect(result[0]!.parameters.properties.n.type).toBe("number");
		expect(result[0]!.parameters.properties.b.type).toBe("boolean");
		expect(result[0]!.parameters.properties.a.type).toBe("array");
		expect(result[0]!.parameters.properties.o.type).toBe("object");
	});

	test("tool with no parameters has empty properties", () => {
		const defs = [{
			name: "simple",
			description: "No params",
			parameters: [],
		}];
		const result = toGrokTools(defs);
		expect(result[0]!.parameters.properties).toEqual({});
		expect(result[0]!.parameters.required).toEqual([]);
	});
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: FAIL — `toGrokTools` not exported

---

### Task 4: toGrokTools Converter — Implementation

**Files:**
- Modify: `src/core/tool-bridge.ts`

**Step 1: Add types and converter function**

Append to `src/core/tool-bridge.ts`:

```typescript
/** Grok realtime API function tool definition */
export interface GrokToolDefinition {
	type: "function";
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, { type: string; description: string }>;
		required: string[];
	};
}

/** Convert portable ToolDefinitions to Grok realtime API function format */
export function toGrokTools(defs: ToolDefinition[]): GrokToolDefinition[] {
	return defs.map((def) => {
		const properties: Record<string, { type: string; description: string }> = {};
		const required: string[] = [];

		for (const param of def.parameters) {
			properties[param.name] = {
				type: param.type,
				description: param.description,
			};
			if (param.required) {
				required.push(param.name);
			}
		}

		return {
			type: "function" as const,
			name: def.name,
			description: def.description,
			parameters: {
				type: "object" as const,
				properties,
				required,
			},
		};
	});
}
```

**Step 2: Run tests**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/tool-bridge.ts tests/unit/tool-bridge.test.ts
git commit -m "feat(cortex): add toGrokTools — ToolDefinition to Grok realtime format converter"
```

---

### Task 5: VoiceWorker — Failing Tests

The core of Phase 3. VoiceWorker implements CortexWorker using the Grok realtime WebSocket as a native agent loop. It receives a `send` function (for WebSocket writes) and a `handleGrokEvent` method is called by the session manager for incoming Grok events during a turn.

**Files:**
- Create: `tests/unit/voice-worker.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { VoiceWorker, type VoiceWorkerConfig } from "../../src/core/workers/voice-worker.ts";
import type { WorkerRequest } from "../../src/core/workers/types.ts";

function makeConfig(overrides: Partial<VoiceWorkerConfig> = {}): VoiceWorkerConfig {
	const sent: string[] = [];
	return {
		send: (data: string) => sent.push(data),
		...overrides,
	};
}

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

describe("VoiceWorker", () => {
	test("constructs without error", () => {
		const worker = new VoiceWorker(makeConfig());
		expect(worker).toBeDefined();
	});

	test("process sends session.update with system prompt", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(makeConfig({ send: (d) => sent.push(d) }));
		worker.process(makeRequest({ systemPrompt: "Custom prompt" }));

		const sessionUpdate = sent.map(s => JSON.parse(s)).find(m => m.type === "session.update");
		expect(sessionUpdate).toBeDefined();
		expect(sessionUpdate.session.instructions).toBe("Custom prompt");
	});

	test("process sends tools in Grok format via session.update", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(makeConfig({ send: (d) => sent.push(d) }));
		worker.process(makeRequest({
			tools: [{
				name: "git.status",
				description: "Get status",
				parameters: [{ name: "path", type: "string", description: "repo", required: true }],
			}],
		}));

		const sessionUpdate = sent.map(s => JSON.parse(s)).find(m => m.type === "session.update");
		expect(sessionUpdate.session.tools).toHaveLength(1);
		expect(sessionUpdate.session.tools[0].type).toBe("function");
		expect(sessionUpdate.session.tools[0].name).toBe("git.status");
	});

	test("process sends response.create with audio+text modalities", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(makeConfig({ send: (d) => sent.push(d) }));
		worker.process(makeRequest());

		const responseCreate = sent.map(s => JSON.parse(s)).find(m => m.type === "response.create");
		expect(responseCreate).toBeDefined();
		expect(responseCreate.response.modalities).toEqual(["text", "audio"]);
	});

	test("audioStream yields audio deltas from Grok", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({ type: "response.output_audio.delta", delta: "base64audio1" });
		worker.handleGrokEvent({ type: "response.output_audio.delta", delta: "base64audio2" });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const chunks: string[] = [];
		for await (const chunk of result.audioStream!) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual(["base64audio1", "base64audio2"]);
	});

	test("textStream yields transcript deltas from Grok", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Hello " });
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "there." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toBe("Hello there.");
	});

	test("fullText resolves to complete transcript", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Full " });
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "response." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const full = await result.fullText;
		expect(full).toBe("Full response.");
	});

	test("handles function_call → executeTool → function_call_output cycle", async () => {
		const sent: string[] = [];
		const executedTools: Array<{ name: string; args: Record<string, unknown> }> = [];
		const worker = new VoiceWorker(makeConfig({ send: (d) => sent.push(d) }));
		const result = worker.process(makeRequest({
			executeTool: async (name, args) => {
				executedTools.push({ name, args });
				return "tool result here";
			},
			tools: [{
				name: "git.status",
				description: "Status",
				parameters: [{ name: "path", type: "string", description: "p", required: true }],
			}],
		}));

		// Simulate Grok calling a function
		await worker.handleGrokEvent({
			type: "response.function_call_arguments.done",
			name: "git.status",
			call_id: "call_abc",
			arguments: JSON.stringify({ path: "/repo" }),
		});

		// Tool should have been executed
		expect(executedTools).toHaveLength(1);
		expect(executedTools[0]!.name).toBe("git.status");
		expect(executedTools[0]!.args).toEqual({ path: "/repo" });

		// Should have sent function_call_output + response.create
		const outputMsg = sent.map(s => JSON.parse(s)).find(
			(m) => m.type === "conversation.item.create" && m.item?.type === "function_call_output"
		);
		expect(outputMsg).toBeDefined();
		expect(outputMsg.item.call_id).toBe("call_abc");
		expect(outputMsg.item.output).toBe("tool result here");

		const continueMsg = sent.map(s => JSON.parse(s)).filter(m => m.type === "response.create");
		// At least 2: initial + after tool
		expect(continueMsg.length).toBeGreaterThanOrEqual(2);

		// Now Grok responds with audio after tool result
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Done." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const full = await result.fullText;
		expect(full).toBe("Done.");
	});

	test("toolEvents emits start and result events", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest({
			executeTool: async () => "ok",
			tools: [{
				name: "bash.exec",
				description: "Run",
				parameters: [{ name: "cmd", type: "string", description: "c", required: true }],
			}],
		}));

		await worker.handleGrokEvent({
			type: "response.function_call_arguments.done",
			name: "bash.exec",
			call_id: "call_1",
			arguments: JSON.stringify({ cmd: "ls" }),
		});
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const events = [];
		for await (const ev of result.toolEvents) {
			events.push(ev);
		}
		expect(events).toHaveLength(2);
		expect(events[0]!.type).toBe("start");
		expect(events[0]!.toolName).toBe("bash.exec");
		expect(events[1]!.type).toBe("result");
		expect(events[1]!.result).toBe("ok");
	});

	test("response.done with cancelled status does not close streams", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({ type: "response.done", response: { status: "cancelled" } });
		// Streams should still be open — push more data
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "After cancel." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const full = await result.fullText;
		expect(full).toBe("After cancel.");
	});

	test("abort() terminates all streams", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "partial" });
		worker.abort();

		// Streams should terminate
		const full = await result.fullText;
		expect(full).toBe("partial");
	});
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/voice-worker.test.ts`
Expected: FAIL — module not found

---

### Task 6: VoiceWorker — Implementation

**Files:**
- Create: `src/core/workers/voice-worker.ts`

**Step 1: Write the implementation**

```typescript
import type { WorkerRequest, WorkerResult, ToolEvent, CortexWorker } from "./types.ts";
import { createPushIterable, type PushIterable } from "./push-iterable.ts";
import { toGrokTools } from "../tool-bridge.ts";

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

	constructor(config: VoiceWorkerConfig) {
		this.send = config.send;
	}

	get isProcessing(): boolean {
		return this.activeRequest !== null;
	}

	process(request: WorkerRequest): WorkerResult {
		this.activeRequest = request;
		this.toolIterationCount = 0;

		// Create push-based streams
		this.textPush = createPushIterable<string>();
		this.audioPush = createPushIterable<string>();
		this.toolPush = createPushIterable<ToolEvent>();

		// 1. Send session.update with enriched system prompt + tools
		const grokTools = toGrokTools(request.tools);
		this.send(JSON.stringify({
			type: "session.update",
			session: {
				instructions: request.systemPrompt,
				...(grokTools.length > 0 ? { tools: grokTools } : {}),
			},
		}));

		// 2. Send response.create — Grok will respond to the latest
		//    conversation context (user audio already committed by VAD)
		this.send(JSON.stringify({
			type: "response.create",
			response: { modalities: ["text", "audio"] },
		}));

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
	async handleGrokEvent(data: Record<string, any>): Promise<void> {
		if (!this.textPush || !this.audioPush || !this.toolPush) return;

		switch (data.type) {
			case "response.output_audio.delta": {
				if (data.delta) {
					this.audioPush.push(data.delta);
				}
				break;
			}

			case "response.output_audio_transcript.delta": {
				if (data.delta) {
					this.textPush.push(data.delta);
				}
				break;
			}

			case "response.function_call_arguments.done": {
				const toolName = data.name;
				const callId = data.call_id;
				const args = JSON.parse(data.arguments ?? "{}");

				this.toolPush.push({ type: "start", toolName, args });

				// Execute through the shared tool executor
				const result = await this.activeRequest!.executeTool(toolName, args);

				this.toolPush.push({ type: "result", toolName, result });
				this.toolIterationCount++;

				// Send result back to Grok
				this.send(JSON.stringify({
					type: "conversation.item.create",
					item: {
						type: "function_call_output",
						call_id: callId,
						output: result,
					},
				}));

				// Request Grok to continue (with tool result)
				if (this.toolIterationCount < (this.activeRequest?.maxToolIterations ?? 10)) {
					this.send(JSON.stringify({
						type: "response.create",
						response: { modalities: ["text", "audio"] },
					}));
				} else {
					// Max iterations reached — close turn
					this.closeTurn();
				}
				break;
			}

			case "response.done": {
				const status = data.response?.status ?? "completed";
				if (status === "cancelled") break; // ignore cancelled responses
				// Only close if no pending tool calls (function_call would have triggered response.create)
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
```

**Step 2: Run tests**

Run: `bun test tests/unit/voice-worker.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/workers/voice-worker.ts tests/unit/voice-worker.test.ts
git commit -m "feat(cortex): add VoiceWorker — Grok realtime native agent loop

Implements CortexWorker. Grok does reasoning + tool calling + speech
in one unified flow. No sentence splitting. No TTS pipe."
```

---

### Task 7: VoiceChatStream Type

**Files:**
- Modify: `src/core/stream-types.ts`

**Step 1: Add VoiceChatStream**

Append to `src/core/stream-types.ts`:

```typescript
import type { ToolEvent } from "./workers/types.ts";

/** Voice streaming response — extends ChatStream with audio and tool events */
export interface VoiceChatStream extends ChatStream {
	/** Async iterable of base64-encoded PCM audio chunks */
	audioStream: AsyncIterable<string>;
	/** Async iterable of tool execution events for narration */
	toolEvents: AsyncIterable<ToolEvent>;
}
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 3: Commit**

```bash
git add src/core/stream-types.ts
git commit -m "feat(cortex): add VoiceChatStream type — extends ChatStream with audio + toolEvents"
```

---

### Task 8: Cortex.chatStreamVoice() — Failing Tests

**Files:**
- Create: `tests/unit/cortex-voice.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { VoiceWorker, type VoiceWorkerConfig } from "../../src/core/workers/voice-worker.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { VoiceChatStream } from "../../src/core/stream-types.ts";

describe("Cortex.chatStreamVoice", () => {
	test("returns VoiceChatStream with audioStream", async () => {
		const sent: string[] = [];
		const model = createMockModel({ text: "unused" }); // TextWorker model, not used for voice
		const cortex = new Cortex({ injectedModel: model });

		const workerConfig: VoiceWorkerConfig = { send: (d) => sent.push(d) };
		const worker = new VoiceWorker(workerConfig);

		const stream: VoiceChatStream = await cortex.chatStreamVoice("Hello", worker);

		expect(stream.audioStream).toBeDefined();
		expect(stream.toolEvents).toBeDefined();
		expect(stream.textStream).toBeDefined();
		expect(stream.fullText).toBeDefined();

		// session.update should contain enriched system prompt
		const sessionUpdate = sent.map(s => JSON.parse(s)).find(m => m.type === "session.update");
		expect(sessionUpdate).toBeDefined();
		// System prompt should contain the genesis template (default)
		expect(sessionUpdate.session.instructions).toContain("FRIDAY");

		// Simulate Grok response
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Hi there." });
		worker.handleGrokEvent({ type: "response.output_audio.delta", delta: "audiodata" });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		const fullText = await stream.fullText;
		expect(fullText).toBe("Hi there.");
	});

	test("records voice response in history", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const worker = new VoiceWorker({ send: () => {} });

		const stream = await cortex.chatStreamVoice("What time is it?", worker);

		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "It's noon." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });

		await stream.fullText;

		// History should have user + assistant messages
		const history = cortex.getHistory();
		expect(history.length).toBeGreaterThanOrEqual(2);
		expect(history[history.length - 2]!.role).toBe("user");
		expect(history[history.length - 2]!.content).toBe("What time is it?");
		expect(history[history.length - 1]!.role).toBe("assistant");
		expect(history[history.length - 1]!.content).toBe("It's noon.");
	});

	test("passes registered tools to VoiceWorker", async () => {
		const sent: string[] = [];
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });

		cortex.registerTool({
			name: "git.status",
			description: "Get git status",
			parameters: [{ name: "path", type: "string", description: "repo", required: true }],
			clearance: [],
			execute: async () => ({ success: true, output: "clean" }),
		});

		const worker = new VoiceWorker({ send: (d) => sent.push(d) });
		const stream = await cortex.chatStreamVoice("Check git", worker);

		const sessionUpdate = sent.map(s => JSON.parse(s)).find(m => m.type === "session.update");
		expect(sessionUpdate.session.tools).toHaveLength(1);
		expect(sessionUpdate.session.tools[0].name).toBe("git.status");

		// Complete the turn
		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Clean." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });
		await stream.fullText;
	});

	test("does not fire Vox.speak in voice mode", async () => {
		const model = createMockModel({ text: "unused" });
		let voxCalled = false;
		const cortex = new Cortex({
			injectedModel: model,
			vox: { mode: "on", speak: async () => { voxCalled = true; } } as any,
		});
		const worker = new VoiceWorker({ send: () => {} });
		const stream = await cortex.chatStreamVoice("Hello", worker);

		worker.handleGrokEvent({ type: "response.output_audio_transcript.delta", delta: "Hi." });
		worker.handleGrokEvent({ type: "response.done", response: { status: "completed" } });
		await stream.fullText;

		expect(voxCalled).toBe(false);
	});
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/cortex-voice.test.ts`
Expected: FAIL — `chatStreamVoice` not a function

---

### Task 9: Cortex.chatStreamVoice() — Implementation

**Files:**
- Modify: `src/core/cortex.ts`

**Step 1: Add imports**

Add to existing imports in `src/core/cortex.ts`:

```typescript
import { VoiceWorker } from "./workers/voice-worker.ts";
import type { VoiceChatStream } from "./stream-types.ts";
```

**Step 2: Add chatStreamVoice method after chatStream**

Add the following method to the Cortex class, after the existing `chat()` method:

```typescript
	async chatStreamVoice(userMessage: string, voiceWorker: VoiceWorker): Promise<VoiceChatStream> {
		await this.historyManager.compact();
		const systemPrompt = await this.buildSystemPrompt(userMessage);
		this.historyManager.push({ role: "user", content: userMessage });

		// Cached tool infrastructure — rebuilt only when tools change
		const defs = this._cachedDefs ??= buildToolDefinitions(this.tools);
		const executor = this._cachedExecutor ??= createToolExecutor({
			tools: this.tools,
			clearance: this.clearance,
			audit: this.audit,
			signals: this.signals,
			toolMemory: this.toolMemory,
		});

		// Delegate to VoiceWorker
		const workerResult = voiceWorker.process({
			systemPrompt,
			messages: this.historyManager.toMessages(),
			tools: defs,
			executeTool: executor,
			maxToolIterations: this.maxToolIterations,
			maxOutputTokens: this.maxTokens,
		});

		// Record in history when complete — do NOT fire Vox (Grok speaks directly)
		const fullTextPromise = workerResult.fullText.then(async (text: string) => {
			this.historyManager.push({ role: "assistant", content: text });

			const usage = await workerResult.usage;
			if (usage?.inputTokens != null && usage?.outputTokens != null) {
				this.historyManager.recordUsage(
					usage.inputTokens + usage.outputTokens,
				);
			}
			return text;
		});

		return {
			textStream: workerResult.textStream,
			audioStream: workerResult.audioStream!,
			toolEvents: workerResult.toolEvents,
			fullText: fullTextPromise,
			usage: workerResult.usage,
		};
	}
```

**Step 3: Run tests**

Run: `bun test tests/unit/cortex-voice.test.ts`
Expected: All pass

**Step 4: Run full test suite**

Run: `bun test`
Expected: All existing tests pass + new tests

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 6: Commit**

```bash
git add src/core/cortex.ts src/core/stream-types.ts tests/unit/cortex-voice.test.ts
git commit -m "feat(cortex): add chatStreamVoice() — Grok native voice agent pathway

Cortex now has two I/O pathways: chatStream() (TextWorker/AI SDK) and
chatStreamVoice() (VoiceWorker/Grok realtime). Both share the same
system prompt, tools, history, and clearance infrastructure."
```

---

## Phase 4: VoiceSessionManager + Handler Integration

### Task 10: VoiceSessionManager — Failing Tests

VoiceSessionManager replaces VoiceBridge. It's a thin layer that:
- Manages the Grok WebSocket lifecycle (connect/disconnect)
- Forwards audio from the browser microphone
- Handles VAD events (speech_started/stopped)
- Routes transcript to `cortex.chatStreamVoice()` via VoiceWorker
- Forwards audio/transcript from VoiceWorker streams to the browser
- Cancels unexpected auto-responses

**Files:**
- Create: `tests/unit/voice-session-manager.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect, mock } from "bun:test";
import {
	VoiceSessionManager,
	type VoiceSessionConfig,
	type VoiceSessionCallbacks,
} from "../../src/core/voice/session-manager.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel } from "../helpers/stubs.ts";

function makeMockCallbacks(): VoiceSessionCallbacks {
	return {
		onAudioDelta: mock(() => {}),
		onTranscriptDelta: mock(() => {}),
		onStateChange: mock(() => {}),
		onUserTranscript: mock(() => {}),
	};
}

/** Simulate Grok WebSocket that auto-acks session.update */
function attachMockWs(manager: VoiceSessionManager): string[] {
	const sent: string[] = [];
	const ws = {
		send: (d: string) => {
			sent.push(d);
			const parsed = JSON.parse(d);
			if (parsed.type === "session.update") {
				setTimeout(() => {
					(manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
				}, 0);
			}
		},
		readyState: 1,
		close: () => {},
	};
	(manager as any).grokWs = ws;
	(manager as any).active = true;
	(manager as any)._initialSetupDone = true;
	return sent;
}

describe("VoiceSessionManager", () => {
	test("constructs without error", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const config: VoiceSessionConfig = {
			voice: "Eve",
			sampleRate: 48000,
			instructions: "Test",
		};
		const manager = new VoiceSessionManager(cortex, config, makeMockCallbacks());
		expect(manager).toBeDefined();
		expect(manager.isActive).toBe(false);
	});

	test("appendAudio forwards to Grok WebSocket", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const config: VoiceSessionConfig = { voice: "Eve", sampleRate: 48000, instructions: "Test" };
		const manager = new VoiceSessionManager(cortex, config, makeMockCallbacks());
		const sent = attachMockWs(manager);

		manager.appendAudio("base64pcm");

		const audioMsg = sent.map(s => JSON.parse(s)).find(m => m.type === "input_audio_buffer.append");
		expect(audioMsg).toBeDefined();
		expect(audioMsg.audio).toBe("base64pcm");
	});

	test("speech_started triggers listening state", () => {
		const callbacks = makeMockCallbacks();
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		attachMockWs(manager);

		(manager as any).handleGrokMessage(JSON.stringify({
			type: "input_audio_buffer.speech_started",
		}));

		expect(callbacks.onStateChange).toHaveBeenCalledWith("listening");
	});

	test("transcript routes through Cortex voice pathway", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		const sent = attachMockWs(manager);

		// Simulate transcript
		await (manager as any).handleGrokMessage(JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What is the git status?",
		}));

		// Should have called cortex.chatStreamVoice → VoiceWorker → session.update + response.create
		const sessionUpdate = sent.map(s => JSON.parse(s)).find(m =>
			m.type === "session.update" && m.session?.instructions?.includes("FRIDAY")
		);
		expect(sessionUpdate).toBeDefined();

		const responseCreate = sent.map(s => JSON.parse(s)).find(m => m.type === "response.create");
		expect(responseCreate).toBeDefined();
	});

	test("cancels unexpected auto-responses", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		// Simulate unexpected response.created (auto-response from VAD)
		(manager as any).handleGrokMessage(JSON.stringify({
			type: "response.created",
			response: { id: "auto-123" },
		}));

		const cancel = sent.map(s => JSON.parse(s)).find(m => m.type === "response.cancel");
		expect(cancel).toBeDefined();
	});

	test("stop cleans up state", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		attachMockWs(manager);

		await manager.stop();

		expect(manager.isActive).toBe(false);
		expect(callbacks.onStateChange).toHaveBeenCalledWith("idle");
	});
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/voice-session-manager.test.ts`
Expected: FAIL — module not found

---

### Task 11: VoiceSessionManager — Implementation

**Files:**
- Create: `src/core/voice/session-manager.ts`

**Step 1: Write the implementation**

```typescript
import type { Cortex } from "../cortex.ts";
import { type GrokVoice, VOX_WS_URL } from "./types.ts";
import { VoiceWorker } from "../workers/voice-worker.ts";
import type { VoiceChatStream } from "../stream-types.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceSessionConfig {
	voice: GrokVoice;
	sampleRate: number;
	instructions: string;
}

export interface VoiceSessionCallbacks {
	onAudioDelta: (base64: string) => void;
	onTranscriptDelta: (text: string, done: boolean) => void;
	onStateChange: (state: VoiceState) => void;
	onUserTranscript: (text: string) => void;
}

/**
 * VoiceSessionManager — thin audio I/O + lifecycle layer.
 *
 * Replaces VoiceBridge. Manages the Grok WebSocket, handles VAD events,
 * and routes transcripts through Cortex.chatStreamVoice() for native
 * Grok agent processing (reasoning + tool calling + speech).
 */
export class VoiceSessionManager {
	private grokWs: WebSocket | null = null;
	private cortex: Cortex;
	private config: VoiceSessionConfig;
	private callbacks: VoiceSessionCallbacks;
	private active = false;
	private _generation = 0;
	private _initialSetupDone = false;
	private _processingUtterance = false;
	private voiceWorker: VoiceWorker | null = null;
	private activeStream: VoiceChatStream | null = null;
	private debug = true; // TODO: gate behind env var

	constructor(
		cortex: Cortex,
		config: VoiceSessionConfig,
		callbacks: VoiceSessionCallbacks,
	) {
		this.cortex = cortex;
		this.config = config;
		this.callbacks = callbacks;
	}

	private log(tag: string, ...args: unknown[]): void {
		if (!this.debug) return;
		console.log(`[VoiceSession:${tag}]`, ...args);
	}

	get isActive(): boolean {
		return this.active;
	}

	async start(): Promise<void> {
		if (this.active) throw new Error("Voice session already active");

		const apiKey = process.env.XAI_API_KEY;
		if (!apiKey) throw new Error("XAI_API_KEY not set");

		this.active = true;
		this._generation++;
		const gen = this._generation;
		this.callbacks.onStateChange("idle");

		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(VOX_WS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			} as any);

			const timeout = setTimeout(() => {
				reject(new Error("Grok voice connection timeout"));
				try { ws.close(); } catch {}
			}, 10000);

			ws.addEventListener("open", () => {
				clearTimeout(timeout);
				this.grokWs = ws;

				// Initial session config: voice, VAD, audio format — NO tools/instructions yet
				// Tools and instructions are sent per-turn by VoiceWorker via session.update
				ws.send(JSON.stringify({
					type: "session.update",
					session: {
						voice: this.config.voice,
						instructions: this.config.instructions,
						turn_detection: { type: "server_vad", create_response: false },
						input_audio_transcription: { model: "whisper-1" },
						audio: {
							input: { format: { type: "audio/pcm", rate: this.config.sampleRate } },
							output: { format: { type: "audio/pcm", rate: this.config.sampleRate } },
						},
					},
				}));

				// Create VoiceWorker with send bound to this WebSocket
				this.voiceWorker = new VoiceWorker({
					send: (data) => {
						if (this.grokWs && this.grokWs.readyState === 1) {
							this.grokWs.send(data);
						}
					},
				});

				this.callbacks.onStateChange("idle");
				resolve();
			});

			ws.addEventListener("message", (event) => {
				if (typeof event.data === "string") {
					void this.handleGrokMessage(event.data);
				}
			});

			ws.addEventListener("error", () => {
				clearTimeout(timeout);
				if (this._generation !== gen) return;
				this.active = false;
				this.callbacks.onStateChange("error");
				reject(new Error("Grok voice connection error"));
			});

			ws.addEventListener("close", () => {
				if (this._generation !== gen) return;
				this.grokWs = null;
				if (this.active) {
					this.active = false;
					this.callbacks.onStateChange("idle");
				}
			});
		});
	}

	appendAudio(pcmBase64: string): void {
		if (!this.grokWs || !this.active) return;
		this.grokWs.send(JSON.stringify({
			type: "input_audio_buffer.append",
			audio: pcmBase64,
		}));
	}

	async stop(): Promise<void> {
		this.active = false;
		this._processingUtterance = false;
		this._initialSetupDone = false;
		if (this.voiceWorker) {
			this.voiceWorker.abort();
			this.voiceWorker = null;
		}
		this.activeStream = null;
		if (this.grokWs) {
			try { this.grokWs.close(); } catch {}
			this.grokWs = null;
		}
		this.callbacks.onStateChange("idle");
	}

	private async handleGrokMessage(raw: string): Promise<void> {
		let data: Record<string, any>;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		if (data.type !== "response.output_audio.delta") {
			this.log("EVENT", data.type, JSON.stringify(data, null, 0).slice(0, 500));
		}

		switch (data.type) {
			// ── VAD events ─────────────────────────────────────────
			case "input_audio_buffer.speech_started": {
				this.callbacks.onStateChange("listening");
				break;
			}
			case "input_audio_buffer.speech_stopped": {
				this.callbacks.onStateChange("thinking");
				break;
			}

			// ── Transcript → Cortex voice pathway ─────────────────
			case "conversation.item.input_audio_transcription.completed": {
				const transcript = data.transcript?.trim();
				if (transcript && !this._processingUtterance) {
					this.callbacks.onUserTranscript(transcript);
					// Cancel any auto-response (create_response:false is unreliable)
					if (this.grokWs && this.grokWs.readyState === 1) {
						this.grokWs.send(JSON.stringify({ type: "response.cancel" }));
					}
					await this.processVoiceTurn(transcript);
				}
				break;
			}

			// ── Auto-response suppression ──────────────────────────
			case "response.created": {
				// If we didn't expect this response, cancel it
				if (!this.voiceWorker?.isProcessing) {
					this.log("AUTO_RESPONSE", "cancelling unexpected auto-response");
					if (this.grokWs && this.grokWs.readyState === 1) {
						this.grokWs.send(JSON.stringify({ type: "response.cancel" }));
					}
				}
				break;
			}

			// ── Session lifecycle ──────────────────────────────────
			case "session.updated": {
				if (!this._initialSetupDone) {
					this._initialSetupDone = true;
				}
				break;
			}
			case "input_audio_buffer.committed": {
				break;
			}
			case "conversation.item.created": {
				break;
			}

			// ── Audio + transcript (from Grok agent response) ─────
			case "response.output_audio.delta": {
				if (data.delta) {
					this.callbacks.onStateChange("speaking");
					this.callbacks.onAudioDelta(data.delta);
				}
				// Also forward to VoiceWorker for stream completion tracking
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.delta": {
				if (data.delta) {
					this.callbacks.onTranscriptDelta(data.delta, false);
				}
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				break;
			}
			case "response.output_audio_transcript.done": {
				this.callbacks.onTranscriptDelta("", true);
				break;
			}

			// ── Function calls + response lifecycle ───────────────
			case "response.function_call_arguments.done":
			case "response.done": {
				if (this.voiceWorker?.isProcessing) {
					await this.voiceWorker.handleGrokEvent(data);
				}
				if (data.type === "response.done") {
					const status = data.response?.status ?? "completed";
					if (status !== "cancelled" && !this.voiceWorker?.isProcessing) {
						this._processingUtterance = false;
						this.callbacks.onStateChange("idle");
					}
				}
				break;
			}

			case "error": {
				this.log("ERROR", JSON.stringify(data));
				this.callbacks.onStateChange("error");
				break;
			}
		}
	}

	private async processVoiceTurn(transcript: string): Promise<void> {
		if (!this.voiceWorker) return;
		this._processingUtterance = true;
		this.callbacks.onStateChange("thinking");

		try {
			const stream = await this.cortex.chatStreamVoice(transcript, this.voiceWorker);
			this.activeStream = stream;

			// fullText resolves when the turn is complete
			await stream.fullText;
		} catch (err) {
			this.log("ERROR", err instanceof Error ? err.message : String(err));
			this.callbacks.onStateChange("error");
		} finally {
			this._processingUtterance = false;
			this.activeStream = null;
		}
	}
}
```

**Step 2: Run tests**

Run: `bun test tests/unit/voice-session-manager.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/voice/session-manager.ts tests/unit/voice-session-manager.test.ts
git commit -m "feat(voice): add VoiceSessionManager — thin audio I/O replacing VoiceBridge

Manages Grok WebSocket lifecycle, VAD events, and routes transcripts
through Cortex.chatStreamVoice() for native Grok agent processing."
```

---

### Task 12: Rewire handler.ts — VoiceBridge → VoiceSessionManager

**Files:**
- Modify: `src/server/handler.ts`

**Step 1: Run existing tests to establish baseline**

Run: `bun test tests/unit/handler.test.ts`
Expected: All passing (if handler tests exist)

**Step 2: Update imports**

In `src/server/handler.ts`, change the VoiceBridge import:

Replace:
```typescript
import { VoiceBridge, type VoiceBridgeConfig } from "../core/voice/bridge.ts";
```
With:
```typescript
import { VoiceSessionManager, type VoiceSessionConfig } from "../core/voice/session-manager.ts";
```

**Step 3: Update the class field**

Replace:
```typescript
private voiceBridge: VoiceBridge | null = null;
```
With:
```typescript
private voiceSession: VoiceSessionManager | null = null;
```

**Step 4: Update handleAudio**

Replace:
```typescript
handleAudio(audioData: Buffer): void {
	if (!this.voiceBridge?.isActive) return;
	const base64 = audioData.toString("base64");
	this.voiceBridge.appendAudio(base64);
}
```
With:
```typescript
handleAudio(audioData: Buffer): void {
	if (!this.voiceSession?.isActive) return;
	const base64 = audioData.toString("base64");
	this.voiceSession.appendAudio(base64);
}
```

**Step 5: Update voice:start handler**

Replace the entire `case "voice:start"` block (lines 294-382) with:

```typescript
			case "voice:start": {
				if (this.voiceSession?.isActive) {
					send({
						type: "voice:error",
						code: "SESSION_IN_USE",
						message: "Voice session already active",
					});
					break;
				}

				this.assistantTranscriptBuffer = "";

				const requestedVoice = msg.voice;
				const voice: GrokVoice = requestedVoice && VALID_VOICES.has(requestedVoice)
					? requestedVoice as GrokVoice
					: "Eve";

				const sessionConfig: VoiceSessionConfig = {
					voice,
					sampleRate: 48000,
					instructions: FRIDAY_VOICE_IDENTITY,
				};

				this.voiceSession = new VoiceSessionManager(
					this.runtime.cortex,
					sessionConfig,
					{
						onAudioDelta: (base64) =>
							send({ type: "voice:audio", delta: base64 }),
						onTranscriptDelta: (delta, done) => {
							if (!done) {
								this.assistantTranscriptBuffer += delta;
							}
							send({
								type: "voice:transcript",
								role: "assistant",
								delta,
								done,
							});
							if (done) {
								this.hub.broadcast(
									{
										type: "conversation:message",
										role: "assistant",
										content: this.assistantTranscriptBuffer,
										source: "voice",
									},
									this.clientId,
								);
								this.assistantTranscriptBuffer = "";
							}
						},
						onStateChange: (state) =>
							send({ type: "voice:state", state }),
						onUserTranscript: (text) => {
							send({
								type: "voice:transcript",
								role: "user",
								delta: text,
								done: true,
							});
							this.hub.broadcast(
								{
									type: "conversation:message",
									role: "user",
									content: text,
									source: "voice",
								},
								this.clientId,
							);
						},
					},
				);

				try {
					await this.voiceSession.start();
					send({ type: "voice:started", requestId: msg.id });
				} catch (err) {
					send({
						type: "voice:error",
						code: "START_FAILED",
						message:
							err instanceof Error
								? err.message
								: "Failed to start voice",
					});
				}
				break;
			}
```

**Step 6: Update voice:stop handler**

Replace:
```typescript
			case "voice:stop": {
				if (this.voiceBridge) {
					await this.voiceBridge.stop();
					this.voiceBridge = null;
				}
				send({ type: "voice:stopped", requestId: msg.id });
				break;
			}
```
With:
```typescript
			case "voice:stop": {
				if (this.voiceSession) {
					await this.voiceSession.stop();
					this.voiceSession = null;
				}
				send({ type: "voice:stopped", requestId: msg.id });
				break;
			}
```

**Step 7: Run tests**

Run: `bun test`
Expected: All pass (handler wire-up is mostly integration — unit tests should still pass)

**Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 9: Commit**

```bash
git add src/server/handler.ts
git commit -m "refactor(voice): rewire handler from VoiceBridge to VoiceSessionManager

voice:start now creates VoiceSessionManager (native Grok agent) instead
of VoiceBridge (TTS pipe). Same ServerMessage types, same client contract."
```

---

### Task 13: Remove VoiceBridge

**Files:**
- Delete: `src/core/voice/bridge.ts`
- Delete: `tests/unit/voice-bridge.test.ts`

**Step 1: Verify no other imports reference bridge.ts**

Search for imports of bridge.ts across the codebase. The only consumer should have been handler.ts (updated in Task 12).

**Step 2: Delete the files**

```bash
rm src/core/voice/bridge.ts tests/unit/voice-bridge.test.ts
```

**Step 3: Run tests**

Run: `bun test`
Expected: All pass (VoiceBridge tests removed, new VoiceSessionManager tests replace them)

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor(voice): remove VoiceBridge — replaced by VoiceWorker + VoiceSessionManager

Deletes the old TTS pipe approach. Grok is now a native agent:
reasoning + tool calling + speech in one unified flow."
```

---

## Phase 5: Cleanup + Documentation

### Task 14: Lint, Typecheck, Full Suite

**Step 1: Run linter**

Run: `bun run lint:fix`
Expected: Clean

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 3: Run full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for voice worker implementation"
```

(Skip if nothing to commit.)

---

### Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Subsystem Map**

Replace the VoiceBridge row with:

```
| **VoiceWorker** | `src/core/workers/voice-worker.ts` | Grok realtime WebSocket agent loop. Implements CortexWorker — reasoning + tool calling + speech natively. |
| **VoiceSessionManager** | `src/core/voice/session-manager.ts` | Thin audio I/O + lifecycle. Manages Grok WebSocket, VAD, routes transcripts through `cortex.chatStreamVoice()`. |
```

**Step 2: Update Patterns & Gotchas**

Replace the voice narration bullet with:

```
- **Dual-mode Cortex**: `chatStream()` (TextWorker/AI SDK) for CLI, `chatStreamVoice()` (VoiceWorker/Grok realtime) for browser voice. Both share system prompt enrichment, tool bridge, history, clearance. Voice mode uses Grok as native agent — no sentence splitting, no TTS pipe.
- **Voice narration**: NarrationPicker + ACK_PHRASES still available for Vox (notification TTS). VoiceSessionManager routes through Cortex natively — Grok handles its own speech.
```

**Step 3: Update Architecture tree**

Add to the `workers/` section under `core/`:
```
│   ├── workers/           # CortexWorker implementations
│   │   ├── types.ts        # CortexWorker interface, WorkerRequest, WorkerResult, ToolEvent
│   │   ├── text-worker.ts  # TextWorker — AI SDK streamText() agent loop
│   │   ├── voice-worker.ts # VoiceWorker — Grok realtime WebSocket agent loop
│   │   └── push-iterable.ts # Push-based AsyncIterable utility
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with VoiceWorker + VoiceSessionManager architecture"
```

---

## Summary

| Task | Description | New Files | Modified Files | Deleted Files |
|------|-------------|-----------|----------------|---------------|
| 1 | PushIterable failing tests | `tests/unit/push-iterable.test.ts` | — | — |
| 2 | PushIterable implementation | `src/core/workers/push-iterable.ts` | — | — |
| 3 | toGrokTools failing tests | — | `tests/unit/tool-bridge.test.ts` | — |
| 4 | toGrokTools implementation | — | `src/core/tool-bridge.ts` | — |
| 5 | VoiceWorker failing tests | `tests/unit/voice-worker.test.ts` | — | — |
| 6 | VoiceWorker implementation | `src/core/workers/voice-worker.ts` | — | — |
| 7 | VoiceChatStream type | — | `src/core/stream-types.ts` | — |
| 8 | chatStreamVoice failing tests | `tests/unit/cortex-voice.test.ts` | — | — |
| 9 | chatStreamVoice implementation | — | `src/core/cortex.ts` | — |
| 10 | VoiceSessionManager failing tests | `tests/unit/voice-session-manager.test.ts` | — | — |
| 11 | VoiceSessionManager implementation | `src/core/voice/session-manager.ts` | — | — |
| 12 | Rewire handler.ts | — | `src/server/handler.ts` | — |
| 13 | Remove VoiceBridge | — | — | `src/core/voice/bridge.ts`, `tests/unit/voice-bridge.test.ts` |
| 14 | Lint + typecheck + full suite | — | all | — |
| 15 | Update CLAUDE.md | — | `CLAUDE.md` | — |
