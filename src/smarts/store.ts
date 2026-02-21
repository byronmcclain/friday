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

    await this.scanAndIndex(dir);
  }

  private async scanAndIndex(dir: string): Promise<void> {
    const glob = new Bun.Glob("*.md");

    for await (const match of glob.scan({ cwd: dir, onlyFiles: true })) {
      const filePath = `${dir}/${match}`;
      try {
        const file = Bun.file(filePath);
        const raw = await file.text();
        const parsed = parseFrontmatter(raw);
        if (parsed) {
          const entry: SmartEntry = { ...parsed, filePath };
          this.entries.set(entry.name, entry);
          const embeddingId = await this.memory.embed(
            SMARTS_NAMESPACE,
            `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
            { name: entry.name },
          );
          this.embeddingIds.set(entry.name, embeddingId);
        }
      } catch {
        // Skip files that can't be read or parsed
      }
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

  async create(entry: Omit<SmartEntry, "filePath">): Promise<SmartEntry> {
    // Clean up existing entry with same name to avoid orphaned FTS5 embeddings
    const existingEmbeddingId = this.embeddingIds.get(entry.name);
    if (existingEmbeddingId) {
      await this.memory.forget(SMARTS_NAMESPACE, existingEmbeddingId);
    }

    const dir = resolve(this.config.smartsDir);
    const filePath = `${dir}/${entry.name}.md`;
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
    await this.reindex();
  }

  async reindex(): Promise<void> {
    for (const embeddingId of this.embeddingIds.values()) {
      await this.memory.forget(SMARTS_NAMESPACE, embeddingId);
    }

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
