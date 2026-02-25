import { describe, test, expect } from "bun:test";
import { parseFrontmatter, serializeSmartFile } from "../../src/smarts/parser.ts";

describe("parseFrontmatter", () => {
  test("parses valid YAML frontmatter and markdown body", () => {
    const raw = `---
name: security-basics
domain: security
tags: [owasp, xss]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Security Basics

Always validate input.`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("security-basics");
    expect(result!.domain).toBe("security");
    expect(result!.tags).toEqual(["owasp", "xss"]);
    expect(result!.confidence).toBe(0.9);
    expect(result!.source).toBe("manual");
    expect(result!.content).toContain("# Security Basics");
    expect(result!.content).toContain("Always validate input.");
  });

  test("returns null for missing frontmatter delimiters", () => {
    const raw = "# Just Markdown\n\nNo frontmatter here.";
    expect(parseFrontmatter(raw)).toBeNull();
  });

  test("returns null for missing required fields", () => {
    const raw = `---
name: incomplete
---

# Missing domain and tags`;

    expect(parseFrontmatter(raw)).toBeNull();
  });

  test("defaults confidence to 0.7 when missing", () => {
    const raw = `---
name: auto-generated
domain: general
tags: [misc]
source: auto
created: 2026-02-21
updated: 2026-02-21
---

# Auto content`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.7);
  });

  test("defaults source to manual when missing", () => {
    const raw = `---
name: user-authored
domain: general
tags: [misc]
confidence: 1.0
created: 2026-02-21
updated: 2026-02-21
---

# User content`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("manual");
  });

  test("handles Windows-style line endings (CRLF)", () => {
    const raw = "---\r\nname: crlf-test\r\ndomain: general\r\ntags: [test]\r\nconfidence: 0.8\r\nsource: manual\r\ncreated: 2026-02-21\r\nupdated: 2026-02-21\r\n---\r\n\r\n# CRLF Content\r\n\r\nWorks with Windows.";
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("crlf-test");
    expect(result!.content).toContain("CRLF Content");
  });

  test("strips surrounding quotes from YAML values", () => {
    const raw = `---
name: "quoted-name"
domain: 'quoted-domain'
tags: [test]
confidence: 0.9
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Quoted`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("quoted-name");
    expect(result!.domain).toBe("quoted-domain");
  });

  test("parses session_id from frontmatter", () => {
    const raw = `---
name: test-entry
domain: test
tags: [a, b]
confidence: 0.7
source: conversation
session_id: 42
created: 2026-02-22
updated: 2026-02-22
---

Test content.`;
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(42);
  });

  test("parses entry without session_id as undefined", () => {
    const raw = `---
name: legacy-entry
domain: test
tags: [a]
confidence: 0.7
source: manual
created: 2026-02-22
updated: 2026-02-22
---

Legacy content.`;
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBeUndefined();
  });

  test("handles tags containing commas in block-list format", () => {
    const raw = `---\nname: "Test"\ndomain: "dev"\ntags:\n  - "TypeScript, strict mode"\n  - "Bun runtime"\nconfidence: 0.8\nsource: manual\n---\n\nContent`;
    const parsed = parseFrontmatter(raw);
    expect(parsed!.tags).toEqual(["TypeScript, strict mode", "Bun runtime"]);
  });

  test("parses created date from frontmatter", () => {
    const raw = `---
name: "Test"
domain: "dev"
tags:
  - "bun"
confidence: 0.8
source: manual
created: 2026-01-15
updated: 2026-01-20
---

Test content`;
    const parsed = parseFrontmatter(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.createdAt).toBe("2026-01-15");
  });

  test("trims whitespace from body", () => {
    const raw = `---
name: trimmed
domain: general
tags: [test]
source: manual
created: 2026-02-21
updated: 2026-02-21
---


  # Content with leading whitespace

Body text.

`;

    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.content).not.toStartWith("\n");
    expect(result!.content).not.toEndWith("\n\n");
  });
});

describe("serializeSmartFile", () => {
  test("produces valid frontmatter + markdown", () => {
    const output = serializeSmartFile({
      name: "test-smart",
      domain: "testing",
      tags: ["unit", "bun"],
      confidence: 0.8,
      source: "auto",
      content: "# Test Knowledge\n\nSome content here.",
    });

    expect(output).toContain("---");
    expect(output).toContain('name: "test-smart"');
    expect(output).toContain('domain: "testing"');
    expect(output).toContain("tags:");
    expect(output).toContain("confidence: 0.8");
    expect(output).toContain('source: "auto"');
    expect(output).toContain("# Test Knowledge");
  });

  test("includes session_id when present", () => {
    const output = serializeSmartFile({
      name: "test",
      domain: "test",
      tags: ["a"],
      confidence: 0.7,
      source: "conversation",
      sessionId: 42,
      content: "Test content.",
    });
    expect(output).toContain("session_id: 42");
  });

  test("omits session_id when undefined", () => {
    const output = serializeSmartFile({
      name: "test",
      domain: "test",
      tags: ["a"],
      confidence: 0.7,
      source: "manual",
      content: "Test content.",
    });
    expect(output).not.toContain("session_id");
  });

  test("preserves original created date through round-trip", () => {
    const raw = `---\nname: "Test"\ndomain: "dev"\ntags:\n  - "bun"\nconfidence: 0.8\nsource: manual\ncreated: 2026-01-15\nupdated: 2026-01-20\n---\n\nTest content`;
    const parsed = parseFrontmatter(raw);
    expect(parsed!.createdAt).toBe("2026-01-15");
    const serialized = serializeSmartFile(parsed!);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed!.createdAt).toBe("2026-01-15");
  });

  test("round-trips through parse", () => {
    const input = {
      name: "roundtrip",
      domain: "meta",
      tags: ["test"],
      confidence: 0.9,
      source: "manual" as const,
      content: "# Round Trip\n\nThis should survive.",
    };
    const serialized = serializeSmartFile(input);
    const parsed = parseFrontmatter(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe(input.name);
    expect(parsed!.domain).toBe(input.domain);
    expect(parsed!.tags).toEqual(input.tags);
    expect(parsed!.confidence).toBe(input.confidence);
    expect(parsed!.content).toContain("# Round Trip");
  });
});
