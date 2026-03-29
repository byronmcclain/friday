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
		expect(result!.length).toBeLessThan(5000);
	});
});
