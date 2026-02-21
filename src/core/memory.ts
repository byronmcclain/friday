import { Database } from "bun:sqlite";
import type { ConversationMessage } from "./types.ts";

export interface ConversationSession {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  provider: string;
  model: string;
  messages: ConversationMessage[];
  summary?: string;
}

export interface SemanticResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ScopedMemory {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

type ConversationRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  provider: string;
  model: string;
  messages: string;
  summary: string | null;
};

export class SQLiteMemory {
  private static readonly MAX_CONVERSATIONS = 500;
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        messages TEXT NOT NULL,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- FTS5 standalone table; manually synced with embeddings via embed()/forget()
      CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
        content
      );
    `);
  }

  async get<T>(namespace: string, key: string): Promise<T | undefined> {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        "SELECT value FROM kv WHERE namespace = ? AND key = ?",
      )
      .get(namespace, key);
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.db
      .query(
        "INSERT OR REPLACE INTO kv (namespace, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
      )
      .run(namespace, key, JSON.stringify(value));
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.db.query("DELETE FROM kv WHERE namespace = ? AND key = ?").run(namespace, key);
  }

  async list(namespace: string): Promise<string[]> {
    const rows = this.db
      .query<{ key: string }, [string]>("SELECT key FROM kv WHERE namespace = ?")
      .all(namespace);
    return rows.map((r) => r.key);
  }

  private mapRow(row: ConversationRow): ConversationSession {
    return {
      id: row.id,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      provider: row.provider,
      model: row.model,
      messages: JSON.parse(row.messages) as ConversationMessage[],
      summary: row.summary ?? undefined,
    };
  }

  async saveConversation(session: ConversationSession): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query(
          "INSERT OR REPLACE INTO conversations (id, started_at, ended_at, provider, model, messages, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          session.id,
          session.startedAt.toISOString(),
          session.endedAt?.toISOString() ?? null,
          session.provider,
          session.model,
          JSON.stringify(session.messages),
          session.summary ?? null,
        );
      this.db
        .query(
          "DELETE FROM conversations WHERE id NOT IN (SELECT id FROM conversations ORDER BY started_at DESC LIMIT ?)",
        )
        .run(SQLiteMemory.MAX_CONVERSATIONS);
    })();
  }

  async getConversationHistory(limit = 20): Promise<ConversationSession[]> {
    const rows = this.db
      .query<ConversationRow, [number]>(
        "SELECT id, started_at, ended_at, provider, model, messages, summary FROM conversations ORDER BY started_at DESC LIMIT ?",
      )
      .all(limit);

    return rows.map((r) => this.mapRow(r));
  }

  async getConversationById(id: string): Promise<ConversationSession | undefined> {
    const row = this.db
      .query<ConversationRow, [string]>(
        "SELECT id, started_at, ended_at, provider, model, messages, summary FROM conversations WHERE id = ?",
      )
      .get(id);

    if (!row) return undefined;
    return this.mapRow(row);
  }

  async deleteAllConversations(): Promise<void> {
    this.db.query("DELETE FROM conversations").run();
  }

  async embed(
    namespace: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.db
        .query("INSERT INTO embeddings (id, namespace, content, metadata) VALUES (?, ?, ?, ?)")
        .run(id, namespace, content, metadata ? JSON.stringify(metadata) : null);
      const row = this.db
        .query<{ rowid: number }, [string]>("SELECT rowid FROM embeddings WHERE id = ?")
        .get(id);
      if (row) {
        this.db
          .query("INSERT INTO embeddings_fts (rowid, content) VALUES (?, ?)")
          .run(row.rowid, content);
      }
    })();
    return id;
  }

  async search(namespace: string, query: string, limit = 5): Promise<SemanticResult[]> {
    const sanitized = query.replace(/['"*()]/g, " ").trim();
    if (!sanitized) return [];
    const terms = sanitized.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const ftsQuery = terms.map((t) => `"${t}"*`).join(" OR ");

    try {
      const rows = this.db
        .query<
          { id: string; content: string; metadata: string | null; rank: number },
          [string, string, number]
        >(
          `SELECT e.id, e.content, e.metadata, fts.rank
           FROM embeddings_fts fts
           JOIN embeddings e ON e.rowid = fts.rowid
           WHERE embeddings_fts MATCH ?1 AND e.namespace = ?2
           ORDER BY fts.rank
           LIMIT ?3`,
        )
        .all(ftsQuery, namespace, limit);

      return rows.map((r) => ({
        id: r.id,
        content: r.content,
        similarity: Math.abs(r.rank),
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch {
      return [];
    }
  }

  async forget(namespace: string, embeddingId: string): Promise<void> {
    const row = this.db
      .query<{ rowid: number }, [string, string]>("SELECT rowid FROM embeddings WHERE id = ? AND namespace = ?")
      .get(embeddingId, namespace);
    if (row) {
      this.db.query("DELETE FROM embeddings_fts WHERE rowid = ?").run(row.rowid);
    }
    this.db
      .query("DELETE FROM embeddings WHERE id = ? AND namespace = ?")
      .run(embeddingId, namespace);
  }

  scoped(namespace: string): ScopedMemory {
    return {
      get: <T>(key: string) => this.get<T>(namespace, key),
      set: <T>(key: string, value: T) => this.set(namespace, key, value),
      delete: (key: string) => this.delete(namespace, key),
      list: () => this.list(namespace),
    };
  }

  close(): void {
    this.db.close();
  }
}
