import type {
	RelationalDimension,
	SessionMood,
	EmotionalMilestone,
} from "./types.ts";
import { DIMENSION_LABELS } from "./types.ts";
import { EMOTIONAL_GUARDRAILS } from "./guardrails.ts";

const MAX_CONTEXT_CHARS = 4000;

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
		(d) => `${DIMENSION_LABELS[d.name as keyof typeof DIMENSION_LABELS] ?? d.name}: ${d.description}`,
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
