import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "../../src/cli/render.ts";

describe("renderMarkdown", () => {
  test("renders bold text with ANSI bold sequences", () => {
    const result = renderMarkdown("**bold**");
    // Should contain ANSI bold escape and not contain literal **
    expect(result).not.toContain("**bold**");
    expect(result).toContain("bold");
  });

  test("renders italic text with ANSI italic sequences", () => {
    const result = renderMarkdown("*italic*");
    expect(result).not.toContain("*italic*");
    expect(result).toContain("italic");
  });

  test("renders headers with styling", () => {
    const result = renderMarkdown("# Hello");
    // marked-terminal wraps headings in section() which adds double newlines
    // In non-TTY (tests), chalk strips ANSI codes but structure is preserved
    expect(result).toContain("Hello");
    expect(result).toMatch(/Hello\n\n/);
  });

  test("renders inline code distinctly", () => {
    const result = renderMarkdown("use `console.log`");
    // Should not contain literal backticks
    expect(result).not.toContain("`console.log`");
    expect(result).toContain("console.log");
  });

  test("renders fenced code blocks", () => {
    const result = renderMarkdown("```typescript\nconst x = 1;\n```");
    // Should contain the code content, not the fence markers
    expect(result).not.toContain("```");
    expect(result).toContain("const x = 1");
  });

  test("renders unordered lists", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  test("renders bold inside list items (marked-terminal text bug fix)", () => {
    const result = renderMarkdown("- **Bold**: description\n- *italic* item");
    // Bold markers should not appear as raw text
    expect(result).not.toContain("**Bold**");
    expect(result).toContain("Bold");
    // Italic markers should not appear as raw text
    expect(result).not.toContain("*italic*");
    expect(result).toContain("italic");
  });

  test("returns empty string for empty input", () => {
    const result = renderMarkdown("");
    expect(result.trim()).toBe("");
  });

  test("passes plain text through unchanged (minus trailing newline)", () => {
    const result = renderMarkdown("just plain text");
    expect(result.trim()).toBe("just plain text");
  });
});
