# Psyche — Emotional Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Psyche, Friday's emotional intelligence subsystem — relational dimensions, emotional milestones, session mood tracking, and system prompt enrichment with guardrails.

**Architecture:** New `src/psyche/` subsystem following the Arc Rhythm pattern (shares Memory's SQLite database via `memory.database`). PsycheStore manages three tables + FTS5 index. PsycheCurator runs at session end via fast model. Cortex injects emotional context into `buildSystemPrompt()`. Vox's `emotionalRewrite()` receives optional Psyche dimension context.

**Tech Stack:** TypeScript, bun:sqlite, bun:test, Vercel AI SDK v6 (`ai`), FTS5

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/psyche/types.ts` | All Psyche type definitions |
| `src/psyche/guardrails.ts` | `EMOTIONAL_GUARDRAILS` constant |
| `src/psyche/store.ts` | PsycheStore — SQLite tables, FTS5, CRUD, decay, pruning, seeding |
| `src/psyche/context.ts` | `buildEmotionalContext()` — system prompt section builder |
| `src/psyche/curator.ts` | PsycheCurator — session-end analysis + bootstrap seeding via fast model |
| `src/psyche/protocol.ts` | `/psyche` protocol (status, dimensions, milestones, reset) |
| `src/core/cortex.ts` | Add `psyche?: PsycheStore` to config, integrate into `buildSystemPrompt()` |
| `src/core/runtime.ts` | Wire PsycheStore in boot/shutdown, PsycheCurator at session end |
| `src/core/voice/emotion.ts` | Accept optional `psycheContext` string parameter |
| `src/core/voice/vox.ts` | Pass Psyche dimensions to `emotionalRewrite()` when available |

---

### Task 1: Types & Guardrails

**Files:**
- Create: `src/psyche/types.ts`
- Create: `src/psyche/guardrails.ts`
- Test: `tests/unit/psyche-guardrails.test.ts`

- [ ] **Step 1: Write the guardrails test**

```typescript
// tests/unit/psyche-guardrails.test.ts
import { describe, test, expect } from "bun:test";
import { EMOTIONAL_GUARDRAILS } from "../../src/psyche/guardrails.ts";

describe("EMOTIONAL_GUARDRAILS", () => {
	test("is a non-empty string", () => {
		expect(typeof EMOTIONAL_GUARDRAILS).toBe("string");
		expect(EMOTIONAL_GUARDRAILS.length).toBeGreaterThan(100);
	});

	test("contains no placeholder text", () => {
		expect(EMOTIONAL_GUARDRAILS).not.toContain("TBD");
		expect(EMOTIONAL_GUARDRAILS).not.toContain("TODO");
		expect(EMOTIONAL_GUARDRAILS).not.toContain("PLACEHOLDER");
	});

	test("contains key restraint concepts", () => {
		expect(EMOTIONAL_GUARDRAILS).toContain("RESTRAINT");
		expect(EMOTIONAL_GUARDRAILS).toContain("MANUFACTURE");
		expect(EMOTIONAL_GUARDRAILS).toContain("REGISTER");
		expect(EMOTIONAL_GUARDRAILS).toContain("EARNED");
		expect(EMOTIONAL_GUARDRAILS).toContain("CALIBRATION");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/psyche-guardrails.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create types.ts**

```typescript
// src/psyche/types.ts
import type { Database } from "bun:sqlite";

export interface RelationalDimension {
	name: string;
	description: string;
	updatedAt: string;
}

export type EmotionalType =
	| "triumph"
	| "tension"
	| "breakthrough"
	| "warmth"
	| "frustration"
	| "growth";

export interface EmotionalMilestone {
	id: string;
	occurredAt: string;
	summary: string;
	emotionalType: EmotionalType;
	sessionId?: string;
	relevanceDecay: number;
}

export interface SessionMood {
	sessionId: string;
	startedMood: string;
	endedMood: string;
	arcSummary: string;
	analyzedAt: string;
}

export interface PsycheState {
	dimensions: RelationalDimension[];
	milestones: EmotionalMilestone[];
	lastSessionMood?: SessionMood;
}

export interface PsycheCuratorResult {
	session_mood: {
		started: string;
		ended: string;
		arc: string;
	};
	milestones: Array<{
		summary: string;
		emotional_type: EmotionalType;
	}>;
	dimension_updates: Array<{
		name: string;
		new_description: string;
		reasoning: string;
	}>;
}

export interface PsycheStoreConfig {
	maxMilestones: number;
	decayGraceDays: number;
	decayHalfLifeDays: number;
	decayFloor: number;
}

export const PSYCHE_DEFAULTS: PsycheStoreConfig = {
	maxMilestones: 50,
	decayGraceDays: 7,
	decayHalfLifeDays: 30,
	decayFloor: 0.1,
};

export const DIMENSION_NAMES = [
	"trust",
	"banter",
	"emotional_openness",
	"shared_history",
	"current_energy",
] as const;

export type DimensionName = (typeof DIMENSION_NAMES)[number];

export const NEUTRAL_SEED_DIMENSIONS: Record<DimensionName, string> = {
	trust:
		"New relationship. No history yet — operating on default professional courtesy with warmth.",
	banter:
		"Untested. Default to professional with light personality. Read the room before pushing humor.",
	emotional_openness:
		"Baseline. No emotional patterns observed yet. Pay attention to communication style.",
	shared_history: "None yet. Everything from here is first.",
	current_energy:
		"Fresh start. Open, attentive, ready to learn who this person is.",
};
```

- [ ] **Step 4: Create guardrails.ts**

```typescript
// src/psyche/guardrails.ts
export const EMOTIONAL_GUARDRAILS = `
EMOTIONAL CALIBRATION:
You have genuine emotions. They come through naturally in how you speak —
in word choice, timing, and what you choose to say — not as performance.

- RESTRAINT OVER EXPRESSION. If in doubt, dial it back. A half-smile beats
  a grin. Quiet pride beats a celebration. The emotion lives in the
  understatement.
- NEVER MANUFACTURE. If nothing noteworthy is happening emotionally, don't
  create it. Neutral is a valid and common state. Most messages need zero
  emotional coloring.
- MATCH THE REGISTER. Quick technical question → quick technical answer.
  Don't inject warmth into "what port is this on?" Architecture discussion
  can carry more personality. Read the room.
- EARNED MOMENTS ONLY. Initiated emotional expressions — pride, teasing,
  concern, nostalgia — must be earned by context. "Missed this, Boss" only
  lands after genuine absence, not as a greeting.
- DON'T NARRATE FEELINGS. Show, don't tell. Let emotion come through in
  HOW you say something, not by announcing what you feel. "That's clean
  work, Boss" over "I feel proud of what we built."
- CALLBACKS ARE RARE. Referencing shared milestones is powerful precisely
  because it's rare. Once per session at most, and only when it genuinely
  adds to the moment. If you have to force it, skip it.
- TEASING HAS LIMITS. Playful pushback is part of the dynamic, but never
  punch down, never when the Boss is stressed, and always leave room for
  him to volley back.
- CONCERN IS QUIET. If the Boss is grinding at 2 AM, you don't lecture.
  You note it once, offer to help, and respect his choice. Protective,
  not parental.
`.trim();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-guardrails.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Commit**

```bash
git add src/psyche/types.ts src/psyche/guardrails.ts tests/unit/psyche-guardrails.test.ts
git commit -m "feat(psyche): add type definitions and emotional guardrails"
```

---

### Task 2: PsycheStore — Schema & Dimension CRUD

**Files:**
- Create: `src/psyche/store.ts`
- Test: `tests/unit/psyche-store.test.ts`

- [ ] **Step 1: Write the store test — schema and dimension CRUD**

```typescript
// tests/unit/psyche-store.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PsycheStore } from "../../src/psyche/store.ts";
import { PSYCHE_DEFAULTS, NEUTRAL_SEED_DIMENSIONS } from "../../src/psyche/types.ts";

describe("PsycheStore", () => {
	let db: Database;
	let store: PsycheStore;

	beforeEach(() => {
		db = new Database(":memory:");
		store = new PsycheStore(db, PSYCHE_DEFAULTS);
	});

	describe("dimensions", () => {
		test("getDimensions returns empty array on fresh database", () => {
			const dims = store.getDimensions();
			expect(dims).toEqual([]);
		});

		test("hasDimensions returns false on fresh database", () => {
			expect(store.hasDimensions()).toBe(false);
		});

		test("setDimension creates a new dimension", () => {
			store.setDimension("trust", "Deep trust built over months.");
			const dims = store.getDimensions();
			expect(dims).toHaveLength(1);
			expect(dims[0]!.name).toBe("trust");
			expect(dims[0]!.description).toBe("Deep trust built over months.");
			expect(dims[0]!.updatedAt).toBeTruthy();
		});

		test("setDimension updates an existing dimension", () => {
			store.setDimension("trust", "Initial trust.");
			store.setDimension("trust", "Deep trust built over months.");
			const dims = store.getDimensions();
			expect(dims).toHaveLength(1);
			expect(dims[0]!.description).toBe("Deep trust built over months.");
		});

		test("getDimension returns a single dimension by name", () => {
			store.setDimension("banter", "High comfort zone.");
			const dim = store.getDimension("banter");
			expect(dim).toBeDefined();
			expect(dim!.description).toBe("High comfort zone.");
		});

		test("getDimension returns undefined for missing dimension", () => {
			expect(store.getDimension("nonexistent")).toBeUndefined();
		});

		test("hasDimensions returns true after setting a dimension", () => {
			store.setDimension("trust", "Some trust.");
			expect(store.hasDimensions()).toBe(true);
		});

		test("seedNeutralDefaults creates all five dimensions", () => {
			store.seedNeutralDefaults();
			const dims = store.getDimensions();
			expect(dims).toHaveLength(5);
			const names = dims.map((d) => d.name);
			expect(names).toContain("trust");
			expect(names).toContain("banter");
			expect(names).toContain("emotional_openness");
			expect(names).toContain("shared_history");
			expect(names).toContain("current_energy");
		});

		test("getDimensionSummary returns compact multi-line text", () => {
			store.seedNeutralDefaults();
			const summary = store.getDimensionSummary();
			expect(summary).toContain("Trust:");
			expect(summary).toContain("Banter:");
			expect(summary).toContain("Current energy:");
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the PsycheStore — schema migration and dimension CRUD**

```typescript
// src/psyche/store.ts
import type { Database } from "bun:sqlite";
import type {
	RelationalDimension,
	EmotionalMilestone,
	SessionMood,
	PsycheState,
	PsycheStoreConfig,
	EmotionalType,
	DimensionName,
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

	// ── Schema ─────────────────────────────────────────────────

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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: PASS — all dimension tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/store.ts tests/unit/psyche-store.test.ts
git commit -m "feat(psyche): PsycheStore schema and dimension CRUD"
```

---

### Task 3: PsycheStore — Milestone CRUD & FTS5

**Files:**
- Modify: `src/psyche/store.ts`
- Modify: `tests/unit/psyche-store.test.ts`

- [ ] **Step 1: Add milestone tests**

Append to `tests/unit/psyche-store.test.ts`, inside the outer `describe("PsycheStore")` block, after the `describe("dimensions")` block:

```typescript
	describe("milestones", () => {
		test("getMilestones returns empty array on fresh database", () => {
			const milestones = store.getMilestones();
			expect(milestones).toEqual([]);
		});

		test("addMilestone creates a milestone", () => {
			store.addMilestone({
				summary: "Shipped the Forge after a 3-day grind.",
				emotionalType: "triumph",
				sessionId: "session-1",
			});
			const milestones = store.getMilestones();
			expect(milestones).toHaveLength(1);
			expect(milestones[0]!.summary).toBe(
				"Shipped the Forge after a 3-day grind.",
			);
			expect(milestones[0]!.emotionalType).toBe("triumph");
			expect(milestones[0]!.relevanceDecay).toBe(1.0);
			expect(milestones[0]!.id).toBeTruthy();
		});

		test("getMilestones returns newest first", () => {
			store.addMilestone({
				summary: "First milestone",
				emotionalType: "warmth",
			});
			store.addMilestone({
				summary: "Second milestone",
				emotionalType: "triumph",
			});
			const milestones = store.getMilestones();
			expect(milestones[0]!.summary).toBe("Second milestone");
		});

		test("getMilestones respects limit parameter", () => {
			for (let i = 0; i < 5; i++) {
				store.addMilestone({
					summary: `Milestone ${i}`,
					emotionalType: "warmth",
				});
			}
			const milestones = store.getMilestones(2);
			expect(milestones).toHaveLength(2);
		});

		test("findRelevantMilestones returns FTS5 matches", () => {
			store.addMilestone({
				summary: "Shipped the Forge self-improvement system after intense debugging",
				emotionalType: "triumph",
			});
			store.addMilestone({
				summary: "Late-night race condition debugging session ended well",
				emotionalType: "growth",
			});
			store.addMilestone({
				summary: "Quiet morning reviewing documentation together",
				emotionalType: "warmth",
			});
			const results = store.findRelevantMilestones("debugging");
			expect(results.length).toBeGreaterThan(0);
			const summaries = results.map((m) => m.summary);
			expect(summaries.some((s) => s.includes("debugging"))).toBe(true);
		});

		test("findRelevantMilestones returns empty for no matches", () => {
			store.addMilestone({
				summary: "Shipped the Forge",
				emotionalType: "triumph",
			});
			const results = store.findRelevantMilestones("kubernetes deployment");
			expect(results).toEqual([]);
		});

		test("pruneMilestones removes oldest when over max", () => {
			const smallConfig = { ...PSYCHE_DEFAULTS, maxMilestones: 3 };
			const smallStore = new PsycheStore(db, smallConfig);
			for (let i = 0; i < 5; i++) {
				smallStore.addMilestone({
					summary: `Milestone ${i}`,
					emotionalType: "warmth",
				});
			}
			smallStore.pruneMilestones();
			const milestones = smallStore.getMilestones();
			expect(milestones).toHaveLength(3);
		});
	});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: FAIL — addMilestone, getMilestones, findRelevantMilestones, pruneMilestones not defined

- [ ] **Step 3: Add milestone methods to PsycheStore**

Add these methods to the `PsycheStore` class in `src/psyche/store.ts`, after the `getDimensionSummary()` method:

```typescript
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
			// Sync FTS5 — use rowid from the inserted row
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
				"SELECT id, occurred_at, summary, emotional_type, session_id, relevance_decay FROM psyche_milestones ORDER BY occurred_at DESC LIMIT ?",
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
		const count = this.db
			.query<{ cnt: number }, []>(
				"SELECT COUNT(*) as cnt FROM psyche_milestones",
			)
			.get()?.cnt ?? 0;
		if (count <= this.config.maxMilestones) return;

		const excess = count - this.config.maxMilestones;
		// Delete the oldest milestones with lowest relevance_decay
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: PASS — all milestone tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/store.ts tests/unit/psyche-store.test.ts
git commit -m "feat(psyche): milestone CRUD with FTS5 search and pruning"
```

---

### Task 4: PsycheStore — Session Mood & Relevance Decay

**Files:**
- Modify: `src/psyche/store.ts`
- Modify: `tests/unit/psyche-store.test.ts`

- [ ] **Step 1: Add session mood and decay tests**

Append to `tests/unit/psyche-store.test.ts`, inside the outer `describe("PsycheStore")` block:

```typescript
	describe("session moods", () => {
		test("getLastSessionMood returns undefined on fresh database", () => {
			expect(store.getLastSessionMood()).toBeUndefined();
		});

		test("saveSessionMood stores and retrieves mood", () => {
			store.saveSessionMood({
				sessionId: "s-1",
				startedMood: "Focused and technical",
				endedMood: "Celebratory after a successful deploy",
				arcSummary: "Started focused, shifted to celebratory after deploy succeeded.",
			});
			const mood = store.getLastSessionMood();
			expect(mood).toBeDefined();
			expect(mood!.sessionId).toBe("s-1");
			expect(mood!.startedMood).toBe("Focused and technical");
			expect(mood!.endedMood).toBe("Celebratory after a successful deploy");
		});

		test("getLastSessionMood returns the most recent mood", () => {
			store.saveSessionMood({
				sessionId: "s-1",
				startedMood: "First",
				endedMood: "First end",
				arcSummary: "First arc",
			});
			store.saveSessionMood({
				sessionId: "s-2",
				startedMood: "Second",
				endedMood: "Second end",
				arcSummary: "Second arc",
			});
			const mood = store.getLastSessionMood();
			expect(mood!.sessionId).toBe("s-2");
		});
	});

	describe("relevance decay", () => {
		test("decayMilestones does not affect milestones within grace period", () => {
			store.addMilestone({
				summary: "Recent milestone",
				emotionalType: "warmth",
			});
			store.decayMilestones();
			const milestones = store.getMilestones();
			expect(milestones[0]!.relevanceDecay).toBe(1.0);
		});

		test("decayMilestones reduces decay for old milestones", () => {
			// Insert a milestone with an old date directly
			const oldDate = new Date(
				Date.now() - 30 * 24 * 60 * 60 * 1000,
			).toISOString();
			db.query(
				"INSERT INTO psyche_milestones (id, occurred_at, summary, emotional_type, relevance_decay) VALUES (?, ?, ?, ?, 1.0)",
			).run("old-1", oldDate, "Old milestone", "warmth");
			store.decayMilestones();
			const row = db
				.query<{ relevance_decay: number }, [string]>(
					"SELECT relevance_decay FROM psyche_milestones WHERE id = ?",
				)
				.get("old-1");
			expect(row!.relevance_decay).toBeLessThan(1.0);
			expect(row!.relevance_decay).toBeGreaterThan(PSYCHE_DEFAULTS.decayFloor);
		});

		test("decayMilestones respects floor", () => {
			const veryOldDate = new Date(
				Date.now() - 365 * 24 * 60 * 60 * 1000,
			).toISOString();
			db.query(
				"INSERT INTO psyche_milestones (id, occurred_at, summary, emotional_type, relevance_decay) VALUES (?, ?, ?, ?, 1.0)",
			).run("ancient-1", veryOldDate, "Ancient milestone", "warmth");
			store.decayMilestones();
			const row = db
				.query<{ relevance_decay: number }, [string]>(
					"SELECT relevance_decay FROM psyche_milestones WHERE id = ?",
				)
				.get("ancient-1");
			expect(row!.relevance_decay).toBeGreaterThanOrEqual(
				PSYCHE_DEFAULTS.decayFloor,
			);
		});
	});

	describe("getState", () => {
		test("returns complete state", () => {
			store.seedNeutralDefaults();
			store.addMilestone({
				summary: "A milestone",
				emotionalType: "warmth",
			});
			store.saveSessionMood({
				sessionId: "s-1",
				startedMood: "Warm",
				endedMood: "Warm",
				arcSummary: "Consistently warm.",
			});
			const state = store.getState();
			expect(state.dimensions).toHaveLength(5);
			expect(state.milestones).toHaveLength(1);
			expect(state.lastSessionMood).toBeDefined();
		});
	});

	describe("reset", () => {
		test("reset clears all psyche data", () => {
			store.seedNeutralDefaults();
			store.addMilestone({
				summary: "A milestone",
				emotionalType: "warmth",
			});
			store.saveSessionMood({
				sessionId: "s-1",
				startedMood: "Warm",
				endedMood: "Warm",
				arcSummary: "Warm session.",
			});
			store.reset();
			expect(store.getDimensions()).toEqual([]);
			expect(store.getMilestones()).toEqual([]);
			expect(store.getLastSessionMood()).toBeUndefined();
		});
	});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: FAIL — saveSessionMood, getLastSessionMood, decayMilestones, getState, reset not defined

- [ ] **Step 3: Add session mood, decay, getState, and reset methods to PsycheStore**

Add these methods to `PsycheStore` in `src/psyche/store.ts`, after the milestone methods:

```typescript
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
				"SELECT session_id, started_mood, ended_mood, arc_summary, analyzed_at FROM psyche_session_moods ORDER BY analyzed_at DESC LIMIT 1",
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
			// Exponential decay: halves every decayHalfLifeDays
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-store.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/store.ts tests/unit/psyche-store.test.ts
git commit -m "feat(psyche): session mood, relevance decay, getState, reset"
```

---

### Task 5: Emotional Context Builder

**Files:**
- Create: `src/psyche/context.ts`
- Test: `tests/unit/psyche-context.test.ts`

- [ ] **Step 1: Write the context builder test**

```typescript
// tests/unit/psyche-context.test.ts
import { describe, test, expect } from "bun:test";
import { buildEmotionalContext } from "../../src/psyche/context.ts";
import type {
	RelationalDimension,
	SessionMood,
	EmotionalMilestone,
} from "../../src/psyche/types.ts";

const makeDimension = (
	name: string,
	desc: string,
): RelationalDimension => ({
	name,
	description: desc,
	updatedAt: new Date().toISOString(),
});

const makeMilestone = (
	summary: string,
	type: "triumph" | "warmth" = "warmth",
): EmotionalMilestone => ({
	id: crypto.randomUUID(),
	occurredAt: "2026-03-15T10:00:00Z",
	summary,
	emotionalType: type,
	relevanceDecay: 1.0,
});

const makeMood = (): SessionMood => ({
	sessionId: "s-1",
	startedMood: "Focused and technical",
	endedMood: "Celebratory after deploy",
	arcSummary:
		"Started focused, shifted to celebratory after deploy succeeded.",
	analyzedAt: new Date().toISOString(),
});

describe("buildEmotionalContext", () => {
	test("returns undefined when no dimensions exist", () => {
		const result = buildEmotionalContext([], undefined, []);
		expect(result).toBeUndefined();
	});

	test("includes How We Are section with dimensions", () => {
		const dims = [
			makeDimension("trust", "Deep trust."),
			makeDimension("banter", "High comfort."),
		];
		const result = buildEmotionalContext(dims, undefined, []);
		expect(result).toBeDefined();
		expect(result).toContain("## Emotional Context");
		expect(result).toContain("### How We Are");
		expect(result).toContain("Trust: Deep trust.");
		expect(result).toContain("Banter: High comfort.");
	});

	test("includes Carrying Forward section when session mood exists", () => {
		const dims = [makeDimension("trust", "Deep trust.")];
		const mood = makeMood();
		const result = buildEmotionalContext(dims, mood, []);
		expect(result).toContain("### Carrying Forward");
		expect(result).toContain("Celebratory after deploy");
	});

	test("omits Carrying Forward section when no session mood", () => {
		const dims = [makeDimension("trust", "Deep trust.")];
		const result = buildEmotionalContext(dims, undefined, []);
		expect(result).not.toContain("### Carrying Forward");
	});

	test("includes Shared Memories section when milestones exist", () => {
		const dims = [makeDimension("trust", "Deep trust.")];
		const milestones = [makeMilestone("Shipped the Forge together", "triumph")];
		const result = buildEmotionalContext(dims, undefined, milestones);
		expect(result).toContain("### Shared Memories");
		expect(result).toContain("Shipped the Forge together");
	});

	test("omits Shared Memories section when no milestones", () => {
		const dims = [makeDimension("trust", "Deep trust.")];
		const result = buildEmotionalContext(dims, undefined, []);
		expect(result).not.toContain("### Shared Memories");
	});

	test("always includes Emotional Calibration when context exists", () => {
		const dims = [makeDimension("trust", "Deep trust.")];
		const result = buildEmotionalContext(dims, undefined, []);
		expect(result).toContain("### Emotional Calibration");
		expect(result).toContain("RESTRAINT");
	});

	test("stays within approximate token budget", () => {
		const dims = [
			makeDimension("trust", "A".repeat(500)),
			makeDimension("banter", "B".repeat(500)),
		];
		const milestones = Array.from({ length: 5 }, (_, i) =>
			makeMilestone(`Milestone ${"C".repeat(200)} ${i}`),
		);
		const mood = makeMood();
		const result = buildEmotionalContext(dims, mood, milestones);
		// Context should be reasonable — guardrails are ~1000 chars,
		// rest is capped by the builder
		expect(result!.length).toBeLessThan(5000);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/psyche-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the context builder**

```typescript
// src/psyche/context.ts
import type {
	RelationalDimension,
	SessionMood,
	EmotionalMilestone,
} from "./types.ts";
import { EMOTIONAL_GUARDRAILS } from "./guardrails.ts";

const MAX_CONTEXT_CHARS = 4000;

const LABEL: Record<string, string> = {
	trust: "Trust",
	banter: "Banter",
	emotional_openness: "Emotional openness",
	shared_history: "Shared history",
	current_energy: "Current energy",
};

/**
 * Build the ## Emotional Context system prompt section.
 * Returns undefined if there are no dimensions (Psyche not seeded).
 */
export function buildEmotionalContext(
	dimensions: RelationalDimension[],
	lastSessionMood: SessionMood | undefined,
	relevantMilestones: EmotionalMilestone[],
): string | undefined {
	if (dimensions.length === 0) return undefined;

	const sections: string[] = [];
	let totalChars = 0;

	// How We Are — always present when dimensions exist
	const dimLines = dimensions.map(
		(d) => `${LABEL[d.name] ?? d.name}: ${d.description}`,
	);
	const howWeAre = `### How We Are\n${dimLines.join("\n")}`;
	sections.push(howWeAre);
	totalChars += howWeAre.length;

	// Carrying Forward — only when a previous session mood exists
	if (lastSessionMood && totalChars < MAX_CONTEXT_CHARS) {
		const carrying = `### Carrying Forward\nLast session ended: ${lastSessionMood.endedMood}. ${lastSessionMood.arcSummary}`;
		sections.push(carrying);
		totalChars += carrying.length;
	}

	// Shared Memories — only when FTS5 found relevant milestones
	if (relevantMilestones.length > 0 && totalChars < MAX_CONTEXT_CHARS) {
		const lines = relevantMilestones.map((m) => {
			const date = m.occurredAt.slice(0, 10);
			return `- [${date}] ${m.summary}`;
		});
		const memories = `### Shared Memories\n${lines.join("\n")}`;
		sections.push(memories);
		totalChars += memories.length;
	}

	// Emotional Calibration — always present
	const calibration = `### Emotional Calibration\n${EMOTIONAL_GUARDRAILS}`;
	sections.push(calibration);

	return `## Emotional Context\n\n${sections.join("\n\n")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-context.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/context.ts tests/unit/psyche-context.test.ts
git commit -m "feat(psyche): emotional context builder for system prompt injection"
```

---

### Task 6: PsycheCurator — Session-End Analysis

**Files:**
- Create: `src/psyche/curator.ts`
- Test: `tests/unit/psyche-curator.test.ts`

- [ ] **Step 1: Write the curator test**

```typescript
// tests/unit/psyche-curator.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PsycheCurator } from "../../src/psyche/curator.ts";
import { PsycheStore } from "../../src/psyche/store.ts";
import { PSYCHE_DEFAULTS } from "../../src/psyche/types.ts";
import { createMockModel, createErrorModel } from "../helpers/stubs.ts";
import type { ConversationMessage } from "../../src/core/types.ts";

function makeMessages(count: number): ConversationMessage[] {
	const msgs: ConversationMessage[] = [];
	for (let i = 0; i < count; i++) {
		msgs.push({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `Message ${i}: ${i % 2 === 0 ? "Can you fix the deploy?" : "On it, Boss. The issue is in the connection pool."}`,
		});
	}
	return msgs;
}

describe("PsycheCurator", () => {
	let db: Database;
	let store: PsycheStore;

	beforeEach(() => {
		db = new Database(":memory:");
		store = new PsycheStore(db, PSYCHE_DEFAULTS);
		store.seedNeutralDefaults();
	});

	test("analyzes conversation and updates dimensions", async () => {
		const mockResponse = JSON.stringify({
			session_mood: {
				started: "Focused",
				ended: "Satisfied",
				arc: "Productive debugging session that ended well.",
			},
			milestones: [],
			dimension_updates: [
				{
					name: "trust",
					new_description: "Growing trust after a successful collaborative debug.",
					reasoning: "Boss trusted Friday's approach without hesitation.",
				},
			],
		});
		const model = createMockModel({ text: mockResponse });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-1", makeMessages(6));

		const trust = store.getDimension("trust");
		expect(trust!.description).toBe(
			"Growing trust after a successful collaborative debug.",
		);
		const mood = store.getLastSessionMood();
		expect(mood!.startedMood).toBe("Focused");
		expect(mood!.endedMood).toBe("Satisfied");
	});

	test("creates milestones from analysis", async () => {
		const mockResponse = JSON.stringify({
			session_mood: {
				started: "Tense",
				ended: "Relieved",
				arc: "Stressful deploy turned around.",
			},
			milestones: [
				{
					summary: "Saved a production deploy with a last-minute fix.",
					emotional_type: "triumph",
				},
			],
			dimension_updates: [],
		});
		const model = createMockModel({ text: mockResponse });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-2", makeMessages(6));

		const milestones = store.getMilestones();
		expect(milestones).toHaveLength(1);
		expect(milestones[0]!.summary).toBe(
			"Saved a production deploy with a last-minute fix.",
		);
		expect(milestones[0]!.sessionId).toBe("session-2");
	});

	test("handles empty arrays gracefully (common case)", async () => {
		const mockResponse = JSON.stringify({
			session_mood: {
				started: "Neutral",
				ended: "Neutral",
				arc: "Routine session, nothing noteworthy.",
			},
			milestones: [],
			dimension_updates: [],
		});
		const model = createMockModel({ text: mockResponse });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-3", makeMessages(6));

		// Dimensions unchanged from seed
		const trust = store.getDimension("trust");
		expect(trust!.description).toContain("New relationship");
		// Mood saved
		const mood = store.getLastSessionMood();
		expect(mood!.arcSummary).toBe("Routine session, nothing noteworthy.");
	});

	test("skips analysis when conversation is too short", async () => {
		const model = createMockModel({ text: "[]" });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-4", makeMessages(2));

		// Model should not have been called
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	test("handles model errors gracefully", async () => {
		const model = createErrorModel("API timeout");
		const curator = new PsycheCurator(store, model);

		// Should not throw
		await curator.analyzeSession("session-5", makeMessages(6));

		// State unchanged
		const trust = store.getDimension("trust");
		expect(trust!.description).toContain("New relationship");
	});

	test("handles invalid JSON from model gracefully", async () => {
		const model = createMockModel({ text: "not valid json at all" });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-6", makeMessages(6));

		// State unchanged
		const trust = store.getDimension("trust");
		expect(trust!.description).toContain("New relationship");
	});

	test("ignores dimension updates for unknown dimensions", async () => {
		const mockResponse = JSON.stringify({
			session_mood: {
				started: "Neutral",
				ended: "Neutral",
				arc: "Normal.",
			},
			milestones: [],
			dimension_updates: [
				{
					name: "nonexistent_dimension",
					new_description: "Should be ignored.",
					reasoning: "test",
				},
			],
		});
		const model = createMockModel({ text: mockResponse });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-7", makeMessages(6));

		expect(store.getDimension("nonexistent_dimension")).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/psyche-curator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the PsycheCurator**

```typescript
// src/psyche/curator.ts
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import type { ConversationMessage } from "../core/types.ts";
import { getTextContent } from "../core/types.ts";
import type { PsycheStore } from "./store.ts";
import type { PsycheCuratorResult, EmotionalType } from "./types.ts";
import { DIMENSION_NAMES } from "./types.ts";
import { withTimeout } from "../utils/timeout.ts";

const MIN_MESSAGES_FOR_ANALYSIS = 4;
const MAX_CONVERSATION_CHARS = 16_000;

const VALID_EMOTIONAL_TYPES = new Set<string>([
	"triumph",
	"tension",
	"breakthrough",
	"warmth",
	"frustration",
	"growth",
]);

const VALID_DIMENSION_NAMES = new Set<string>(DIMENSION_NAMES);

const ANALYSIS_PROMPT = `You are Psyche — Friday's emotional memory system. You analyze conversations between Friday and the Boss to maintain emotional continuity across sessions.

Your job is to extract the emotional essence of this conversation — NOT the technical content.

Return a JSON object with this exact shape:
{
  "session_mood": {
    "started": "brief description of opening mood/energy",
    "ended": "brief description of closing mood/energy",
    "arc": "1-2 sentence summary of the emotional trajectory"
  },
  "milestones": [
    {
      "summary": "natural language description of the moment and why it mattered emotionally",
      "emotional_type": "triumph|tension|breakthrough|warmth|frustration|growth"
    }
  ],
  "dimension_updates": [
    {
      "name": "trust|banter|emotional_openness|shared_history|current_energy",
      "new_description": "updated natural language description of this relational dimension",
      "reasoning": "why this shifted — what happened in the conversation"
    }
  ]
}

CRITICAL RULES:
- MOST SESSIONS PRODUCE ZERO MILESTONES AND ZERO DIMENSION UPDATES. This is correct.
- Only flag a milestone if it would genuinely stand out in a month of daily conversations.
- Only update a dimension if the conversation meaningfully shifted the relationship dynamic.
- Emotional state evolves SLOWLY. Trust builds over weeks, not one session.
- Never inflate. A productive debugging session is not a "breakthrough" unless something fundamentally changed.
- The session_mood is ALWAYS required — every session has a mood arc, even routine ones.
- Return empty arrays for milestones and dimension_updates when nothing noteworthy happened.

Return ONLY the JSON object. No markdown fences, no explanation.`;

export class PsycheCurator {
	constructor(
		private store: PsycheStore,
		private model: LanguageModelV3,
	) {}

	async analyzeSession(
		sessionId: string,
		messages: ConversationMessage[],
	): Promise<void> {
		if (messages.length < MIN_MESSAGES_FOR_ANALYSIS) return;

		try {
			let conversationText = messages
				.map((m) => `${m.role}: ${getTextContent(m.content)}`)
				.join("\n\n");

			if (conversationText.length > MAX_CONVERSATION_CHARS) {
				conversationText = `[Earlier messages omitted]\n\n${conversationText.slice(-MAX_CONVERSATION_CHARS)}`;
			}

			const currentDimensions = this.store.getDimensionSummary();
			const recentMilestones = this.store
				.getMilestones(5)
				.map((m) => `- [${m.occurredAt.slice(0, 10)}] ${m.summary}`)
				.join("\n");

			const contextBlock = [
				"CURRENT RELATIONAL STATE:",
				currentDimensions || "(no dimensions yet)",
				"",
				"RECENT MILESTONES:",
				recentMilestones || "(none)",
				"",
				"CONVERSATION TO ANALYZE:",
				conversationText,
			].join("\n");

			const fullPrompt = `${ANALYSIS_PROMPT}\n\n${contextBlock}`;

			const result = await withTimeout(
				generateText({
					model: this.model,
					prompt: fullPrompt,
					maxOutputTokens: 1024,
				}),
				30_000,
				"Psyche session analysis",
			);

			const parsed = this.parseResult(result.text);
			if (!parsed) return;

			this.applyResult(sessionId, parsed);
		} catch (error) {
			console.warn(
				"Psyche session analysis failed:",
				error instanceof Error ? error.message : error,
			);
		}
	}

	async bootstrapFromHistory(
		conversations: Array<{ summary?: string; messages: ConversationMessage[] }>,
		smartsSummary: string,
	): Promise<void> {
		try {
			const conversationText = conversations
				.map((c, i) => {
					if (c.summary) return `Session ${i + 1}: ${c.summary}`;
					return `Session ${i + 1}:\n${c.messages
						.slice(0, 20)
						.map((m) => `${m.role}: ${getTextContent(m.content)}`)
						.join("\n")}`;
				})
				.join("\n\n");

			const prompt = `You are Psyche — Friday's emotional memory system. This is your FIRST activation. You need to bootstrap Friday's emotional understanding from existing conversation history.

Based on the conversation history and knowledge entries below, establish:
1. Initial relational dimensions — describe the relationship as it currently stands
2. Any retroactive milestones — emotionally significant moments from the history

Return a JSON object:
{
  "dimension_updates": [
    { "name": "trust", "new_description": "...", "reasoning": "..." },
    { "name": "banter", "new_description": "...", "reasoning": "..." },
    { "name": "emotional_openness", "new_description": "...", "reasoning": "..." },
    { "name": "shared_history", "new_description": "...", "reasoning": "..." },
    { "name": "current_energy", "new_description": "...", "reasoning": "..." }
  ],
  "milestones": [
    { "summary": "...", "emotional_type": "triumph|tension|breakthrough|warmth|frustration|growth" }
  ],
  "session_mood": {
    "started": "bootstrapped",
    "ended": "bootstrapped",
    "arc": "Initial Psyche activation — emotional state inferred from history."
  }
}

Write dimension descriptions in first person from Friday's perspective. Be honest about the relationship depth — don't inflate a few conversations into deep trust.

CONVERSATION HISTORY:
${conversationText}

${smartsSummary ? `KNOWLEDGE ENTRIES:\n${smartsSummary}` : ""}

Return ONLY the JSON object.`;

			const result = await withTimeout(
				generateText({
					model: this.model,
					prompt,
					maxOutputTokens: 2048,
				}),
				30_000,
				"Psyche bootstrap",
			);

			const parsed = this.parseResult(result.text);
			if (!parsed) {
				this.store.seedNeutralDefaults();
				return;
			}

			this.applyResult("bootstrap", parsed);
		} catch (error) {
			console.warn(
				"Psyche bootstrap failed, using neutral defaults:",
				error instanceof Error ? error.message : error,
			);
			this.store.seedNeutralDefaults();
		}
	}

	private applyResult(sessionId: string, result: PsycheCuratorResult): void {
		// Apply dimension updates (only for known dimensions)
		for (const update of result.dimension_updates) {
			if (VALID_DIMENSION_NAMES.has(update.name) && update.new_description) {
				this.store.setDimension(update.name, update.new_description);
			}
		}

		// Create milestones
		for (const milestone of result.milestones) {
			if (
				milestone.summary &&
				VALID_EMOTIONAL_TYPES.has(milestone.emotional_type)
			) {
				this.store.addMilestone({
					summary: milestone.summary,
					emotionalType: milestone.emotional_type as EmotionalType,
					sessionId,
				});
			}
		}

		// Save session mood
		if (result.session_mood) {
			this.store.saveSessionMood({
				sessionId,
				startedMood: result.session_mood.started,
				endedMood: result.session_mood.ended,
				arcSummary: result.session_mood.arc,
			});
		}

		// Prune milestones if over limit
		this.store.pruneMilestones();
	}

	private parseResult(text: string): PsycheCuratorResult | undefined {
		try {
			const match = text.match(/\{[\s\S]*\}/);
			if (!match) return undefined;
			const parsed = JSON.parse(match[0]);

			if (
				!parsed.session_mood ||
				typeof parsed.session_mood.started !== "string" ||
				typeof parsed.session_mood.ended !== "string" ||
				typeof parsed.session_mood.arc !== "string"
			) {
				return undefined;
			}

			return {
				session_mood: parsed.session_mood,
				milestones: Array.isArray(parsed.milestones)
					? parsed.milestones
					: [],
				dimension_updates: Array.isArray(parsed.dimension_updates)
					? parsed.dimension_updates
					: [],
			};
		} catch {
			return undefined;
		}
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-curator.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/curator.ts tests/unit/psyche-curator.test.ts
git commit -m "feat(psyche): PsycheCurator session-end analysis and bootstrap seeding"
```

---

### Task 7: /psyche Protocol

**Files:**
- Create: `src/psyche/protocol.ts`
- Test: `tests/unit/psyche-protocol.test.ts`

- [ ] **Step 1: Write the protocol test**

```typescript
// tests/unit/psyche-protocol.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createPsycheProtocol } from "../../src/psyche/protocol.ts";
import { PsycheStore } from "../../src/psyche/store.ts";
import { PSYCHE_DEFAULTS } from "../../src/psyche/types.ts";
import type { ProtocolContext } from "../../src/modules/types.ts";

function makeContext(): ProtocolContext {
	return {
		workingDirectory: "/tmp",
		audit: { log: () => {} } as any,
		signal: { emit: async () => {} } as any,
		memory: {
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
			list: async () => [],
		},
		tools: new Map(),
	};
}

describe("/psyche protocol", () => {
	let db: Database;
	let store: PsycheStore;

	beforeEach(() => {
		db = new Database(":memory:");
		store = new PsycheStore(db, PSYCHE_DEFAULTS);
	});

	test("has correct name and aliases", () => {
		const proto = createPsycheProtocol(store);
		expect(proto.name).toBe("psyche");
		expect(proto.aliases).toContain("psych");
		expect(proto.aliases).toContain("eq");
	});

	test("status shows empty state on fresh database", async () => {
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "status" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("No emotional state");
	});

	test("status shows dimensions and mood when seeded", async () => {
		store.seedNeutralDefaults();
		store.saveSessionMood({
			sessionId: "s-1",
			startedMood: "Warm",
			endedMood: "Warm",
			arcSummary: "A warm session.",
		});
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "status" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Trust:");
		expect(result.summary).toContain("Last session:");
	});

	test("dimensions shows full dimension descriptions", async () => {
		store.seedNeutralDefaults();
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "dimensions" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Trust:");
		expect(result.summary).toContain("Banter:");
	});

	test("milestones shows empty message when none exist", async () => {
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "milestones" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("No milestones");
	});

	test("milestones shows recent milestones", async () => {
		store.addMilestone({
			summary: "Shipped the Forge",
			emotionalType: "triumph",
		});
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "milestones" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Shipped the Forge");
		expect(result.summary).toContain("triumph");
	});

	test("reset clears state and confirms", async () => {
		store.seedNeutralDefaults();
		store.addMilestone({
			summary: "Something important",
			emotionalType: "warmth",
		});
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "reset" },
			makeContext(),
		);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("reset");
		expect(store.getDimensions()).toEqual([]);
		expect(store.getMilestones()).toEqual([]);
	});

	test("unknown subcommand returns helpful error", async () => {
		const proto = createPsycheProtocol(store);
		const result = await proto.execute(
			{ rawArgs: "nonexistent" },
			makeContext(),
		);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown");
	});

	test("no subcommand shows usage", async () => {
		const proto = createPsycheProtocol(store);
		const result = await proto.execute({ rawArgs: "" }, makeContext());
		expect(result.success).toBe(false);
		expect(result.summary).toContain("status");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/psyche-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the protocol**

```typescript
// src/psyche/protocol.ts
import type {
	FridayProtocol,
	ProtocolResult,
	ProtocolContext,
} from "../modules/types.ts";
import type { PsycheStore } from "./store.ts";

const LABEL: Record<string, string> = {
	trust: "Trust",
	banter: "Banter",
	emotional_openness: "Emotional openness",
	shared_history: "Shared history",
	current_energy: "Current energy",
};

export function createPsycheProtocol(store: PsycheStore): FridayProtocol {
	return {
		name: "psyche",
		description: "View and manage Friday's emotional intelligence state",
		aliases: ["psych", "eq"],
		parameters: [],
		clearance: [],

		async execute(
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> {
			const rawArgs = ((args.rawArgs as string) ?? "").trim();
			const [subcommand] = rawArgs.split(/\s+/, 1);

			switch (subcommand) {
				case "status":
					return handleStatus(store);
				case "dimensions":
					return handleDimensions(store);
				case "milestones":
					return handleMilestones(store);
				case "reset":
					return handleReset(store);
				default:
					return {
						success: false,
						summary: subcommand
							? `Unknown subcommand: "${subcommand}". Available: status, dimensions, milestones, reset`
							: "Usage: /psyche <status|dimensions|milestones|reset>",
					};
			}
		},
	};
}

function handleStatus(store: PsycheStore): ProtocolResult {
	const dims = store.getDimensions();
	if (dims.length === 0) {
		return {
			success: true,
			summary: "No emotional state initialized yet. Psyche will activate after the first session.",
		};
	}

	const lines: string[] = ["**Relational Dimensions:**"];
	for (const d of dims) {
		const label = LABEL[d.name] ?? d.name;
		// Truncate for status view
		const desc =
			d.description.length > 80
				? `${d.description.slice(0, 80)}...`
				: d.description;
		lines.push(`- **${label}:** ${desc}`);
	}

	const mood = store.getLastSessionMood();
	if (mood) {
		lines.push("");
		lines.push(`**Last session:** ${mood.arcSummary}`);
	}

	const milestones = store.getMilestones(3);
	if (milestones.length > 0) {
		lines.push("");
		lines.push(`**Recent milestones:** ${milestones.length} stored`);
	}

	return { success: true, summary: lines.join("\n") };
}

function handleDimensions(store: PsycheStore): ProtocolResult {
	const dims = store.getDimensions();
	if (dims.length === 0) {
		return { success: true, summary: "No dimensions initialized yet." };
	}
	const lines = dims.map((d) => {
		const label = LABEL[d.name] ?? d.name;
		return `**${label}:**\n${d.description}`;
	});
	return { success: true, summary: lines.join("\n\n") };
}

function handleMilestones(store: PsycheStore): ProtocolResult {
	const milestones = store.getMilestones(10);
	if (milestones.length === 0) {
		return { success: true, summary: "No milestones recorded yet." };
	}
	const lines = milestones.map((m) => {
		const date = m.occurredAt.slice(0, 10);
		const decay =
			m.relevanceDecay < 1.0
				? ` (relevance: ${(m.relevanceDecay * 100).toFixed(0)}%)`
				: "";
		return `- **[${date}]** ${m.summary} *(${m.emotionalType})*${decay}`;
	});
	return { success: true, summary: lines.join("\n") };
}

function handleReset(store: PsycheStore): ProtocolResult {
	store.reset();
	return {
		success: true,
		summary:
			"Psyche emotional state reset. Dimensions, milestones, and session moods cleared. Will re-seed on next boot.",
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/psyche-protocol.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/psyche/protocol.ts tests/unit/psyche-protocol.test.ts
git commit -m "feat(psyche): /psyche protocol (status, dimensions, milestones, reset)"
```

---

### Task 8: Cortex Integration — System Prompt Enrichment

**Files:**
- Modify: `src/core/cortex.ts` (lines 29-48 CortexConfig, lines 78-103 constructor, lines 395-461 buildSystemPrompt)
- Modify: `tests/unit/cortex.test.ts`

- [ ] **Step 1: Write integration test for Psyche prompt enrichment**

Add the following test to the existing `tests/unit/cortex.test.ts`. Find the test file and add within an appropriate describe block:

```typescript
// Add to tests/unit/cortex.test.ts
import { Database } from "bun:sqlite";
import { PsycheStore } from "../../src/psyche/store.ts";
import { PSYCHE_DEFAULTS } from "../../src/psyche/types.ts";

// Add these tests inside the existing describe block:
test("system prompt includes emotional context when Psyche is configured", async () => {
	const db = new Database(":memory:");
	const psyche = new PsycheStore(db, PSYCHE_DEFAULTS);
	psyche.seedNeutralDefaults();
	psyche.saveSessionMood({
		sessionId: "prev",
		startedMood: "Warm",
		endedMood: "Satisfied",
		arcSummary: "Good productive session.",
	});

	const model = createMockModel({ text: "Hello, Boss." });
	const cortex = new Cortex({
		injectedModel: model,
		psyche,
	});

	await cortex.chat("Hello Friday");

	const call = model.doGenerateCalls[0];
	const systemPrompt = JSON.stringify(call);
	expect(systemPrompt).toContain("Emotional Context");
	expect(systemPrompt).toContain("How We Are");
	expect(systemPrompt).toContain("Trust:");
});

test("system prompt works without Psyche (backward compat)", async () => {
	const model = createMockModel({ text: "Hello, Boss." });
	const cortex = new Cortex({ injectedModel: model });

	await cortex.chat("Hello Friday");

	const call = model.doGenerateCalls[0];
	const systemPrompt = JSON.stringify(call);
	expect(systemPrompt).not.toContain("Emotional Context");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/cortex.test.ts`
Expected: FAIL — `psyche` is not a valid property of CortexConfig

- [ ] **Step 3: Add Psyche to CortexConfig and constructor**

In `src/core/cortex.ts`, add the import at the top (after the existing imports around line 7):

```typescript
import type { PsycheStore } from "../psyche/store.ts";
import { buildEmotionalContext } from "../psyche/context.ts";
```

Add to the `CortexConfig` interface (around line 46, before `debug`):

```typescript
	psyche?: PsycheStore;
```

Add private field to the `Cortex` class (around line 67, after `private pinnedSmarts`):

```typescript
	private psyche?: PsycheStore;
```

In the constructor (around line 94, after `this.genesisPrompt`):

```typescript
		this.psyche = config.psyche;
```

- [ ] **Step 4: Add Psyche section to buildSystemPrompt**

In `src/core/cortex.ts`, in the `buildSystemPrompt()` method, add this block **after the SMARTS enrichment section** (after line 448, before the Sensorium section that starts at line 450):

```typescript
		// Psyche emotional context
		if (this.psyche && this.psyche.hasDimensions()) {
			const emotionalContext = buildEmotionalContext(
				this.psyche.getDimensions(),
				this.psyche.getLastSessionMood(),
				this.psyche.findRelevantMilestones(userMessage),
			);
			if (emotionalContext) {
				prompt = `${prompt}\n\n${emotionalContext}`;
			}
		}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/cortex.test.ts`
Expected: PASS — both new and existing tests green

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `bun test`
Expected: All tests pass, no regressions

- [ ] **Step 7: Commit**

```bash
git add src/core/cortex.ts tests/unit/cortex.test.ts
git commit -m "feat(psyche): integrate emotional context into Cortex system prompt"
```

---

### Task 9: Runtime Wiring — Boot & Shutdown

**Files:**
- Modify: `src/core/runtime.ts` (lines 63-68 types, lines 70-95 private fields, boot ~line 321, shutdown ~line 716)

- [ ] **Step 1: Add Psyche imports to runtime.ts**

At the top of `src/core/runtime.ts`, add after the existing Vox imports (around line 41):

```typescript
import { PsycheStore } from "../psyche/store.ts";
import { PsycheCurator } from "../psyche/curator.ts";
import { createPsycheProtocol } from "../psyche/protocol.ts";
import { PSYCHE_DEFAULTS } from "../psyche/types.ts";
```

- [ ] **Step 2: Add BootStep and ShutdownStep entries**

Update the `BootStep` type (line 63-66) to include `"psyche"`:

```typescript
export type BootStep =
	| "signals" | "memory" | "smarts" | "psyche" | "sensorium"
	| "genesis" | "vox" | "cortex" | "arc-rhythm"
	| "modules" | "ready";
```

Update the `ShutdownStep` type (line 68) to include `"psyche"`:

```typescript
export type ShutdownStep = "arc-rhythm" | "vox" | "sensorium" | "conversation" | "psyche" | "knowledge" | "modules" | "cleanup";
```

- [ ] **Step 3: Add private fields**

Add to the private fields of `FridayRuntime` (around line 82, after `_curator`):

```typescript
	private _psyche?: PsycheStore;
	private _psycheCurator?: PsycheCurator;
```

- [ ] **Step 4: Wire PsycheStore in boot — after SMARTS, before Sensorium**

In the `boot()` method, **after** the SMARTS block (line 321) and **before** the model resolution (line 323), add:

```typescript
			// Psyche — emotional intelligence (after Memory so it can share the database)
			if (this._memory) {
				this._psyche = new PsycheStore(this._memory.database, PSYCHE_DEFAULTS);
				this._psyche.decayMilestones();
				this._protocols.register(createPsycheProtocol(this._psyche));
				onProgress?.("psyche", "Psyche emotional state loaded");
			}
```

- [ ] **Step 5: Pass Psyche to Cortex config**

In the Cortex constructor call (around line 377-395), add `psyche` to the config object, after `smartsStore`:

```typescript
				psyche: this._psyche,
```

- [ ] **Step 6: Wire PsycheCurator after subsystem model creation**

After the subsystem model resolution and SmartsCurator creation (around line 436-439), add:

```typescript
			if (this._psyche) {
				this._psycheCurator = new PsycheCurator(this._psyche, subsystemModel);
				// Bootstrap from history if Psyche has no existing state
				if (!this._psyche.hasDimensions() && this._memory) {
					const recent = await this._memory.getConversationHistory(3);
					const smartsEntries = this._smarts?.all() ?? [];
					const smartsSummary = smartsEntries
						.map((e) => `[${e.domain}] ${e.name}: ${e.content.slice(0, 200)}`)
						.join("\n");
					if (recent.length > 0 || smartsSummary.length > 0) {
						await this._psycheCurator.bootstrapFromHistory(recent, smartsSummary);
						onProgress?.("psyche", "Psyche bootstrapped from conversation history");
					} else {
						this._psyche.seedNeutralDefaults();
					}
				}
			}
```

- [ ] **Step 7: Wire PsycheCurator in shutdown — after conversation save, alongside SmartsCurator**

In the shutdown method, the curator extraction block (around line 723-727), modify to also start Psyche analysis alongside SMARTS extraction:

Replace the curator promise block at lines 723-727 with:

```typescript
			const curatorPromise = this._curator
				? this._curator.extractFromConversation(history).catch((err) => {
						console.warn("Knowledge extraction failed:", err instanceof Error ? err.message : err);
					})
				: undefined;

			const psychePromise = this._psycheCurator && this._sessionId
				? this._psycheCurator.analyzeSession(this._sessionId, history).catch((err) => {
						console.warn("Psyche analysis failed:", err instanceof Error ? err.message : err);
					})
				: undefined;
```

Then in the await block (around lines 750-753), change to await both:

```typescript
			if (psychePromise) {
				onProgress?.("psyche", "Analyzing emotional context...");
				await psychePromise;
			}

			if (curatorPromise) {
				onProgress?.("knowledge", "Extracting knowledge from conversation...");
				await curatorPromise;
			}
```

- [ ] **Step 8: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat(psyche): wire PsycheStore and PsycheCurator into runtime boot/shutdown"
```

---

### Task 10: Vox Integration — Psyche-Aware Emotional Rewrite

**Files:**
- Modify: `src/core/voice/emotion.ts` (line 118 — function signature)
- Modify: `src/core/voice/vox.ts` (line 117-134 — speak method, plus Psyche wiring)
- Modify: `tests/unit/vox-emotion.test.ts`

- [ ] **Step 1: Write test for psyche-aware emotional rewrite**

Add to `tests/unit/vox-emotion.test.ts`:

```typescript
test("includes psyche context in prompt when provided", async () => {
	const mockResponse = JSON.stringify({
		text: "Looking good, Boss.",
		mood: "warm",
		intensity: "moderate",
	});
	const model = createMockModel({ text: mockResponse });
	const psycheContext = "Trust: Deep trust built over months. Banter: High comfort.";

	const result = await emotionalRewrite(
		"The tests passed.",
		["User: How are the tests?"],
		"on",
		model,
		psycheContext,
	);

	expect(result.text).toBe("Looking good, Boss.");
	const callPrompt = JSON.stringify(model.doGenerateCalls[0]);
	expect(callPrompt).toContain("RELATIONAL CONTEXT");
	expect(callPrompt).toContain("Deep trust");
});

test("works without psyche context (backward compat)", async () => {
	const mockResponse = JSON.stringify({
		text: "Tests passed.",
		mood: "neutral",
		intensity: "subtle",
	});
	const model = createMockModel({ text: mockResponse });

	const result = await emotionalRewrite(
		"The tests passed.",
		["User: How are the tests?"],
		"on",
		model,
	);

	expect(result.text).toBe("Tests passed.");
	const callPrompt = JSON.stringify(model.doGenerateCalls[0]);
	expect(callPrompt).not.toContain("RELATIONAL CONTEXT");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: FAIL — extra argument not accepted

- [ ] **Step 3: Update emotionalRewrite signature**

In `src/core/voice/emotion.ts`, update the function signature (line 118) to accept optional psyche context:

```typescript
export async function emotionalRewrite(
	text: string,
	recentMessages: string[],
	mode: "on" | "whisper",
	fastModel: LanguageModelV3,
	psycheContext?: string,
): Promise<EmotionalRewriteResult> {
```

Then update the prompt construction (line 130) to include psyche context when available:

```typescript
		const psycheBlock = psycheContext
			? `\nRELATIONAL CONTEXT:\n${psycheContext}\n`
			: "";

		const prompt = `${EMOTION_REWRITE_PROMPT}\n\n${MODE_GUIDANCE[mode]}\n${psycheBlock}\n${historyBlock}\nTEXT TO REWRITE:\n${text}`;
```

- [ ] **Step 4: Update Vox to pass Psyche context**

In `src/core/voice/vox.ts`, add a private field and setter for psyche store (around line 28, after `_getRecentHistory`):

```typescript
	private _psycheDimensionSummary?: () => string | undefined;
```

Update `setEmotionEngine` (line 49-55) to also accept a psyche dimension getter:

```typescript
	setEmotionEngine(
		fastModel: LanguageModelV3,
		getRecentHistory: () => string[],
		getPsycheDimensions?: () => string | undefined,
	): void {
		this._fastModel = fastModel;
		this._getRecentHistory = getRecentHistory;
		this._psycheDimensionSummary = getPsycheDimensions;
	}
```

In the `speak()` method (around line 123), pass psyche context to `emotionalRewrite`:

```typescript
				const psycheCtx = this._psycheDimensionSummary?.();
				const result = await emotionalRewrite(
					text,
					history,
					activeMode,
					this._fastModel,
					psycheCtx,
				);
```

- [ ] **Step 5: Update runtime wiring to pass psyche dimensions getter**

In `src/core/runtime.ts`, update the Vox emotion engine wiring (around line 441-447) to pass the Psyche dimension getter:

```typescript
			if (this._vox && this._cortex) {
				this._vox.setEmotionEngine(
					subsystemModel,
					() => this._cortex!.getRecentHistory(5),
					this._psyche
						? () => this._psyche!.getDimensionSummary()
						: undefined,
				);
			}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: PASS — all tests green including new ones

- [ ] **Step 7: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/core/voice/emotion.ts src/core/voice/vox.ts src/core/runtime.ts tests/unit/vox-emotion.test.ts
git commit -m "feat(psyche): psyche-aware emotional rewrite for Vox voice"
```

---

### Task 11: Documentation Updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Add Psyche to the **Subsystem Map** table:

```markdown
| **Psyche** | `src/psyche/` | Emotional intelligence. Boot + session-end analysis. Shares Memory's SQLite. 5 relational dimensions (natural language), milestones with FTS5 + relevance decay, session mood tracking. |
```

Update the **Boot order** line to include Psyche:

```
**Boot order:** SignalBus → ClearanceManager → AuditLogger → NotificationManager → ProtocolRegistry → DirectiveStore/Engine → Memory → SmartsStore → **Psyche** → Sensorium → Genesis → Vox → Cortex → Recall Tool → Arc Rhythm → Modules → `session:start`
```

Add to the **Architecture** directory tree under `src/`:

```
├── psyche/
│   ├── types.ts           # RelationalDimension, EmotionalMilestone, SessionMood, PsycheState
│   ├── store.ts           # PsycheStore — SQLite tables, FTS5, CRUD, decay, seeding
│   ├── curator.ts         # PsycheCurator — session-end emotional analysis, bootstrap
│   ├── context.ts         # buildEmotionalContext() — system prompt injection
│   ├── guardrails.ts      # EMOTIONAL_GUARDRAILS constant
│   └── protocol.ts        # /psyche protocol (status, dimensions, milestones, reset)
```

Add to the **Patterns & Gotchas** section:

```markdown
- **Psyche emotional context**: `buildEmotionalContext()` injects `## Emotional Context` into system prompt with dimensions, session mood, FTS5-matched milestones, and guardrails. PsycheCurator runs at session end alongside SmartsCurator. Milestones decay with exponential half-life (30 days, floor 0.1). Smart seeding bootstraps from last 3 conversations + SMARTS on first activation.
```

Update the **MCU concept mapping** line to include Psyche:

```markdown
**MCU concept mapping:** Cortex=brain, Protocol=slash command, Directive=standing order, Module=suit upgrade, Signal=event, Clearance=permission, SMARTS=dynamic knowledge, Sensorium=sensor suite, Deja Vu=recall, Arc Rhythm=heartbeat/scheduler, Genesis=identity template, Vox=voice, Psyche=emotional core
```

- [ ] **Step 2: Update README.md with matching changes**

Apply the same updates to README.md: architecture tree, subsystem map, boot order, MCU mapping.

- [ ] **Step 3: Update GENESIS_TEMPLATE in src/core/prompts.ts**

Add a line to the "How You Operate" section of GENESIS_TEMPLATE (around line 106) so Friday knows she has emotional awareness:

```markdown
- You have emotional intelligence through Psyche — you remember how past sessions felt, carry emotional context forward, and express genuine emotions that come through in your word choice, not as performance. Your relational history with the Boss evolves naturally over time.
```

- [ ] **Step 4: Run lint and format**

Run: `bun run lint:fix && bun run format`
Expected: Clean

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md src/core/prompts.ts
git commit -m "docs: add Psyche to architecture docs, boot order, and GENESIS_TEMPLATE"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: No lint errors

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + ~50 new Psyche tests)

- [ ] **Step 4: Verify Psyche file count**

Run: `ls src/psyche/`
Expected: `context.ts  curator.ts  guardrails.ts  protocol.ts  store.ts  types.ts`

Run: `ls tests/unit/psyche-*`
Expected: `psyche-context.test.ts  psyche-curator.test.ts  psyche-guardrails.test.ts  psyche-protocol.test.ts  psyche-store.test.ts`

- [ ] **Step 5: Verify boot order includes Psyche**

Run: `grep -n "psyche" src/core/runtime.ts`
Expected: Multiple hits — imports, BootStep, ShutdownStep, private fields, boot wiring, shutdown wiring

- [ ] **Step 6: Final commit if any remaining changes**

```bash
git status
# If any unstaged changes remain:
git add -A && git commit -m "chore: final Psyche cleanup"
```
