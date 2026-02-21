import type { SmartEntry, SmartSource } from "./types.ts";

type ParsedSmart = Omit<SmartEntry, "filePath">;

const VALID_SOURCES: SmartSource[] = ["manual", "auto", "conversation"];

export function parseFrontmatter(raw: string): ParsedSmart | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
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

  return {
    name: name.trim(),
    domain: domain.trim(),
    tags,
    confidence,
    source,
    content: body.trim(),
  };
}

export function serializeSmartFile(entry: Omit<SmartEntry, "filePath">): string {
  const today = new Date().toISOString().split("T")[0];
  const tagsLine = entry.tags.map((t) => `  - ${t}`).join("\n");

  return `---
name: ${entry.name}
domain: ${entry.domain}
tags:
${tagsLine}
confidence: ${entry.confidence}
source: ${entry.source}
created: ${today}
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
      fields[currentKey] = kvMatch[2]!.trim();
    } else if (currentKey && line.match(/^\s+-\s+/)) {
      fields[currentKey] = `${fields[currentKey] || ""},${line.replace(/^\s+-\s+/, "").trim()}`;
    }
  }

  return fields;
}

function parseYamlArray(value: string): string[] {
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (value === "") {
    return [];
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
