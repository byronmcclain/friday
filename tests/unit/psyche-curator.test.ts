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

		const trust = store.getDimension("trust");
		expect(trust!.description).toContain("New relationship");
		const mood = store.getLastSessionMood();
		expect(mood!.arcSummary).toBe("Routine session, nothing noteworthy.");
	});

	test("skips analysis when conversation is too short", async () => {
		const model = createMockModel({ text: "[]" });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-4", makeMessages(2));

		expect(model.doGenerateCalls).toHaveLength(0);
	});

	test("handles model errors gracefully", async () => {
		const model = createErrorModel("API timeout");
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-5", makeMessages(6));

		const trust = store.getDimension("trust");
		expect(trust!.description).toContain("New relationship");
	});

	test("handles invalid JSON from model gracefully", async () => {
		const model = createMockModel({ text: "not valid json at all" });
		const curator = new PsycheCurator(store, model);

		await curator.analyzeSession("session-6", makeMessages(6));

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
