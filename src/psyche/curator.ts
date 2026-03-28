import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { type ConversationMessage, getTextContent } from "../core/types.ts";
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
					const content = c.messages
						.slice(0, 20)
						.map((m) => `${m.role}: ${getTextContent(m.content)}`)
						.join("\n");
					return `Session ${i + 1}:\n${content}`;
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
		for (const update of result.dimension_updates) {
			if (VALID_DIMENSION_NAMES.has(update.name) && update.new_description) {
				this.store.setDimension(update.name, update.new_description);
			}
		}

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

		if (result.session_mood) {
			this.store.saveSessionMood({
				sessionId,
				startedMood: result.session_mood.started,
				endedMood: result.session_mood.ended,
				arcSummary: result.session_mood.arc,
			});
		}

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
				milestones: Array.isArray(parsed.milestones) ? parsed.milestones : [],
				dimension_updates: Array.isArray(parsed.dimension_updates)
					? parsed.dimension_updates
					: [],
			};
		} catch {
			return undefined;
		}
	}
}
