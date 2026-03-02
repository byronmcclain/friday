# Cortex Dual-Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Cortex to natively support both text (AI SDK) and voice (Grok realtime) agent loops, sharing the same cortical infrastructure.

**Architecture:** Cortex gains a worker pattern — TextWorker handles AI SDK streamText(), VoiceWorker handles Grok realtime WebSocket. Both receive the same enriched system prompt, tool definitions, and tool executor callback. Cortex owns all shared state (history, tools, clearance, audit).

**Tech Stack:** TypeScript, Bun, AI SDK v6 (`ai`, `@ai-sdk/provider`), Grok Voice Agent API (WebSocket), bun:test

**Design doc:** `docs/plans/2026-03-02-cortex-dual-mode-design.md`

---

## Phase 1: Portable Tool Infrastructure (no behavior change)

### Task 1: Write failing tests for buildToolDefinitions()

**Files:**
- Create: `tests/unit/tool-bridge.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { buildToolDefinitions } from "../../src/core/tool-bridge.ts";
import type { FridayTool } from "../../src/modules/types.ts";

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

describe("buildToolDefinitions", () => {
	test("empty tools map returns empty array", () => {
		const result = buildToolDefinitions(new Map());
		expect(result).toEqual([]);
	});

	test("converts single FridayTool to ToolDefinition", () => {
		const tools = new Map([["test-tool", mockTool()]]);
		const defs = buildToolDefinitions(tools);

		expect(defs).toHaveLength(1);
		expect(defs[0]!.name).toBe("test-tool");
		expect(defs[0]!.description).toBe("A test tool");
		expect(defs[0]!.parameters).toHaveLength(1);
		expect(defs[0]!.parameters[0]!.name).toBe("input");
	});

	test("converts multiple tools preserving order", () => {
		const tools = new Map<string, FridayTool>([
			["alpha", mockTool({ name: "alpha", description: "First" })],
			["beta", mockTool({ name: "beta", description: "Second" })],
		]);
		const defs = buildToolDefinitions(tools);

		expect(defs).toHaveLength(2);
		expect(defs[0]!.name).toBe("alpha");
		expect(defs[1]!.name).toBe("beta");
	});

	test("preserves all parameter fields", () => {
		const tool = mockTool({
			parameters: [
				{ name: "query", type: "string", description: "search query", required: true },
				{ name: "limit", type: "number", description: "max results", required: false, default: 10 },
			],
		});
		const tools = new Map([["test-tool", tool]]);
		const defs = buildToolDefinitions(tools);

		expect(defs[0]!.parameters).toHaveLength(2);
		expect(defs[0]!.parameters[1]!.default).toBe(10);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: FAIL — `Cannot find module "../../src/core/tool-bridge.ts"`

---

### Task 2: Implement buildToolDefinitions()

**Files:**
- Create: `src/core/tool-bridge.ts`

**Step 3: Write minimal implementation**

```typescript
import type { ToolParameter, FridayTool } from "../modules/types.ts";

/** Portable tool definition — works for AI SDK, Grok realtime, or any LLM API */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ToolParameter[];
}

/** Convert FridayTool registry to portable definitions */
export function buildToolDefinitions(
	tools: Map<string, FridayTool>,
): ToolDefinition[] {
	const defs: ToolDefinition[] = [];
	for (const [name, tool] of tools) {
		defs.push({
			name,
			description: tool.description,
			parameters: tool.parameters,
		});
	}
	return defs;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: 4 passing

---

### Task 3: Write failing tests for createToolExecutor()

**Files:**
- Modify: `tests/unit/tool-bridge.test.ts`

**Step 5: Add createToolExecutor tests**

Append to the test file:

```typescript
import { createToolExecutor } from "../../src/core/tool-bridge.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

describe("createToolExecutor", () => {
	test("returns 'Tool not found' for unknown tool", async () => {
		const executor = createToolExecutor({ tools: new Map() });
		const result = await executor("nonexistent", {});
		expect(result).toContain("Tool not found");
	});

	test("executes tool and returns output string", async () => {
		const tool = mockTool({
			execute: async (args) => ({
				success: true,
				output: `hello ${args.input}`,
			}),
		});
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools });
		const result = await executor("test-tool", { input: "world" });
		expect(result).toBe("hello world");
	});

	test("catches tool exception and returns error string", async () => {
		const tool = mockTool({
			execute: async () => { throw new Error("Kaboom!"); },
		});
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools });
		const result = await executor("test-tool", { input: "x" });
		expect(result).toContain("Tool execution error");
		expect(result).toContain("Kaboom!");
	});

	test("denies tool when clearance not granted", async () => {
		const tool = mockTool({
			name: "restricted",
			clearance: ["exec-shell"],
		});
		const tools = new Map([["restricted", tool]]);
		const clearance = new ClearanceManager([]);
		const executor = createToolExecutor({ tools, clearance });
		const result = await executor("restricted", { input: "x" });
		expect(result).toContain("Clearance denied");
	});

	test("denies tool when clearance manager not configured", async () => {
		const tool = mockTool({
			name: "restricted",
			clearance: ["exec-shell"],
		});
		const tools = new Map([["restricted", tool]]);
		const executor = createToolExecutor({ tools }); // no clearance
		const result = await executor("restricted", { input: "x" });
		expect(result).toContain("Clearance denied");
		expect(result).toContain("not configured");
	});

	test("emits tool:executing signal", async () => {
		const signals = new SignalBus();
		const emitted: Array<{ source: string; data?: Record<string, unknown> }> = [];
		signals.on("tool:executing", (signal) => {
			emitted.push({ source: signal.source, data: signal.data });
		});

		const tool = mockTool();
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools, signals });
		await executor("test-tool", { input: "hello" });

		expect(emitted).toHaveLength(1);
		expect(emitted[0]!.source).toBe("test-tool");
		expect(emitted[0]!.data?.args).toEqual({ input: "hello" });
	});

	test("logs audit entries on tool call", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string; source: string }> = [];
		const origLog = audit.log.bind(audit);
		audit.log = (entry) => {
			entries.push({ action: entry.action, source: entry.source });
			origLog(entry);
		};

		const tool = mockTool();
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools, audit });
		await executor("test-tool", { input: "x" });

		expect(entries.some((e) => e.action === "tool:called")).toBe(true);
	});

	test("logs audit on tool error", async () => {
		const audit = new AuditLogger();
		const entries: Array<{ action: string }> = [];
		const origLog = audit.log.bind(audit);
		audit.log = (entry) => {
			entries.push({ action: entry.action });
			origLog(entry);
		};

		const tool = mockTool({
			execute: async () => { throw new Error("fail"); },
		});
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools, audit });
		await executor("test-tool", { input: "x" });

		expect(entries.some((e) => e.action === "tool:error")).toBe(true);
	});
});
```

**Step 6: Run test to verify new tests fail**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: 4 passing (buildToolDefinitions), 7 failing (createToolExecutor — function not found)

---

### Task 4: Implement createToolExecutor()

**Files:**
- Modify: `src/core/tool-bridge.ts`

**Step 7: Add createToolExecutor to tool-bridge.ts**

Append to `src/core/tool-bridge.ts`:

```typescript
import type { ClearanceManager } from "./clearance.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalBus, SignalEmitter } from "./events.ts";
import type { ScopedMemory } from "./memory.ts";

/** Function signature for executing a tool by name */
export type ToolExecutor = (
	name: string,
	args: Record<string, unknown>,
) => Promise<string>;

/** Configuration for creating a tool executor */
export interface ToolExecutorConfig {
	tools: Map<string, FridayTool>;
	clearance?: ClearanceManager;
	audit?: AuditLogger;
	signals?: SignalBus;
	toolMemory?: ScopedMemory;
}

/**
 * Create a tool executor callback that wraps clearance checks,
 * audit logging, signal emission, and error handling.
 *
 * This is the shared execution pipeline used by both TextWorker
 * (via AI SDK tool wrappers) and VoiceWorker (via Grok function calls).
 */
export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
	return async (name: string, args: Record<string, unknown>): Promise<string> => {
		const fridayTool = config.tools.get(name);
		if (!fridayTool) {
			return `Tool not found: ${name}`;
		}

		// Clearance gate
		if (fridayTool.clearance.length > 0) {
			if (!config.clearance) {
				config.audit?.log({
					action: "tool:blocked",
					source: name,
					detail: `Clearance denied for tool: ${name} (clearance manager not configured)`,
					success: false,
				});
				return `Clearance denied for tool: ${name} (clearance manager not configured)`;
			}
			const check = config.clearance.checkAll(fridayTool.clearance);
			if (!check.granted) {
				config.audit?.log({
					action: "tool:blocked",
					source: name,
					detail: check.reason ?? `Clearance denied for tool: ${name}`,
					success: false,
				});
				return check.reason ?? `Clearance denied for tool: ${name}`;
			}
		}

		// Audit + signal
		config.audit?.log({
			action: "tool:called",
			source: name,
			detail: "Tool invoked by LLM",
			success: true,
		});
		config.signals?.emit("tool:executing", name, { args });

		// Execute with context
		try {
			const result = await fridayTool.execute(args, {
				workingDirectory: process.cwd(),
				audit: config.audit ?? ({ log: () => {} } as unknown as AuditLogger),
				signal: config.signals ?? ({ emit: async () => {} } as SignalEmitter),
				memory: config.toolMemory ?? {
					get: async () => undefined,
					set: async () => {},
					delete: async () => {},
					list: async () => [],
				},
			});
			return result.output;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			config.audit?.log({
				action: "tool:error",
				source: name,
				detail: msg,
				success: false,
			});
			return `Tool execution error: ${msg}`;
		}
	};
}
```

**Step 8: Run test to verify all pass**

Run: `bun test tests/unit/tool-bridge.test.ts`
Expected: 11 passing

**Step 9: Commit**

```bash
git add src/core/tool-bridge.ts tests/unit/tool-bridge.test.ts
git commit -m "feat(cortex): add portable tool bridge — buildToolDefinitions + createToolExecutor

Extracted from Cortex.buildAiTools() for reuse by both TextWorker and VoiceWorker."
```

---

### Task 5: Refactor Cortex.buildAiTools() to delegate to tool-bridge

**Files:**
- Modify: `src/core/cortex.ts`

**Step 10: Run existing tests to establish baseline**

Run: `bun test tests/unit/cortex-tools.test.ts tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts tests/unit/vox-cortex.test.ts`
Expected: All passing

**Step 11: Refactor buildAiTools()**

In `src/core/cortex.ts`:

1. Add import at top (after existing imports):
```typescript
import { buildToolDefinitions, createToolExecutor } from "./tool-bridge.ts";
```

2. Replace the `buildAiTools()` method (lines 241-320) with:
```typescript
private buildAiTools(): Record<
	string,
	ReturnType<typeof aiTool<any, any>>
> {
	const defs = buildToolDefinitions(this.tools);
	const executor = createToolExecutor({
		tools: this.tools,
		clearance: this.clearance,
		audit: this.audit,
		signals: this.signals,
		toolMemory: this.toolMemory,
	});

	const tools: Record<string, ReturnType<typeof aiTool<any, any>>> = {};
	for (const def of defs) {
		tools[def.name] = aiTool({
			description: def.description,
			inputSchema: toZodSchema(def.parameters),
			execute: async (args: Record<string, unknown>) =>
				executor(def.name, args),
		});
	}
	return tools;
}
```

**Step 12: Run existing tests to verify no behavior change**

Run: `bun test tests/unit/cortex-tools.test.ts tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts tests/unit/vox-cortex.test.ts`
Expected: All passing — identical behavior

**Step 13: Run full test suite**

Run: `bun test`
Expected: All 1057+ tests pass

**Step 14: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 15: Commit**

```bash
git add src/core/cortex.ts
git commit -m "refactor(cortex): delegate buildAiTools to tool-bridge

Cortex.buildAiTools() now uses buildToolDefinitions() + createToolExecutor()
from tool-bridge.ts. Zero behavior change — pure extraction."
```

---

## Phase 2: TextWorker Extraction (no behavior change)

### Task 6: Create worker type definitions

**Files:**
- Create: `src/core/workers/types.ts`

**Step 16: Write the types file**

```typescript
import type { ModelMessage } from "ai";
import type { ToolParameter } from "../../modules/types.ts";

/** Portable tool definition for any LLM API */
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
	usage: PromiseLike<TokenUsage>;
}

/** The contract all workers implement */
export interface CortexWorker {
	process(request: WorkerRequest): WorkerResult;
}
```

**Step 17: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 18: Commit**

```bash
git add src/core/workers/types.ts
git commit -m "feat(cortex): add CortexWorker interface and worker types"
```

---

### Task 7: Write failing tests for TextWorker

**Files:**
- Create: `tests/unit/text-worker.test.ts`

**Step 19: Write TextWorker tests**

```typescript
import { describe, test, expect } from "bun:test";
import { TextWorker } from "../../src/core/workers/text-worker.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { WorkerRequest } from "../../src/core/workers/types.ts";

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

describe("TextWorker", () => {
	test("streams text from model", async () => {
		const model = createMockModel({ text: "Hello from TextWorker" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toBe("Hello from TextWorker");
	});

	test("resolves fullText", async () => {
		const model = createMockModel({ text: "Full text here" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		const full = await result.fullText;
		expect(full).toBe("Full text here");
	});

	test("resolves usage", async () => {
		const model = createMockModel({
			text: "hi",
			usage: { inputTokens: 100, outputTokens: 50 },
		});
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());

		const usage = await result.usage;
		expect(usage.inputTokens).toBe(100);
		expect(usage.outputTokens).toBe(50);
	});

	test("passes system prompt to model", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		worker.process(makeRequest({ systemPrompt: "Custom system prompt" }));

		const call = model.doStreamCalls[0]!;
		const systemPart = (call.prompt as Array<{ role: string; content: string }>).find(
			(p) => p.role === "system",
		);
		expect(systemPart?.content).toBe("Custom system prompt");
	});

	test("passes tools to model when provided", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		worker.process(makeRequest({
			tools: [{
				name: "test-tool",
				description: "A test",
				parameters: [{ name: "input", type: "string", description: "x", required: true }],
			}],
		}));

		const call = model.doStreamCalls[0]!;
		expect(call.tools).toBeDefined();
		expect(call.tools!.length).toBeGreaterThan(0);
	});

	test("does not pass tools when list is empty", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		worker.process(makeRequest({ tools: [] }));

		const call = model.doStreamCalls[0]!;
		const toolCount = call.tools ? call.tools.length : 0;
		expect(toolCount).toBe(0);
	});

	test("audioStream is undefined (text mode)", async () => {
		const model = createMockModel({ text: "ok" });
		const worker = new TextWorker(model);
		const result = worker.process(makeRequest());
		expect(result.audioStream).toBeUndefined();
	});
});
```

**Step 20: Run test to verify it fails**

Run: `bun test tests/unit/text-worker.test.ts`
Expected: FAIL — `Cannot find module "../../src/core/workers/text-worker.ts"`

---

### Task 8: Implement TextWorker

**Files:**
- Create: `src/core/workers/text-worker.ts`

**Step 21: Write TextWorker implementation**

```typescript
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
```

**Step 22: Run test to verify it passes**

Run: `bun test tests/unit/text-worker.test.ts`
Expected: 7 passing

**Step 23: Commit**

```bash
git add src/core/workers/text-worker.ts tests/unit/text-worker.test.ts
git commit -m "feat(cortex): add TextWorker — AI SDK streamText agent loop

Implements CortexWorker interface. Converts portable ToolDefinitions to AI SDK
tools and delegates execution to the shared tool executor callback."
```

---

### Task 9: Refactor Cortex.chatStream() to delegate to TextWorker

**Files:**
- Modify: `src/core/cortex.ts`

**Step 24: Run existing tests to establish baseline**

Run: `bun test tests/unit/cortex-tools.test.ts tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts tests/unit/vox-cortex.test.ts`
Expected: All passing

**Step 25: Refactor chatStream()**

In `src/core/cortex.ts`:

1. Add imports at top:
```typescript
import { TextWorker } from "./workers/text-worker.ts";
import type { ToolDefinition } from "./tool-bridge.ts";
```

2. Add private field after `private debugResponsePath?`:
```typescript
private textWorker: TextWorker;
```

3. In constructor, after the debug path setup (after line 76), add:
```typescript
this.textWorker = new TextWorker(this.aiModel);
```

4. Replace `chatStream()` body. The new method keeps the same signature and return type, but delegates the streamText call to TextWorker:

```typescript
async chatStream(userMessage: string): Promise<ChatStream> {
	await this.historyManager.compact();
	const systemPrompt = await this.buildSystemPrompt(userMessage);
	this.historyManager.push({ role: "user", content: userMessage });

	if (this._debug) {
		this.audit?.log({
			action: "debug:system-prompt",
			source: "cortex",
			detail: systemPrompt,
			success: true,
		});
		if (this.debugPayloadPath && this.debugResponsePath) {
			try {
				await Bun.write(this.debugPayloadPath, "");
				await Bun.write(this.debugResponsePath, "");
			} catch {
				this.audit?.log({
					action: "debug:inference-write-failed",
					source: "cortex",
					detail: "Failed to clear inference log files",
					success: false,
				});
			}
		}
	}

	// Build portable request
	const defs = buildToolDefinitions(this.tools);
	const executor = createToolExecutor({
		tools: this.tools,
		clearance: this.clearance,
		audit: this.audit,
		signals: this.signals,
		toolMemory: this.toolMemory,
	});

	if (this._debug && this.debugPayloadPath) {
		appendInferenceLog(this.debugPayloadPath, 1, {
			system: systemPrompt,
			messages: this.historyManager.toMessages(),
			maxOutputTokens: this.maxTokens,
		});
	}

	// Delegate to TextWorker
	const workerResult = this.textWorker.process({
		systemPrompt,
		messages: this.historyManager.toMessages(),
		tools: defs,
		executeTool: executor,
		maxToolIterations: this.maxToolIterations,
		maxOutputTokens: this.maxTokens,
	});

	const fullTextPromise = workerResult.fullText.then(async (text: string) => {
		this.historyManager.push({ role: "assistant", content: text });

		if (this._debug && this.debugResponsePath) {
			appendInferenceLog(this.debugResponsePath, 1, { text });
		}

		const usage = await workerResult.usage;
		if (usage?.inputTokens != null && usage?.outputTokens != null) {
			this.historyManager.recordUsage(
				usage.inputTokens + usage.outputTokens,
			);
		}

		if (this.vox && this.vox.mode !== "off") {
			this.vox.speak(text).catch(() => {});
		}
		return text;
	});

	const usagePromise = workerResult.usage;

	return {
		textStream: workerResult.textStream,
		fullText: fullTextPromise,
		usage: usagePromise,
	};
}
```

5. The old `buildAiTools()` method can be removed since it's now only used internally by chatStream via TextWorker + tool-bridge. But keep it for the signal test at line 206 of cortex-tools.test.ts that directly calls `(cortex as any).buildAiTools()`.

Actually — remove `buildAiTools()` entirely. The test at cortex-tools.test.ts:206 that calls `buildAiTools()` should instead test the tool executor directly:

6. Update `tests/unit/cortex-tools.test.ts` — the signal emission test. Change from calling `buildAiTools()` to testing through `createToolExecutor()`:

```typescript
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
```

**Step 26: Run all Cortex-related tests**

Run: `bun test tests/unit/cortex-tools.test.ts tests/unit/cortex-ai-sdk.test.ts tests/unit/friday.test.ts tests/unit/vox-cortex.test.ts`
Expected: All passing

**Step 27: Run full test suite**

Run: `bun test`
Expected: All 1057+ tests pass

**Step 28: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

**Step 29: Commit**

```bash
git add src/core/cortex.ts tests/unit/cortex-tools.test.ts
git commit -m "refactor(cortex): delegate chatStream to TextWorker

Cortex.chatStream() now builds a WorkerRequest and delegates to
TextWorker.process(). Same behavior, same tests, new architecture."
```

---

## Phase 3: VoiceWorker + Cortex Voice API (roadmap)

> Detailed implementation plan to be written after Phase 2 lands.
> Requires studying Grok realtime API function calling protocol.

### Task 10: Research Grok realtime function calling wire protocol
- Fetch Grok API docs via Context7 MCP
- Document: function_call event format, function_call_output format, tool registration in session.update
- Save findings to `docs/plans/grok-realtime-tools-research.md`

### Task 11: Implement VoiceWorker
- Create `src/core/workers/voice-worker.ts`
- Grok realtime WebSocket agent loop
- Tool definitions → Grok function calling format
- function_call → executeTool() → function_call_output
- Audio + transcript streaming via WorkerResult

### Task 12: Add chatStreamVoice() to Cortex
- Extend `src/core/stream-types.ts` with VoiceChatStream
- Add `chatStreamVoice()` method to Cortex
- Shares buildSystemPrompt(), history, tool executor with chatStream()

---

## Phase 4: VoiceSessionManager + Handler Integration (roadmap)

### Task 13: Create VoiceSessionManager
- Thin audio I/O + narration layer
- Replaces VoiceBridge's handler-side responsibilities
- Consumes ToolEvents for data-driven narration

### Task 14: Rewire handler.ts
- voice:start → VoiceSessionManager instead of VoiceBridge
- Same ServerMessage types (voice:audio, voice:transcript, voice:state)

### Task 15: Remove VoiceBridge
- Delete `src/core/voice/bridge.ts`
- Replace `tests/unit/voice-bridge.test.ts` with `tests/unit/voice-session-manager.test.ts`

---

## Phase 5: Narration Cleanup + Polish (roadmap)

### Task 16: Data-driven narration
- VoiceSessionManager consumes ToolEvents for timing
- Remove hardcoded 2s/5s thresholds

### Task 17: Simplify voice prompt
- Remove `buildTtsPrompt()` shoe-horning
- Grok handles its own prompt via session.update instructions

### Task 18: Update CLAUDE.md and design docs
- Document new architecture
- Update boot order, subsystem map, patterns section
