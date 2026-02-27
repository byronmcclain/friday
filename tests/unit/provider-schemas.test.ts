import { describe, test, expect } from "bun:test";
import { toZodSchema } from "../../src/providers/schemas.ts";
import type { ToolParameter } from "../../src/modules/types.ts";

describe("toZodSchema", () => {
	test("converts string parameters", () => {
		const params: ToolParameter[] = [
			{ name: "path", type: "string", description: "File path", required: true },
		];
		const schema = toZodSchema(params);
		const result = schema.safeParse({ path: "/tmp/test" });
		expect(result.success).toBe(true);
	});

	test("rejects missing required parameters", () => {
		const params: ToolParameter[] = [
			{ name: "path", type: "string", description: "File path", required: true },
		];
		const schema = toZodSchema(params);
		const result = schema.safeParse({});
		expect(result.success).toBe(false);
	});

	test("accepts missing optional parameters", () => {
		const params: ToolParameter[] = [
			{ name: "limit", type: "number", description: "Max results", required: false, default: 10 },
		];
		const schema = toZodSchema(params);
		const result = schema.safeParse({});
		expect(result.success).toBe(true);
	});

	test("converts all parameter types", () => {
		const params: ToolParameter[] = [
			{ name: "name", type: "string", description: "Name", required: true },
			{ name: "count", type: "number", description: "Count", required: true },
			{ name: "active", type: "boolean", description: "Active", required: true },
			{ name: "items", type: "array", description: "Items", required: false },
			{ name: "config", type: "object", description: "Config", required: false },
		];
		const schema = toZodSchema(params);
		const result = schema.safeParse({
			name: "test",
			count: 42,
			active: true,
			items: [1, 2],
			config: { key: "val" },
		});
		expect(result.success).toBe(true);
	});

	test("includes descriptions in schema", () => {
		const params: ToolParameter[] = [
			{ name: "path", type: "string", description: "The file path to read", required: true },
		];
		const schema = toZodSchema(params);
		expect(schema.shape.path).toBeDefined();
	});
});
