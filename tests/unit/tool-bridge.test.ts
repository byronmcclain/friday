import { describe, test, expect } from "bun:test";
import { buildToolDefinitions, createToolExecutor } from "../../src/core/tool-bridge.ts";
import type { FridayTool } from "../../src/modules/types.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { SignalBus } from "../../src/core/events.ts";

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
