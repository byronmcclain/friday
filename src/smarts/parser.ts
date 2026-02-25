import type { SmartEntry, SmartSource } from "./types.ts";

type ParsedSmart = Omit<SmartEntry, "filePath">;

const VALID_SOURCES: SmartSource[] = ["manual", "auto", "conversation"];

export function parseFrontmatter(raw: string): ParsedSmart | null {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, yamlBlock, body] = match;
  if (!yamlBlock || body === undefined) return null;

  const fields = parseYamlFields(yamlBlock);

  const name = fields.name;
  const domain = fields.domain;
  const tagsRaw = fields.tags;
  if (!name || !domain || !tagsRaw) return null;

  const tags = parseYamlArray(tagsRaw);
  const confidence = fields.confidence ? Number.parseFloat(fields.confidence) : 0.7;
  const source: SmartSource = VALID_SOURCES.includes(fields.source as SmartSource)
    ? (fields.source as SmartSource)
    : "manual";

  const sessionIdRaw = fields.session_id ?? fields.sessionId;
  const sessionId = sessionIdRaw ? Number.parseInt(sessionIdRaw, 10) : undefined;

  const createdAt = fields.created?.trim() || undefined;

  return {
    name: name.trim(),
    domain: domain.trim(),
    tags,
    confidence,
    source,
    ...(sessionId !== undefined && Number.isFinite(sessionId) ? { sessionId } : {}),
    ...(createdAt ? { createdAt } : {}),
    content: body.trim(),
  };
}

function unescapeYaml(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function quoteYaml(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function serializeSmartFile(entry: Omit<SmartEntry, "filePath">): string {
  const today = new Date().toISOString().split("T")[0];
  const createdDate = entry.createdAt ?? today;
  const tagsLine = entry.tags.map((t) => `  - ${quoteYaml(t)}`).join("\n");

  return `---
name: ${quoteYaml(entry.name)}
domain: ${quoteYaml(entry.domain)}
tags:
${tagsLine}
confidence: ${entry.confidence}
source: ${quoteYaml(entry.source)}
${entry.sessionId !== undefined ? `session_id: ${entry.sessionId}\n` : ""}created: ${createdDate}
updated: ${today}
---

${entry.content}
`;
}

function parseYamlFields(yaml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey = "";

  for (const line of yaml.split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1]!;
      fields[currentKey] = unescapeYaml(kvMatch[2]!.trim().replace(/^(['"])(.*)\1$/, "$2"));
    } else if (currentKey && line.match(/^\s+-\s+/)) {
      fields[currentKey] = `${fields[currentKey] || ""}\x1F${line.replace(/^\s+-\s+/, "").trim()}`;
    }
  }

  return fields;
}

function stripQuotes(s: string): string {
  return unescapeYaml(s.replace(/^(['"])(.*)\1$/, "$2"));
}

function parseYamlArray(value: string): string[] {
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1]!
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  if (value === "") {
    return [];
  }
  // Block-list items are joined with \x1F (unit separator) to avoid comma corruption
  if (value.includes("\x1F")) {
    return value
      .split("\x1F")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  return value
    .split(",")
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
}
