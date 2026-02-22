import type { SmartEntry, SmartsConfig } from "./types.ts";
import { parseFrontmatter, serializeSmartFile } from "./parser.ts";
import type { SQLiteMemory } from "../core/memory.ts";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const SMARTS_NAMESPACE = "smarts";

export class SmartsStore {
  private entries = new Map<string, SmartEntry>();
  private embeddingIds = new Map<string, string>();
  private config!: SmartsConfig;
  private memory!: SQLiteMemory;

  async initialize(config: SmartsConfig, memory: SQLiteMemory): Promise<void> {
    this.config = config;
    this.memory = memory;
    this.entries.clear();
    this.embeddingIds.clear();

    const dir = resolve(config.smartsDir);
    await mkdir(dir, { recursive: true });
    await this.memory.purgeNamespace(SMARTS_NAMESPACE);

    await this.scanAndIndex(dir);
  }

  private async scanAndIndex(dir: string): Promise<void> {
    const glob = new Bun.Glob("*.md");
    const parsed: { entry: SmartEntry; embeddingContent: string }[] = [];

    for await (const match of glob.scan({ cwd: dir, onlyFiles: true })) {
      const filePath = `${dir}/${match}`;
      try {
        const file = Bun.file(filePath);
        const raw = await file.text();
        const result = parseFrontmatter(raw);
        if (result) {
          const entry: SmartEntry = { ...result, filePath };
          parsed.push({
            entry,
            embeddingContent: `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
          });
        }
      } catch {
        // Skip files that can't be read or parsed
      }
    }

    if (parsed.length === 0) return;

    const ids = await this.memory.embedBatch(
      SMARTS_NAMESPACE,
      parsed.map((p) => ({ content: p.embeddingContent, metadata: { name: p.entry.name } })),
    );

    for (let i = 0; i < parsed.length; i++) {
      const { entry } = parsed[i]!;
      this.entries.set(entry.name, entry);
      this.embeddingIds.set(entry.name, ids[i]!);
    }
  }

  async findRelevant(query: string, limit?: number): Promise<SmartEntry[]> {
    const maxResults = limit ?? this.config.maxPerMessage;
    const ftsResults = await this.memory.search(SMARTS_NAMESPACE, query, maxResults * 3);

    const results: SmartEntry[] = [];
    let tokenCount = 0;

    for (const ftsResult of ftsResults) {
      const name = (ftsResult.metadata as { name?: string })?.name;
      if (!name) continue;
      const entry = this.entries.get(name);
      if (!entry) continue;
      if (entry.confidence < this.config.minConfidence) continue;

      const entryTokens = Math.ceil(entry.content.length / 4);
      if (tokenCount + entryTokens > this.config.tokenBudget) continue;

      results.push(entry);
      tokenCount += entryTokens;

      if (results.length >= maxResults) break;
    }

    return results;
  }

  async getByDomain(domain: string): Promise<SmartEntry[]> {
    return this.all().filter((e) => e.domain === domain);
  }

  async getByName(name: string): Promise<SmartEntry | undefined> {
    return this.entries.get(name);
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  }

  async create(entry: Omit<SmartEntry, "filePath">): Promise<SmartEntry> {
    // Clean up existing entry with same name to avoid orphaned FTS5 embeddings
    const existingEmbeddingId = this.embeddingIds.get(entry.name);
    if (existingEmbeddingId) {
      await this.memory.forget(SMARTS_NAMESPACE, existingEmbeddingId);
    }

    const dir = resolve(this.config.smartsDir);
    const safeName = this.sanitizeName(entry.name);
    if (!safeName) throw new Error("Invalid SMART entry name");
    const filePath = `${dir}/${safeName}.md`;
    const resolvedFilePath = resolve(filePath);
    if (!resolvedFilePath.startsWith(`${dir}/`)) {
      throw new Error("Invalid SMART entry name: path escape");
    }
    const content = serializeSmartFile(entry);

    await Bun.write(filePath, content);

    const full: SmartEntry = { ...entry, filePath };
    this.entries.set(entry.name, full);

    const embeddingId = await this.memory.embed(
      SMARTS_NAMESPACE,
      `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
      { name: entry.name },
    );
    this.embeddingIds.set(entry.name, embeddingId);

    return full;
  }

  async update(name: string, content: string): Promise<void> {
    const existing = this.entries.get(name);
    if (!existing) return;

    const updated: SmartEntry = { ...existing, content };
    const serialized = serializeSmartFile(updated);
    await Bun.write(existing.filePath, serialized);

    this.entries.set(name, updated);

    // In-place FTS5 update: forget old embedding, embed new one
    const oldEmbeddingId = this.embeddingIds.get(name);
    if (oldEmbeddingId) {
      await this.memory.forget(SMARTS_NAMESPACE, oldEmbeddingId);
    }
    const embeddingContent = `${updated.name} ${updated.domain} ${updated.tags.join(" ")} ${updated.content}`;
    const newId = await this.memory.embed(SMARTS_NAMESPACE, embeddingContent, { name });
    this.embeddingIds.set(name, newId);
  }

  async reindex(): Promise<void> {
    await this.memory.purgeNamespace(SMARTS_NAMESPACE);
    this.entries.clear();
    this.embeddingIds.clear();
    const dir = resolve(this.config.smartsDir);
    await this.scanAndIndex(dir);
  }

  domains(): string[] {
    const domainSet = new Set<string>();
    for (const entry of this.entries.values()) {
      domainSet.add(entry.domain);
    }
    return [...domainSet];
  }

  all(): SmartEntry[] {
    return [...this.entries.values()];
  }
}
