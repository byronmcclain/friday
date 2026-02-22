import { describe, test, expect } from "bun:test";
import type {
  ConversationMessage,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  MessageContent,
} from "../../src/core/types.ts";
import { getTextContent } from "../../src/core/types.ts";

describe("ConversationMessage", () => {
  test("accepts string content (backwards compatible)", () => {
    const msg: ConversationMessage = {
      role: "user",
      content: "Hello, Friday",
    };
    expect(msg.content).toBe("Hello, Friday");
  });

  test("accepts ContentBlock[] content", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Let me check that." },
      { type: "tool_use", id: "call_1", name: "readFile", input: { path: "/tmp/foo" } },
    ];
    const msg: ConversationMessage = {
      role: "assistant",
      content: blocks,
    };
    expect(Array.isArray(msg.content)).toBe(true);
    expect((msg.content as ContentBlock[]).length).toBe(2);
  });

  test("accepts tool_result content blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_result", toolCallId: "call_1", content: "file contents here", isError: false },
    ];
    const msg: ConversationMessage = {
      role: "user",
      content: blocks,
    };
    const block = (msg.content as ToolResultBlock[])[0]!;
    expect(block.type).toBe("tool_result");
    expect(block.toolCallId).toBe("call_1");
    expect(block.content).toBe("file contents here");
    expect(block.isError).toBe(false);
  });
});

describe("getTextContent", () => {
  test("returns string content as-is", () => {
    expect(getTextContent("Hello")).toBe("Hello");
  });

  test("extracts text from ContentBlock[]", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Part one. " },
      { type: "tool_use", id: "call_1", name: "readFile", input: { path: "/tmp/foo" } },
      { type: "text", text: "Part two." },
    ];
    expect(getTextContent(content)).toBe("Part one. Part two.");
  });

  test("returns empty string when no text blocks", () => {
    const content: ContentBlock[] = [
      { type: "tool_use", id: "call_1", name: "readFile", input: { path: "/tmp/foo" } },
      { type: "tool_result", toolCallId: "call_1", content: "data", isError: false },
    ];
    expect(getTextContent(content)).toBe("");
  });
});
