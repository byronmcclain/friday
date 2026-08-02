// tests/unit/psyche-store.test.ts

import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { PsycheStore } from "../../src/psyche/store.ts";
import { NEUTRAL_SEED_DIMENSIONS, PSYCHE_DEFAULTS } from "../../src/psyche/types.ts";

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
			expect(milestones[0]!.summary).toBe("Shipped the Forge after a 3-day grind.");
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
			const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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
			const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
			db.query(
				"INSERT INTO psyche_milestones (id, occurred_at, summary, emotional_type, relevance_decay) VALUES (?, ?, ?, ?, 1.0)",
			).run("ancient-1", veryOldDate, "Ancient milestone", "warmth");
			store.decayMilestones();
			const row = db
				.query<{ relevance_decay: number }, [string]>(
					"SELECT relevance_decay FROM psyche_milestones WHERE id = ?",
				)
				.get("ancient-1");
			expect(row!.relevance_decay).toBeGreaterThanOrEqual(PSYCHE_DEFAULTS.decayFloor);
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
});
