import { describe, expect, test } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { SignalBus } from "../../src/core/events.ts";
import type { ScopedMemory } from "../../src/core/memory.ts";
import {
	buildToolDefinitions,
	createToolExecutor,
	toGrokTools,
} from "../../src/core/tool-bridge.ts";
import type { FridayTool } from "../../src/modules/types.ts";
import { mockTool } from "../helpers/stubs.ts";

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
			execute: async () => {
				throw new Error("Kaboom!");
			},
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

	test("emits tool:completed signal after tool execution", async () => {
		const signals = new SignalBus();
		const emitted: Array<{ name: string; source: string }> = [];
		signals.on("tool:completed", (signal) => {
			emitted.push({ name: signal.name, source: signal.source });
		});

		const tool = mockTool();
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools, signals });
		await executor("test-tool", { input: "hello" });

		expect(emitted).toHaveLength(1);
		expect(emitted[0]!.source).toBe("test-tool");
	});

	test("emits tool:completed signal even on tool error", async () => {
		const signals = new SignalBus();
		const emitted: string[] = [];
		signals.on("tool:completed", (signal) => {
			emitted.push(signal.source);
		});

		const tool = mockTool({
			execute: async () => {
				throw new Error("boom");
			},
		});
		const tools = new Map([["fail-tool", tool]]);
		const executor = createToolExecutor({ tools, signals });
		await executor("fail-tool", {});

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toBe("fail-tool");
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
			execute: async () => {
				throw new Error("fail");
			},
		});
		const tools = new Map([["test-tool", tool]]);
		const executor = createToolExecutor({ tools, audit });
		await executor("test-tool", { input: "x" });

		expect(entries.some((e) => e.action === "tool:error")).toBe(true);
	});
});

describe("createToolExecutor — toolMemoryMap", () => {
	function createMapMemory(): ScopedMemory & { store: Map<string, unknown> } {
		const store = new Map<string, unknown>();
		return {
			store,
			get: async <T>(key: string) => store.get(key) as T | undefined,
			set: async <T>(key: string, value: T) => {
				store.set(key, value);
			},
			delete: async (key: string) => {
				store.delete(key);
			},
			list: async () => [...store.keys()],
		};
	}

	test("tool gets module-scoped memory from toolMemoryMap", async () => {
		const moduleMemory = createMapMemory();
		await moduleMemory.set("api_key", "secret123");

		const tool = mockTool({
			name: "my-tool",
			execute: async (_args, ctx) => {
				const key = await ctx.memory.get<string>("api_key");
				return { success: true, output: key ?? "NOT FOUND" };
			},
		});

		const toolMemoryMap = new Map<string, ScopedMemory>();
		toolMemoryMap.set("my-tool", moduleMemory);

		const executor = createToolExecutor({
			tools: new Map([["my-tool", tool]]),
			toolMemoryMap,
		});

		const result = await executor("my-tool", {});
		expect(result).toBe("secret123");
	});

	test("tool without map entry falls back to toolMemory", async () => {
		const fallbackMemory = createMapMemory();
		await fallbackMemory.set("fallback_key", "fallback_val");

		const tool = mockTool({
			name: "standalone-tool",
			execute: async (_args, ctx) => {
				const key = await ctx.memory.get<string>("fallback_key");
				return { success: true, output: key ?? "NOT FOUND" };
			},
		});

		const executor = createToolExecutor({
			tools: new Map([["standalone-tool", tool]]),
			toolMemory: fallbackMemory,
			toolMemoryMap: new Map(), // empty — no entry for this tool
		});

		const result = await executor("standalone-tool", {});
		expect(result).toBe("fallback_val");
	});

	test("different tools get different scoped memories", async () => {
		const memA = createMapMemory();
		const memB = createMapMemory();
		await memA.set("who", "module-a");
		await memB.set("who", "module-b");

		const toolA = mockTool({
			name: "tool-a",
			execute: async (_args, ctx) => {
				return { success: true, output: (await ctx.memory.get<string>("who")) ?? "" };
			},
		});
		const toolB = mockTool({
			name: "tool-b",
			execute: async (_args, ctx) => {
				return { success: true, output: (await ctx.memory.get<string>("who")) ?? "" };
			},
		});

		const toolMemoryMap = new Map<string, ScopedMemory>();
		toolMemoryMap.set("tool-a", memA);
		toolMemoryMap.set("tool-b", memB);

		const tools = new Map<string, FridayTool>([
			["tool-a", toolA],
			["tool-b", toolB],
		]);
		const executor = createToolExecutor({ tools, toolMemoryMap });

		expect(await executor("tool-a", {})).toBe("module-a");
		expect(await executor("tool-b", {})).toBe("module-b");
	});
});

describe("toGrokTools", () => {
	test("empty definitions returns empty array", () => {
		expect(toGrokTools([])).toEqual([]);
	});

	test("converts single tool to Grok function format", () => {
		const defs = [
			{
				name: "git.status",
				description: "Get git status",
				parameters: [
					{ name: "path", type: "string" as const, description: "repo path", required: true },
				],
			},
		];
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
		const defs = [
			{
				name: "test",
				description: "Test",
				parameters: [
					{ name: "a", type: "string" as const, description: "required", required: true },
					{ name: "b", type: "number" as const, description: "optional", required: false },
				],
			},
		];
		const result = toGrokTools(defs);
		expect(result[0]!.parameters.required).toEqual(["a"]);
		expect(result[0]!.parameters.properties.b).toEqual({
			type: "number",
			description: "optional",
		});
	});

	test("handles all parameter types", () => {
		const defs = [
			{
				name: "multi",
				description: "Multi-type",
				parameters: [
					{ name: "s", type: "string" as const, description: "str", required: true },
					{ name: "n", type: "number" as const, description: "num", required: true },
					{ name: "b", type: "boolean" as const, description: "bool", required: true },
					{ name: "a", type: "array" as const, description: "arr", required: false },
					{ name: "o", type: "object" as const, description: "obj", required: false },
				],
			},
		];
		const result = toGrokTools(defs);
		const props = result[0]!.parameters.properties;
		expect(props.s!.type).toBe("string");
		expect(props.n!.type).toBe("number");
		expect(props.b!.type).toBe("boolean");
		expect(props.a!.type).toBe("array");
		expect(props.o!.type).toBe("object");
	});

	test("tool with no parameters has empty properties", () => {
		const defs = [
			{
				name: "simple",
				description: "No params",
				parameters: [],
			},
		];
		const result = toGrokTools(defs);
		expect(result[0]!.parameters.properties).toEqual({});
		expect(result[0]!.parameters.required).toEqual([]);
	});
});
