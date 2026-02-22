import { describe, test, expect } from "bun:test";
import {
  toAnthropicTools,
  toAnthropicMessages,
  parseAnthropicResponse,
} from "../../src/providers/anthropic.ts";
import type { ToolDefinition } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";

describe("toAnthropicTools", () => {
  test("converts ToolDefinition[] to Anthropic API format", () => {
    const tools: ToolDefinition[] = [
      {
        name: "readFile",
        description: "Read a file from disk",
        parameters: [
          {
            name: "path",
            type: "string",
            description: "File path to read",
            required: true,
          },
          {
            name: "offset",
            type: "number",
            description: "Line offset",
            required: false,
            default: 1,
          },
        ],
      },
    ];

    const result = toAnthropicTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("readFile");
    expect(result[0]!.description).toBe("Read a file from disk");
    expect(result[0]!.input_schema).toEqual({
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        offset: { type: "number", description: "Line offset", default: 1 },
      },
      required: ["path"],
    });
  });

  test("returns empty array for empty input", () => {
    const result = toAnthropicTools([]);
    expect(result).toEqual([]);
  });

  test("converts multiple tools", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read",
        description: "Read file",
        parameters: [
          { name: "path", type: "string", description: "Path", required: true },
        ],
      },
      {
        name: "write",
        description: "Write file",
        parameters: [
          { name: "path", type: "string", description: "Path", required: true },
          { name: "content", type: "string", description: "Content", required: true },
        ],
      },
    ];

    const result = toAnthropicTools(tools);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("read");
    expect(result[1]!.name).toBe("write");
    expect(result[1]!.input_schema.required).toEqual(["path", "content"]);
  });
});

describe("toAnthropicMessages", () => {
  test("passes through string content as-is", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "Hello, Friday" },
      { role: "assistant", content: "Hello! How can I help?" },
    ];

    const result = toAnthropicMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello, Friday" },
      { role: "assistant", content: "Hello! How can I help?" },
    ]);
  });

  test("converts TextBlock content", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Let me check that." }],
      },
    ];

    const result = toAnthropicMessages(messages);

    expect(result).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Let me check that." }],
      },
    ]);
  });

  test("converts ToolUseBlock content", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll read that file." },
          {
            type: "tool_use",
            id: "toolu_123",
            name: "readFile",
            input: { path: "/tmp/foo.txt" },
          },
        ],
      },
    ];

    const result = toAnthropicMessages(messages);

    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll read that file." },
          {
            type: "tool_use",
            id: "toolu_123",
            name: "readFile",
            input: { path: "/tmp/foo.txt" },
          },
        ],
      },
    ]);
  });

  test("converts ToolResultBlock with camelCase to snake_case mapping", () => {
    const messages: ConversationMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "toolu_123",
            content: "file contents here",
            isError: false,
          },
        ],
      },
    ];

    const result = toAnthropicMessages(messages);

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "file contents here",
            is_error: false,
          },
        ],
      },
    ]);
  });

  test("maps isError: true correctly", () => {
    const messages: ConversationMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "toolu_456",
            content: "Permission denied",
            isError: true,
          },
        ],
      },
    ];

    const result = toAnthropicMessages(messages);

    expect(result[0]!.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_456",
        content: "Permission denied",
        is_error: true,
      },
    ]);
  });

  test("handles mixed block types in a single message", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here's what I found:" },
          {
            type: "tool_use",
            id: "toolu_abc",
            name: "search",
            input: { query: "test" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "toolu_abc",
            content: "3 results found",
            isError: false,
          },
        ],
      },
    ];

    const result = toAnthropicMessages(messages);

    expect(result).toHaveLength(2);
    // Assistant message: text + tool_use pass through
    expect(result[0]!.content).toEqual([
      { type: "text", text: "Here's what I found:" },
      { type: "tool_use", id: "toolu_abc", name: "search", input: { query: "test" } },
    ]);
    // User message: tool_result gets camelCase → snake_case mapping
    expect(result[1]!.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_abc",
        content: "3 results found",
        is_error: false,
      },
    ]);
  });
});

describe("parseAnthropicResponse", () => {
  test("parses a text response", () => {
    const response = {
      content: [
        { type: "text" as const, text: "Hello! How can I help you today?" },
      ],
      stop_reason: "end_turn" as const,
    };

    const result = parseAnthropicResponse(response);

    expect(result).toEqual({
      type: "text",
      text: "Hello! How can I help you today?",
    });
  });

  test("joins multiple text blocks", () => {
    const response = {
      content: [
        { type: "text" as const, text: "Part one. " },
        { type: "text" as const, text: "Part two." },
      ],
      stop_reason: "end_turn" as const,
    };

    const result = parseAnthropicResponse(response);

    expect(result).toEqual({
      type: "text",
      text: "Part one. Part two.",
    });
  });

  test("parses a tool_use response", () => {
    const response = {
      content: [
        { type: "text" as const, text: "Let me read that file." },
        {
          type: "tool_use" as const,
          id: "toolu_123",
          name: "readFile",
          input: { path: "/tmp/foo.txt" },
        },
      ],
      stop_reason: "tool_use" as const,
    };

    const result = parseAnthropicResponse(response);

    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!).toEqual({
        id: "toolu_123",
        name: "readFile",
        input: { path: "/tmp/foo.txt" },
      });
    }
  });

  test("extracts multiple tool calls", () => {
    const response = {
      content: [
        {
          type: "tool_use" as const,
          id: "toolu_1",
          name: "readFile",
          input: { path: "/a.txt" },
        },
        {
          type: "tool_use" as const,
          id: "toolu_2",
          name: "readFile",
          input: { path: "/b.txt" },
        },
      ],
      stop_reason: "tool_use" as const,
    };

    const result = parseAnthropicResponse(response);

    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]!.id).toBe("toolu_1");
      expect(result.toolCalls[1]!.id).toBe("toolu_2");
    }
  });

  test("throws on empty response", () => {
    const response = {
      content: [],
      stop_reason: "end_turn" as const,
    };

    expect(() => parseAnthropicResponse(response)).toThrow();
  });
});
