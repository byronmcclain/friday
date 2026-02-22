import { describe, expect, it } from "bun:test";
import { toJsonSchema, type JsonSchema } from "../../src/providers/tool-schema.ts";
import type { ToolParameter } from "../../src/modules/types.ts";

describe("toJsonSchema", () => {
  it("returns empty schema for empty parameters", () => {
    const result = toJsonSchema([]);
    expect(result).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });

  it("converts a required string parameter", () => {
    const params: ToolParameter[] = [
      {
        name: "path",
        type: "string",
        description: "File path to read",
        required: true,
      },
    ];

    const result = toJsonSchema(params);

    expect(result.type).toBe("object");
    expect(result.properties.path).toEqual({
      type: "string",
      description: "File path to read",
    });
    expect(result.required).toEqual(["path"]);
  });

  it("converts an optional number parameter with default", () => {
    const params: ToolParameter[] = [
      {
        name: "limit",
        type: "number",
        description: "Max results to return",
        required: false,
        default: 100,
      },
    ];

    const result = toJsonSchema(params);

    expect(result.properties.limit).toEqual({
      type: "number",
      description: "Max results to return",
      default: 100,
    });
    expect(result.required).toEqual([]);
  });

  it("handles all supported types", () => {
    const types = ["string", "number", "boolean", "array", "object"] as const;
    const params: ToolParameter[] = types.map((t) => ({
      name: `param_${t}`,
      type: t,
      description: `A ${t} parameter`,
      required: true,
    }));

    const result = toJsonSchema(params);

    for (const t of types) {
      expect(result.properties[`param_${t}`]).toEqual({
        type: t,
        description: `A ${t} parameter`,
      });
    }
    expect(result.required).toEqual(types.map((t) => `param_${t}`));
  });

  it("converts real-world fs.read parameters", () => {
    const params: ToolParameter[] = [
      {
        name: "path",
        type: "string",
        description: "Absolute or relative file path to read",
        required: true,
      },
      {
        name: "offset",
        type: "number",
        description: "1-based line number to start reading from (default: 1)",
        required: false,
        default: 1,
      },
      {
        name: "limit",
        type: "number",
        description: "Number of lines to return (default: 200, max: 2000)",
        required: false,
        default: 200,
      },
    ];

    const result = toJsonSchema(params);

    expect(result.type).toBe("object");
    expect(result.required).toEqual(["path"]);
    expect(Object.keys(result.properties)).toEqual(["path", "offset", "limit"]);

    expect(result.properties.path).toEqual({
      type: "string",
      description: "Absolute or relative file path to read",
    });
    expect(result.properties.offset).toEqual({
      type: "number",
      description: "1-based line number to start reading from (default: 1)",
      default: 1,
    });
    expect(result.properties.limit).toEqual({
      type: "number",
      description: "Number of lines to return (default: 200, max: 2000)",
      default: 200,
    });
  });

  it("does not include default key when default is undefined", () => {
    const params: ToolParameter[] = [
      {
        name: "query",
        type: "string",
        description: "Search query",
        required: true,
      },
    ];

    const result = toJsonSchema(params);

    expect(result.properties.query).toEqual({
      type: "string",
      description: "Search query",
    });
    expect("default" in (result.properties.query as Record<string, unknown>)).toBe(false);
  });

  it("separates required and optional parameters correctly", () => {
    const params: ToolParameter[] = [
      { name: "a", type: "string", description: "required", required: true },
      { name: "b", type: "number", description: "optional", required: false },
      { name: "c", type: "boolean", description: "required", required: true },
      { name: "d", type: "string", description: "optional", required: false, default: "x" },
    ];

    const result = toJsonSchema(params);

    expect(result.required).toEqual(["a", "c"]);
    expect(Object.keys(result.properties)).toEqual(["a", "b", "c", "d"]);
  });
});
