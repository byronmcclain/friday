import type { SmartEntry, SmartsConfig } from "./types.ts";
import { parseFrontmatter, serializeSmartFile } from "./parser.ts";
import type { SQLiteMemory } from "../core/memory.ts";
import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const SMARTS_NAMESPACE = "smarts";

export class SmartsStore {
  private static readonly MAX_SESSION_AGE = 5;

  private entries = new Map<string, SmartEntry>();
  private embeddingIds = new Map<string, string>();
  private config!: SmartsConfig;
  private memory!: SQLiteMemory;
  private _currentSession = 0;

  get currentSession(): number {
    return this._currentSession;
  }

  async initialize(config: SmartsConfig, memory: SQLiteMemory): Promise<void> {
    this.config = config;
    this.memory = memory;
    this.entries.clear();
    this.embeddingIds.clear();

    const dir = resolve(config.smartsDir);
    await mkdir(dir, { recursive: true });

    // Increment session counter
    const prev = await this.memory.get<number>("smarts", "session-counter") ?? 0;
    this._currentSession = prev + 1;
    await this.memory.set("smarts", "session-counter", this._currentSession);

    // Prune expired entries before indexing
    await this.pruneExpired(dir);

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
      const key = this.sanitizeName(entry.name);
      this.entries.set(key, entry);
      this.embeddingIds.set(key, ids[i]!);
    }
  }

  private async pruneExpired(dir: string): Promise<void> {
    const glob = new Bun.Glob("*.md");
    for await (const match of glob.scan({ cwd: dir, onlyFiles: true })) {
      const filePath = `${dir}/${match}`;
      try {
        const raw = await Bun.file(filePath).text();
        const parsed = parseFrontmatter(raw);
        if (!parsed) continue;

        // Manual entries never expire
        if (parsed.source === "manual") continue;

        if (parsed.sessionId === undefined) {
          // Legacy entry — stamp with current session (migration)
          const stamped = serializeSmartFile({ ...parsed, sessionId: this._currentSession });
          await Bun.write(filePath, stamped);
          continue;
        }

        // Prune if expired
        if (this._currentSession - parsed.sessionId > SmartsStore.MAX_SESSION_AGE) {
          await unlink(filePath);
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
      const key = this.sanitizeName(name);
      const entry = this.entries.get(key);
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
    const key = this.sanitizeName(name);
    return this.entries.get(key);
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  }

  async create(entry: Omit<SmartEntry, "filePath">): Promise<SmartEntry> {
    const safeName = this.sanitizeName(entry.name);
    if (!safeName) throw new Error("Invalid SMART entry name");

    // Check for collision: different display name but same sanitized key
    const existing = this.entries.get(safeName);
    if (existing && existing.name !== entry.name) {
      throw new Error(`SMART entry name "${entry.name}" collides with existing "${existing.name}" (both sanitize to "${safeName}")`);
    }

    // Clean up existing entry with same sanitized name to avoid orphaned FTS5 embeddings
    const existingEmbeddingId = this.embeddingIds.get(safeName);
    if (existingEmbeddingId) {
      await this.memory.forget(SMARTS_NAMESPACE, existingEmbeddingId);
    }

    const dir = resolve(this.config.smartsDir);
    const filePath = `${dir}/${safeName}.md`;
    const resolvedFilePath = resolve(filePath);
    if (!resolvedFilePath.startsWith(`${dir}/`)) {
      throw new Error("Invalid SMART entry name: path escape");
    }
    const stamped = { ...entry, sessionId: this._currentSession };
    const content = serializeSmartFile(stamped);

    await Bun.write(filePath, content);

    const full: SmartEntry = { ...stamped, filePath };
    this.entries.set(safeName, full);

    const embeddingId = await this.memory.embed(
      SMARTS_NAMESPACE,
      `${entry.name} ${entry.domain} ${entry.tags.join(" ")} ${entry.content}`,
      { name: entry.name },
    );
    this.embeddingIds.set(safeName, embeddingId);

    return full;
  }

  async update(name: string, content: string, opts?: { tags?: string[]; confidence?: number }): Promise<void> {
    const key = this.sanitizeName(name);
    const existing = this.entries.get(key);
    if (!existing) throw new Error(`SMARTS entry '${name}' not found`);

    const updated: SmartEntry = {
      ...existing,
      content,
      sessionId: this._currentSession,
      ...(opts?.tags !== undefined ? { tags: opts.tags } : {}),
      ...(opts?.confidence !== undefined ? { confidence: opts.confidence } : {}),
    };
    const serialized = serializeSmartFile(updated);
    await Bun.write(existing.filePath, serialized);

    this.entries.set(key, updated);

    // In-place FTS5 update: forget old embedding, embed new one
    const oldEmbeddingId = this.embeddingIds.get(key);
    if (oldEmbeddingId) {
      await this.memory.forget(SMARTS_NAMESPACE, oldEmbeddingId);
    }
    const embeddingContent = `${updated.name} ${updated.domain} ${updated.tags.join(" ")} ${updated.content}`;
    const newId = await this.memory.embed(SMARTS_NAMESPACE, embeddingContent, { name: existing.name });
    this.embeddingIds.set(key, newId);
  }

  async reindex(): Promise<void> {
    const newEntries = new Map<string, SmartEntry>();
    const newEmbeddingIds = new Map<string, string>();
    const oldEntries = this.entries;
    const oldEmbeddingIds = this.embeddingIds;
    this.entries = newEntries;
    this.embeddingIds = newEmbeddingIds;
    try {
      await this.memory.purgeNamespace(SMARTS_NAMESPACE);
      await this.scanAndIndex(resolve(this.config.smartsDir));
    } catch (err) {
      this.entries = oldEntries;
      this.embeddingIds = oldEmbeddingIds;
      throw err;
    }
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
