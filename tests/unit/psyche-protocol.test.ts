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
