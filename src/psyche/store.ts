import type { Database } from "bun:sqlite";
import type {
	RelationalDimension,
	EmotionalMilestone,
	SessionMood,
	PsycheState,
	PsycheStoreConfig,
	EmotionalType,
} from "./types.ts";
import {
	PSYCHE_DEFAULTS,
	DIMENSION_NAMES,
	NEUTRAL_SEED_DIMENSIONS,
} from "./types.ts";

type DimensionRow = {
	name: string;
	description: string;
	updated_at: string;
};

type MilestoneRow = {
	id: string;
	occurred_at: string;
	summary: string;
	emotional_type: string;
	session_id: string | null;
	relevance_decay: number;
};

type SessionMoodRow = {
	session_id: string;
	started_mood: string;
	ended_mood: string;
	arc_summary: string;
	analyzed_at: string;
};

const LABEL: Record<string, string> = {
	trust: "Trust",
	banter: "Banter",
	emotional_openness: "Emotional openness",
	shared_history: "Shared history",
	current_energy: "Current energy",
};

export class PsycheStore {
	private db: Database;
	private config: PsycheStoreConfig;

	constructor(db: Database, config: PsycheStoreConfig = PSYCHE_DEFAULTS) {
		this.db = db;
		this.config = config;
		this.migrate();
	}

	private migrate(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS psyche_dimensions (
				name TEXT PRIMARY KEY,
				description TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS psyche_milestones (
				id TEXT PRIMARY KEY,
				occurred_at TEXT NOT NULL,
				summary TEXT NOT NULL,
				emotional_type TEXT NOT NULL,
				session_id TEXT,
				relevance_decay REAL NOT NULL DEFAULT 1.0
			)
		`);
		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS psyche_milestones_fts USING fts5(
				summary,
				content=psyche_milestones,
				content_rowid=rowid
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS psyche_session_moods (
				session_id TEXT PRIMARY KEY,
				started_mood TEXT NOT NULL,
				ended_mood TEXT NOT NULL,
				arc_summary TEXT NOT NULL,
				analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
	}

	// ── Dimensions ─────────────────────────────────────────────

	getDimensions(): RelationalDimension[] {
		const rows = this.db
			.query<DimensionRow, []>(
				"SELECT name, description, updated_at FROM psyche_dimensions ORDER BY name",
			)
			.all();
		return rows.map((r) => ({
			name: r.name,
			description: r.description,
			updatedAt: r.updated_at,
		}));
	}

	getDimension(name: string): RelationalDimension | undefined {
		const row = this.db
			.query<DimensionRow, [string]>(
				"SELECT name, description, updated_at FROM psyche_dimensions WHERE name = ?",
			)
			.get(name);
		if (!row) return undefined;
		return {
			name: row.name,
			description: row.description,
			updatedAt: row.updated_at,
		};
	}

	hasDimensions(): boolean {
		const row = this.db
			.query<{ cnt: number }, []>(
				"SELECT COUNT(*) as cnt FROM psyche_dimensions",
			)
			.get();
		return (row?.cnt ?? 0) > 0;
	}

	setDimension(name: string, description: string): void {
		this.db
			.query(
				"INSERT OR REPLACE INTO psyche_dimensions (name, description, updated_at) VALUES (?, ?, datetime('now'))",
			)
			.run(name, description);
	}

	seedNeutralDefaults(): void {
		for (const name of DIMENSION_NAMES) {
			this.setDimension(name, NEUTRAL_SEED_DIMENSIONS[name]);
		}
	}

	getDimensionSummary(): string {
		const dims = this.getDimensions();
		return dims
			.map((d) => `${LABEL[d.name] ?? d.name}: ${d.description}`)
			.join("\n");
	}

	// ── Milestones ─────────────────────────────────────────────

	addMilestone(input: {
		summary: string;
		emotionalType: EmotionalType;
		sessionId?: string;
	}): EmotionalMilestone {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.db.transaction(() => {
			this.db
				.query(
					"INSERT INTO psyche_milestones (id, occurred_at, summary, emotional_type, session_id, relevance_decay) VALUES (?, ?, ?, ?, ?, 1.0)",
				)
				.run(id, now, input.summary, input.emotionalType, input.sessionId ?? null);
			const row = this.db
				.query<{ rowid: number }, [string]>(
					"SELECT rowid FROM psyche_milestones WHERE id = ?",
				)
				.get(id);
			if (row) {
				this.db
					.query(
						"INSERT INTO psyche_milestones_fts(rowid, summary) VALUES (?, ?)",
					)
					.run(row.rowid, input.summary);
			}
		})();
		return {
			id,
			occurredAt: now,
			summary: input.summary,
			emotionalType: input.emotionalType,
			sessionId: input.sessionId,
			relevanceDecay: 1.0,
		};
	}

	getMilestones(limit = 10): EmotionalMilestone[] {
		const rows = this.db
			.query<MilestoneRow, [number]>(
				"SELECT id, occurred_at, summary, emotional_type, session_id, relevance_decay FROM psyche_milestones ORDER BY occurred_at DESC, rowid DESC LIMIT ?",
			)
			.all(limit);
		return rows.map((r) => this.mapMilestone(r));
	}

	findRelevantMilestones(query: string, limit = 3): EmotionalMilestone[] {
		const sanitized = query.replace(/['"*()]/g, " ").trim();
		if (!sanitized) return [];
		const ftsRows = this.db
			.query<{ rowid: number; rank: number }, [string, number]>(
				"SELECT rowid, rank FROM psyche_milestones_fts WHERE summary MATCH ? ORDER BY rank LIMIT ?",
			)
			.all(sanitized, limit * 3);
		if (ftsRows.length === 0) return [];

		const milestones: (EmotionalMilestone & { score: number })[] = [];
		for (const fts of ftsRows) {
			const row = this.db
				.query<MilestoneRow, [number]>(
					"SELECT id, occurred_at, summary, emotional_type, session_id, relevance_decay FROM psyche_milestones WHERE rowid = ?",
				)
				.get(fts.rowid);
			if (row) {
				milestones.push({
					...this.mapMilestone(row),
					score: Math.abs(fts.rank) * row.relevance_decay,
				});
			}
		}
		return milestones
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}

	pruneMilestones(): void {
		const count =
			this.db
				.query<{ cnt: number }, []>(
					"SELECT COUNT(*) as cnt FROM psyche_milestones",
				)
				.get()?.cnt ?? 0;
		if (count <= this.config.maxMilestones) return;

		const excess = count - this.config.maxMilestones;
		const toDelete = this.db
			.query<{ id: string; rowid: number }, [number]>(
				"SELECT id, rowid FROM psyche_milestones ORDER BY relevance_decay ASC, occurred_at ASC LIMIT ?",
			)
			.all(excess);

		this.db.transaction(() => {
			for (const row of toDelete) {
				this.db
					.query("DELETE FROM psyche_milestones_fts WHERE rowid = ?")
					.run(row.rowid);
				this.db
					.query("DELETE FROM psyche_milestones WHERE id = ?")
					.run(row.id);
			}
		})();
	}

	// ── Session Mood ───────────────────────────────────────────

	saveSessionMood(input: {
		sessionId: string;
		startedMood: string;
		endedMood: string;
		arcSummary: string;
	}): void {
		this.db
			.query(
				"INSERT OR REPLACE INTO psyche_session_moods (session_id, started_mood, ended_mood, arc_summary, analyzed_at) VALUES (?, ?, ?, ?, datetime('now'))",
			)
			.run(
				input.sessionId,
				input.startedMood,
				input.endedMood,
				input.arcSummary,
			);
	}

	getLastSessionMood(): SessionMood | undefined {
		const row = this.db
			.query<SessionMoodRow, []>(
				"SELECT session_id, started_mood, ended_mood, arc_summary, analyzed_at FROM psyche_session_moods ORDER BY analyzed_at DESC, rowid DESC LIMIT 1",
			)
			.get();
		if (!row) return undefined;
		return {
			sessionId: row.session_id,
			startedMood: row.started_mood,
			endedMood: row.ended_mood,
			arcSummary: row.arc_summary,
			analyzedAt: row.analyzed_at,
		};
	}

	// ── Relevance Decay ────────────────────────────────────────

	decayMilestones(): void {
		const rows = this.db
			.query<
				{ id: string; occurred_at: string; relevance_decay: number },
				[]
			>(
				"SELECT id, occurred_at, relevance_decay FROM psyche_milestones WHERE relevance_decay > ?",
			)
			.all(this.config.decayFloor);

		const now = Date.now();
		for (const row of rows) {
			const ageMs = now - new Date(row.occurred_at).getTime();
			const ageDays = ageMs / (24 * 60 * 60 * 1000);
			if (ageDays <= this.config.decayGraceDays) continue;
			const daysOverGrace = ageDays - this.config.decayGraceDays;
			const decayRate = Math.LN2 / this.config.decayHalfLifeDays;
			const newDecay = Math.max(
				this.config.decayFloor,
				Math.exp(-decayRate * daysOverGrace),
			);
			this.db
				.query(
					"UPDATE psyche_milestones SET relevance_decay = ? WHERE id = ?",
				)
				.run(newDecay, row.id);
		}
	}

	// ── Aggregate State ────────────────────────────────────────

	getState(): PsycheState {
		return {
			dimensions: this.getDimensions(),
			milestones: this.getMilestones(),
			lastSessionMood: this.getLastSessionMood(),
		};
	}

	reset(): void {
		this.db.transaction(() => {
			this.db.run("DELETE FROM psyche_milestones_fts");
			this.db.run("DELETE FROM psyche_milestones");
			this.db.run("DELETE FROM psyche_dimensions");
			this.db.run("DELETE FROM psyche_session_moods");
		})();
	}

	private mapMilestone(row: MilestoneRow): EmotionalMilestone {
		return {
			id: row.id,
			occurredAt: row.occurred_at,
			summary: row.summary,
			emotionalType: row.emotional_type as EmotionalType,
			sessionId: row.session_id ?? undefined,
			relevanceDecay: row.relevance_decay,
		};
	}
}
