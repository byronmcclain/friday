import { describe, test, expect } from "bun:test";
import { NarrationPicker, ACK_PHRASES, TOOL_NARRATIONS, GENERIC_NARRATIONS } from "../../src/core/voice/narration.ts";

describe("NarrationPicker", () => {
  test("returns items from the source array", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    const result = picker.next();
    expect(phrases).toContain(result);
  });

  test("cycles through all items before repeating", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      seen.add(picker.next());
    }
    expect(seen.size).toBe(3);
  });

  test("re-shuffles after exhausting the pool", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    for (let i = 0; i < 3; i++) picker.next();
    const result = picker.next();
    expect(phrases).toContain(result);
  });

  test("does not repeat the last item of cycle as first item of next cycle", () => {
    const phrases = ["a", "b"];
    const picker = new NarrationPicker(phrases);
    const results: string[] = [];
    for (let i = 0; i < 20; i++) {
      results.push(picker.next());
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).not.toBe(results[i - 1]);
    }
  });

  test("handles single-item array", () => {
    const picker = new NarrationPicker(["only"]);
    expect(picker.next()).toBe("only");
    expect(picker.next()).toBe("only");
  });
});

describe("ACK_PHRASES", () => {
  test("has at least 30 phrases", () => {
    expect(ACK_PHRASES.length).toBeGreaterThanOrEqual(30);
  });

  test("no duplicates", () => {
    const unique = new Set(ACK_PHRASES);
    expect(unique.size).toBe(ACK_PHRASES.length);
  });

  test("no phrases contain possessive 'your'", () => {
    for (const phrase of ACK_PHRASES) {
      expect(phrase.toLowerCase()).not.toContain("your");
    }
  });
});

describe("TOOL_NARRATIONS", () => {
  test("covers core tools", () => {
    const expectedTools = [
      "git.status", "git.diff", "git.log",
      "docker.ps", "docker.logs",
      "fs.read", "fs.write",
      "bash.exec",
      "recall_memory",
      "web.fetch",
      "getEnvironmentStatus",
    ];
    for (const tool of expectedTools) {
      expect(TOOL_NARRATIONS[tool]).toBeDefined();
      expect(TOOL_NARRATIONS[tool]!.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("no phrases contain possessive 'your'", () => {
    for (const [, phrases] of Object.entries(TOOL_NARRATIONS)) {
      for (const phrase of phrases) {
        expect(phrase.toLowerCase()).not.toContain("your");
      }
    }
  });
});

describe("GENERIC_NARRATIONS", () => {
  test("has at least 5 fallback phrases", () => {
    expect(GENERIC_NARRATIONS.length).toBeGreaterThanOrEqual(5);
  });
});
