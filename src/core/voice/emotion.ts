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

const NATIVE_TAGS_REFERENCE = `
AVAILABLE SPEECH TAGS — these are rendered natively by the TTS engine.

INLINE TAGS (insert at specific points to produce sounds):
  [pause]        — brief pause
  [long-pause]   — extended pause
  [laugh]        — laughter
  [chuckle]      — soft laughter
  [giggle]       — light laughter
  [cry]          — crying sound
  [sigh]         — sighing
  [breath]       — breath sound
  [inhale]       — inhalation
  [exhale]       — exhalation
  [tsk]          — disapproving tsk
  [tongue-click] — tongue click
  [lip-smack]    — lip smacking
  [hum-tune]     — humming vocalization

WRAPPING TAGS (wrap text to modify delivery style):
  <soft>text</soft>                       — reduced volume
  <whisper>text</whisper>                 — whispered delivery
  <loud>text</loud>                       — increased volume
  <emphasis>text</emphasis>               — emphasized word/phrase
  <slow>text</slow>                       — slower delivery
  <fast>text</fast>                       — faster delivery
  <higher-pitch>text</higher-pitch>       — raised pitch
  <lower-pitch>text</lower-pitch>         — lowered pitch
  <build-intensity>text</build-intensity> — crescendo effect
  <decrease-intensity>text</decrease-intensity> — diminuendo
  <laugh-speak>text</laugh-speak>         — speaking while laughing
  <sing-song>text</sing-song>             — melodic delivery

Tags can be nested: <slow><soft>Sleep well, Boss.</soft></slow>`;

const TAG_GUIDELINES = `
TAG USAGE GUIDELINES:
- Less is more. A few well-placed tags beat tagging every sentence.
- Friday is understated — prefer [chuckle] over [laugh], <soft> over <loud>.
- Use [pause] for dramatic timing and dry wit beats.
- Use <emphasis> sparingly — only for words Friday would genuinely stress.
- [tsk] and [sigh] suit Friday's personality — exasperation without drama.
- Reserve <build-intensity> for moments of real significance.
- Never use [cry] or [giggle] — they don't fit Friday's character.
- For amused delivery, prefer <laugh-speak> over inserting [laugh] mid-sentence.`;

const MODE_GUIDANCE: Record<"on" | "whisper", string> = {
	on: `MODE: Normal voice.
Use the full palette of speech tags where they fit naturally.
Light rephrasing for natural spoken delivery is encouraged.
No length constraint.`,
	whisper: `MODE: Whisper.
Wrap the entire output in <whisper>...</whisper>.
Keep it to 1-2 sentences maximum. Only the essential point.
Inside the whisper, you may still use [pause], [breath], or <soft>.
Strip everything non-essential.`,
};

export const EMOTION_REWRITE_PROMPT = `You are rewriting text for FRIDAY's voice output.

${FRIDAY_VOICE_IDENTITY}
${NATIVE_TAGS_REFERENCE}
${TAG_GUIDELINES}

TASK:
You will receive:
1. Recent conversation messages (for emotional context)
2. The text FRIDAY is about to speak
3. The current voice mode

Analyze the emotional context of the conversation and rewrite the text:
- Use native speech tags (inline and wrapping) to add expressiveness
- Lightly rephrase for natural spoken delivery (Friday's voice, not robotic reading)
- Do NOT change the meaning or add information not in the original
- Do NOT over-dramatize — Friday is understated, the humor is dry, the emotion is real but controlled

Return ONLY valid JSON with this exact shape:
{
  "text": "the rewritten text with speech tags",
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
