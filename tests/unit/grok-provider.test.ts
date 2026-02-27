import { describe, test, expect } from "bun:test";
import {
  toGrokTools,
  toGrokMessages,
  parseGrokResponse,
} from "../../src/providers/grok.ts";
import type { ToolDefinition } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";

describe("toGrokTools", () => {
  test("converts ToolDefinition[] to OpenAI function tool format", () => {
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

    const result = toGrokTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "readFile",
        description: "Read a file from disk",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
            offset: { type: "number", description: "Line offset", default: 1 },
          },
          required: ["path"],
        },
      },
    });
  });

  test("returns empty array for empty input", () => {
    const result = toGrokTools([]);
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

    const result = toGrokTools(tools);

    expect(result).toHaveLength(2);
    expect(result[0]!.function.name).toBe("read");
    expect(result[1]!.function.name).toBe("write");
    expect(result[1]!.function.parameters.required).toEqual(["path", "content"]);
  });
});

describe("toGrokMessages", () => {
  test("prepends system message and passes through string content", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "Hello, Friday" },
      { role: "assistant", content: "Hello! How can I help?" },
    ];

    const result = toGrokMessages("You are Friday.", messages);

    expect(result).toEqual([
      { role: "system", content: "You are Friday." },
      { role: "user", content: "Hello, Friday" },
      { role: "assistant", content: "Hello! How can I help?" },
    ]);
  });

  test("converts assistant message with text and tool_use blocks", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll read that file." },
          {
            type: "tool_use",
            id: "call_123",
            name: "readFile",
            input: { path: "/tmp/foo.txt" },
          },
        ],
      },
    ];

    const result = toGrokMessages("System prompt", messages);

    // system + assistant
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      content: "I'll read that file.",
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "readFile",
            arguments: JSON.stringify({ path: "/tmp/foo.txt" }),
          },
        },
      ],
    });
  });

  test("converts assistant message with only tool_use blocks (no text)", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_456",
            name: "search",
            input: { query: "test" },
          },
        ],
      },
    ];

    const result = toGrokMessages("sys", messages);

    expect(result[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_456",
          type: "function",
          function: {
            name: "search",
            arguments: JSON.stringify({ query: "test" }),
          },
        },
      ],
    });
  });

  test("converts tool_result blocks into separate role:tool messages", () => {
    const messages: ConversationMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "call_123",
            content: "file contents here",
            isError: false,
          },
          {
            type: "tool_result",
            toolCallId: "call_456",
            content: "another result",
            isError: false,
          },
        ],
      },
    ];

    const result = toGrokMessages("sys", messages);

    // system + 2 tool messages
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "file contents here",
    });
    expect(result[2]).toEqual({
      role: "tool",
      tool_call_id: "call_456",
      content: "another result",
    });
  });

  test("converts assistant with multiple tool calls", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading both files." },
          {
            type: "tool_use",
            id: "call_1",
            name: "readFile",
            input: { path: "/a.txt" },
          },
          {
            type: "tool_use",
            id: "call_2",
            name: "readFile",
            input: { path: "/b.txt" },
          },
        ],
      },
    ];

    const result = toGrokMessages("sys", messages);

    expect(result[1]!.tool_calls).toHaveLength(2);
    expect(result[1]!.tool_calls![0]!.id).toBe("call_1");
    expect(result[1]!.tool_calls![1]!.id).toBe("call_2");
  });

  test("handles full tool round-trip conversation", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "Read /tmp/foo.txt" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that." },
          {
            type: "tool_use",
            id: "call_abc",
            name: "readFile",
            input: { path: "/tmp/foo.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "call_abc",
            content: "hello world",
            isError: false,
          },
        ],
      },
    ];

    const result = toGrokMessages("You are Friday.", messages);

    expect(result).toHaveLength(4); // system + user + assistant + tool
    expect(result[0]).toEqual({ role: "system", content: "You are Friday." });
    expect(result[1]).toEqual({ role: "user", content: "Read /tmp/foo.txt" });
    expect(result[2]!.role).toBe("assistant");
    expect(result[2]!.tool_calls).toHaveLength(1);
    expect(result[3]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "hello world",
    });
  });
});

describe("parseGrokResponse", () => {
  test("parses a text response", () => {
    const choice = {
      finish_reason: "stop",
      message: {
        content: "Hello! How can I help you today?",
        tool_calls: undefined,
      },
    };

    const result = parseGrokResponse(choice);

    expect(result).toEqual({
      type: "text",
      text: "Hello! How can I help you today?",
      truncated: false,
    });
  });

  test("parses a tool_calls response", () => {
    const choice = {
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function" as const,
            function: {
              name: "readFile",
              arguments: JSON.stringify({ path: "/tmp/foo.txt" }),
            },
          },
        ],
      },
    };

    const result = parseGrokResponse(choice);

    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: "call_123",
        name: "readFile",
        input: { path: "/tmp/foo.txt" },
      });
    }
  });

  test("parses multiple tool calls", () => {
    const choice = {
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "readFile",
              arguments: JSON.stringify({ path: "/a.txt" }),
            },
          },
          {
            id: "call_2",
            type: "function" as const,
            function: {
              name: "writeFile",
              arguments: JSON.stringify({ path: "/b.txt", content: "hello" }),
            },
          },
        ],
      },
    };

    const result = parseGrokResponse(choice);

    expect(result.type).toBe("tool_use");
    if (result.type === "tool_use") {
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]!.id).toBe("call_1");
      expect(result.toolCalls[0]!.name).toBe("readFile");
      expect(result.toolCalls[1]!.id).toBe("call_2");
      expect(result.toolCalls[1]!.name).toBe("writeFile");
      expect(result.toolCalls[1]!.input).toEqual({ path: "/b.txt", content: "hello" });
    }
  });

  test("sets truncated to false on normal stop", () => {
    const choice = {
      finish_reason: "stop",
      message: {
        content: "Hello!",
        tool_calls: undefined,
      },
    };

    const result = parseGrokResponse(choice);

    expect(result).toEqual({
      type: "text",
      text: "Hello!",
      truncated: false,
    });
  });

  test("sets truncated to true when finish_reason is length", () => {
    const choice = {
      finish_reason: "length",
      message: {
        content: "This response was cut sh",
        tool_calls: undefined,
      },
    };

    const result = parseGrokResponse(choice);

    expect(result).toEqual({
      type: "text",
      text: "This response was cut sh",
      truncated: true,
    });
  });

  test("throws on empty/null content with non-tool finish_reason", () => {
    const choice = {
      finish_reason: "stop",
      message: {
        content: null,
        tool_calls: undefined,
      },
    };

    expect(() => parseGrokResponse(choice)).toThrow();
  });

  test("throws on empty string content with non-tool finish_reason", () => {
    const choice = {
      finish_reason: "stop",
      message: {
        content: "",
        tool_calls: undefined,
      },
    };

    expect(() => parseGrokResponse(choice)).toThrow();
  });
});
