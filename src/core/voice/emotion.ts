import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import type {
	EmotionMood,
	EmotionIntensity,
	EmotionalRewriteResult,
} from "./types.ts";
import { FRIDAY_VOICE_IDENTITY } from "./prompt.ts";
import { withTimeout } from "../../utils/timeout.ts";

const VALID_MOODS: ReadonlySet<string> = new Set<EmotionMood>([
	"neutral",
	"warm",
	"excited",
	"concerned",
	"amused",
	"serious",
	"frustrated",
	"proud",
]);

const VALID_INTENSITIES: ReadonlySet<string> = new Set<EmotionIntensity>([
	"subtle",
	"moderate",
	"strong",
]);

const FALLBACK: EmotionalRewriteResult["emotion"] = {
	mood: "neutral",
	intensity: "moderate",
};

const MODE_GUIDANCE: Record<"on" | "whisper", string> = {
	on: `MODE: Normal voice.
Use any appropriate auditory cues: [laugh], [sigh], [pause], [whisper].
Light rephrasing for natural spoken delivery is encouraged.
No length constraint.`,
	whisper: `MODE: Whisper.
Friday is whispering — keep the rewrite to 1-2 sentences maximum.
Inject [whisper] cues. Strip everything non-essential.
You may still use [sigh] or a quiet [laugh] where appropriate.`,
};

export const EMOTION_REWRITE_PROMPT = `You are rewriting text for FRIDAY's voice output.

${FRIDAY_VOICE_IDENTITY}

TASK:
You will receive:
1. Recent conversation messages (for emotional context)
2. The text FRIDAY is about to speak
3. The current voice mode

Analyze the emotional context of the conversation and rewrite the text:
- Inject auditory cues ([whisper], [sigh], [laugh], [pause]) where they fit naturally
- Lightly rephrase for natural spoken delivery (Friday's voice, not robotic reading)
- Do NOT change the meaning or add information not in the original
- Do NOT over-dramatize — Friday is understated, the humor is dry, the emotion is real but controlled

Return ONLY valid JSON with this exact shape:
{
  "text": "the rewritten text with auditory cues",
  "mood": "one of: neutral, warm, excited, concerned, amused, serious, frustrated, proud",
  "intensity": "one of: subtle, moderate, strong"
}

No markdown fences, no explanation — just the JSON object.`;

export async function emotionalRewrite(
	text: string,
	recentMessages: string[],
	mode: "on" | "whisper",
	fastModel: LanguageModelV3,
): Promise<EmotionalRewriteResult> {
	try {
		const historyBlock =
			recentMessages.length > 0
				? `RECENT CONVERSATION:\n${recentMessages.join("\n")}\n`
				: "RECENT CONVERSATION:\n(no prior messages)\n";

		const prompt = `${EMOTION_REWRITE_PROMPT}\n\n${MODE_GUIDANCE[mode]}\n\n${historyBlock}\nTEXT TO REWRITE:\n${text}`;

		const result = await withTimeout(
			generateText({
				model: fastModel,
				prompt,
				maxOutputTokens: 512,
			}),
			10_000,
			"emotional rewrite",
		);

		const parsed = JSON.parse(result.text.trim());

		if (
			typeof parsed.text !== "string" ||
			!VALID_MOODS.has(parsed.mood) ||
			!VALID_INTENSITIES.has(parsed.intensity)
		) {
			return { text, emotion: FALLBACK };
		}

		return {
			text: parsed.text,
			emotion: {
				mood: parsed.mood as EmotionMood,
				intensity: parsed.intensity as EmotionIntensity,
			},
		};
	} catch {
		return { text, emotion: FALLBACK };
	}
}
