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

export class SQLiteMemory {
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

  async saveConversation(session: ConversationSession): Promise<void> {
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
  }

  async getConversationHistory(limit = 20): Promise<ConversationSession[]> {
    const rows = this.db
      .query<
        {
          id: string;
          started_at: string;
          ended_at: string | null;
          provider: string;
          model: string;
          messages: string;
          summary: string | null;
        },
        [number]
      >("SELECT * FROM conversations ORDER BY started_at DESC LIMIT ?")
      .all(limit);

    return rows.map((r) => ({
      id: r.id,
      startedAt: new Date(r.started_at),
      endedAt: r.ended_at ? new Date(r.ended_at) : undefined,
      provider: r.provider,
      model: r.model,
      messages: JSON.parse(r.messages) as ConversationMessage[],
      summary: r.summary ?? undefined,
    }));
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
