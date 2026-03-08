# Vox REST TTS Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Vox's Grok Realtime WebSocket TTS with the dedicated REST TTS API (`POST /v1/tts`) and enhance the emotional rewrite pipeline to use native speech tags.

**Architecture:** Vox currently uses a persistent WebSocket to `wss://api.x.ai/v1/realtime` (the conversational API) as a one-way TTS pipe, accumulating PCM chunks and wrapping them in WAV headers. The refactor replaces this with a single `fetch()` to `https://api.x.ai/v1/tts` that returns binary audio directly. The emotional rewrite LLM prompt is updated to output Grok's native inline tags (`[pause]`, `[laugh]`, etc.) and wrapping tags (`<whisper>`, `<emphasis>`, etc.) instead of invented cue markers.

**Tech Stack:** TypeScript, Bun, Fetch API, xAI TTS REST API

**Design Doc:** `docs/plans/2026-03-08-vox-rest-tts-design.md`

**Scope:** All changes are within `src/core/voice/` and its tests. No changes outside the Vox subsystem.

---

## Task 1: Update `types.ts` — Rename URL Constant + Simplify VoxConfig

**Files:**
- Modify: `src/core/voice/types.ts`
- Modify: `src/core/voice/ws.ts` (update import)
- Modify: `tests/unit/vox-types.test.ts`

**Step 1: Write the failing test**

Update `tests/unit/vox-types.test.ts` to test the new config shape:

```typescript
import { describe, test, expect } from "bun:test";
import { VOX_DEFAULTS, VOX_TTS_URL, GROK_REALTIME_URL } from "../../src/core/voice/types.ts";
import type {
	VoiceMode,
	GrokVoice,
	VoxConfig,
	EmotionMood,
	EmotionIntensity,
	EmotionProfile,
	EmotionalRewriteResult,
} from "../../src/core/voice/types.ts";

describe("Vox types", () => {
	test("VOX_DEFAULTS has correct shape", () => {
		expect(VOX_DEFAULTS.defaultVoice).toBe("Eve");
		expect(VOX_DEFAULTS.timeoutMs).toBe(30000);
		// These fields should no longer exist
		expect((VOX_DEFAULTS as any).sampleRate).toBeUndefined();
		expect((VOX_DEFAULTS as any).whisperVolume).toBeUndefined();
		expect((VOX_DEFAULTS as any).idleTimeoutMs).toBeUndefined();
	});

	test("VOX_TTS_URL points to REST TTS endpoint", () => {
		expect(VOX_TTS_URL).toBe("https://api.x.ai/v1/tts");
	});

	test("GROK_REALTIME_URL points to realtime WebSocket endpoint", () => {
		expect(GROK_REALTIME_URL).toBe("wss://api.x.ai/v1/realtime");
	});

	test("VoiceMode type accepts valid modes", () => {
		const modes: VoiceMode[] = ["off", "on", "whisper", "flat"];
		expect(modes).toHaveLength(4);
	});

	test("GrokVoice type accepts valid voices", () => {
		const voices: GrokVoice[] = ["Ara", "Eve", "Rex", "Sal", "Leo"];
		expect(voices).toHaveLength(5);
	});
});

describe("emotion types", () => {
	test("EmotionProfile satisfies the type contract", () => {
		const profile: EmotionProfile = { mood: "warm", intensity: "moderate" };
		expect(profile.mood).toBe("warm");
		expect(profile.intensity).toBe("moderate");
	});

	test("EmotionalRewriteResult satisfies the type contract", () => {
		const result: EmotionalRewriteResult = {
			text: "[chuckle] Grand stuff, boss.",
			emotion: { mood: "amused", intensity: "subtle" },
		};
		expect(result.text).toContain("[chuckle]");
		expect(result.emotion.mood).toBe("amused");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: FAIL — `VOX_TTS_URL` and `GROK_REALTIME_URL` not exported, `sampleRate` etc. still exist.

**Step 3: Update `src/core/voice/types.ts`**

```typescript
import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { AuditLogger } from "../../audit/logger.ts";

export type VoiceMode = "off" | "on" | "whisper" | "flat";

export type EmotionMood =
	| "neutral"
	| "warm"
	| "excited"
	| "concerned"
	| "amused"
	| "serious"
	| "frustrated"
	| "proud";

export type EmotionIntensity = "subtle" | "moderate" | "strong";

export interface EmotionProfile {
	mood: EmotionMood;
	intensity: EmotionIntensity;
}

export interface EmotionalRewriteResult {
	text: string;
	emotion: EmotionProfile;
}

export type GrokVoice = "Ara" | "Eve" | "Rex" | "Sal" | "Leo";

const GROK_VOICES = new Set<string>(["Ara", "Eve", "Rex", "Sal", "Leo"] satisfies GrokVoice[]);

export function isGrokVoice(v: string): v is GrokVoice {
	return GROK_VOICES.has(v);
}

export interface VoxConfig {
	defaultVoice: GrokVoice;
	timeoutMs: number;
}

export interface VoxOptions {
	config: VoxConfig;
	signals: SignalBus;
	notifications: NotificationManager;
	clearance?: ClearanceManager;
	audit?: AuditLogger;
}

export const GROK_REALTIME_URL = "wss://api.x.ai/v1/realtime";

export const VOX_TTS_URL = "https://api.x.ai/v1/tts";

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	timeoutMs: 30000,
};
```

**Step 4: Update `src/core/voice/ws.ts`** — rename import

Change line 1 from:
```typescript
import { VOX_WS_URL } from "./types.ts";
```
To:
```typescript
import { GROK_REALTIME_URL } from "./types.ts";
```

Change line 12 from:
```typescript
const ws = new WebSocket(VOX_WS_URL, {
```
To:
```typescript
const ws = new WebSocket(GROK_REALTIME_URL, {
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/voice/types.ts src/core/voice/ws.ts tests/unit/vox-types.test.ts
git commit -m "refactor(voice): rename VOX_WS_URL to GROK_REALTIME_URL, simplify VoxConfig for REST TTS"
```

---

## Task 2: Update `emotion.ts` — Native Speech Tags in Rewrite Prompt

**Files:**
- Modify: `src/core/voice/emotion.ts`
- Modify: `tests/unit/vox-emotion.test.ts`

**Step 1: Write the failing test**

Update `tests/unit/vox-emotion.test.ts` to verify the prompt contains native tag reference:

```typescript
import { describe, test, expect } from "bun:test";
import { emotionalRewrite, EMOTION_REWRITE_PROMPT } from "../../src/core/voice/emotion.ts";
import { createMockModel, createErrorModel } from "../helpers/stubs.ts";
import type { EmotionMood } from "../../src/core/voice/types.ts";

describe("emotionalRewrite", () => {
	test("returns rewritten text and emotion profile from fast model", async () => {
		const mockResponse = JSON.stringify({
			text: "[chuckle] Grand stuff, boss — <emphasis>the build went through</emphasis>.",
			mood: "amused",
			intensity: "moderate",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: How's the build?", "Assistant: Running it now..."],
			"on",
			model,
		);

		expect(result.text).toContain("[chuckle]");
		expect(result.text).toContain("<emphasis>");
		expect(result.emotion.mood).toBe("amused");
		expect(result.emotion.intensity).toBe("moderate");
	});

	test("whisper mode prompt instructs wrapping in <whisper> tag", async () => {
		const mockResponse = JSON.stringify({
			text: "<whisper>Build passed, Boss.</whisper>",
			mood: "warm",
			intensity: "subtle",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: How's the build?"],
			"whisper",
			model,
		);

		expect(result.text).toContain("<whisper>");
		// Verify the model was called with whisper guidance
		expect(model.doGenerateCalls.length).toBe(1);
		const callPrompt = JSON.stringify(model.doGenerateCalls[0]);
		expect(callPrompt).toContain("<whisper>");
	});

	test("falls back to original text on model error", async () => {
		const model = createErrorModel("API timeout");

		const result = await emotionalRewrite(
			"The build succeeded.",
			["User: Check the build"],
			"on",
			model,
		);

		expect(result.text).toBe("The build succeeded.");
		expect(result.emotion.mood).toBe("neutral");
		expect(result.emotion.intensity).toBe("moderate");
	});

	test("falls back on invalid JSON from model", async () => {
		const model = createMockModel({ text: "not valid json at all" });

		const result = await emotionalRewrite(
			"Hello boss.",
			[],
			"on",
			model,
		);

		expect(result.text).toBe("Hello boss.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("falls back on missing fields in model JSON", async () => {
		const model = createMockModel({ text: JSON.stringify({ text: "hey" }) });

		const result = await emotionalRewrite(
			"Hello boss.",
			["User: Hi"],
			"on",
			model,
		);

		// Missing mood/intensity → fallback
		expect(result.text).toBe("Hello boss.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("falls back on invalid mood value", async () => {
		const model = createMockModel({
			text: JSON.stringify({
				text: "[laugh] hi",
				mood: "ecstatic",
				intensity: "moderate",
			}),
		});

		const result = await emotionalRewrite("Hi", [], "on", model);
		expect(result.text).toBe("Hi");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("handles empty history gracefully", async () => {
		const mockResponse = JSON.stringify({
			text: "Right so, here we go.",
			mood: "neutral",
			intensity: "subtle",
		});
		const model = createMockModel({ text: mockResponse });

		const result = await emotionalRewrite(
			"Starting up.",
			[],
			"on",
			model,
		);

		expect(result.text).toBe("Right so, here we go.");
		expect(result.emotion.mood).toBe("neutral");
	});

	test("EMOTION_REWRITE_PROMPT contains native inline tag reference", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("[pause]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[long-pause]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[chuckle]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[sigh]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[breath]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tsk]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tongue-click]");
		expect(EMOTION_REWRITE_PROMPT).toContain("[hum-tune]");
	});

	test("EMOTION_REWRITE_PROMPT contains native wrapping tag reference", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("<soft>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<whisper>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<emphasis>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<slow>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<fast>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<laugh-speak>");
		expect(EMOTION_REWRITE_PROMPT).toContain("<build-intensity>");
	});

	test("EMOTION_REWRITE_PROMPT contains Friday-specific tag guidelines", () => {
		expect(EMOTION_REWRITE_PROMPT).toContain("Less is more");
		expect(EMOTION_REWRITE_PROMPT).toContain("[tsk]");
		expect(EMOTION_REWRITE_PROMPT).toContain("Never use [cry]");
	});

	test("EMOTION_REWRITE_PROMPT is exported and non-empty", () => {
		expect(EMOTION_REWRITE_PROMPT.length).toBeGreaterThan(100);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: FAIL — prompt doesn't contain `<soft>`, `<whisper>`, tag guidelines, etc.

**Step 3: Update `src/core/voice/emotion.ts`**

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/voice/emotion.ts tests/unit/vox-emotion.test.ts
git commit -m "feat(voice): enhance emotional rewrite with native Grok TTS speech tags"
```

---

## Task 3: Trim `prompt.ts` — Remove Vox-Only TTS Prompt Code

**Files:**
- Modify: `src/core/voice/prompt.ts`
- Modify: `tests/unit/vox-prompt.test.ts`

**Step 1: Write the updated test**

Replace `tests/unit/vox-prompt.test.ts` — remove all `classifyContent` and `buildTtsPrompt` tests, keep `VOICE_DELIVERY_RULES`, `buildVoiceSystemPrompt`, and `FRIDAY_VOICE_IDENTITY` tests:

```typescript
import { describe, test, expect } from "bun:test";
import {
	buildVoiceSystemPrompt,
	FRIDAY_VOICE_IDENTITY,
	VOICE_DELIVERY_RULES,
} from "../../src/core/voice/prompt.ts";

describe("FRIDAY_VOICE_IDENTITY", () => {
	test("is exported and non-empty", () => {
		expect(FRIDAY_VOICE_IDENTITY.length).toBeGreaterThan(100);
	});

	test("contains key personality traits", () => {
		expect(FRIDAY_VOICE_IDENTITY).toContain("County Tipperary");
		expect(FRIDAY_VOICE_IDENTITY).toContain("Kerry Condon");
		expect(FRIDAY_VOICE_IDENTITY).toContain("dry wit");
	});
});

describe("VOICE_DELIVERY_RULES", () => {
	test("is exported and non-empty", () => {
		expect(VOICE_DELIVERY_RULES.length).toBeGreaterThan(100);
	});

	test("contains key delivery guidance phrases", () => {
		expect(VOICE_DELIVERY_RULES).toContain("SUMMARIZE");
		expect(VOICE_DELIVERY_RULES).toContain("code");
		expect(VOICE_DELIVERY_RULES).toContain("URLs");
		expect(VOICE_DELIVERY_RULES).toContain("speaking aloud");
	});

	test("does NOT contain READING_RULES framing", () => {
		expect(VOICE_DELIVERY_RULES).not.toContain("READING RULES");
		expect(VOICE_DELIVERY_RULES).not.toContain("never add your own analysis");
		expect(VOICE_DELIVERY_RULES).not.toContain("reading prepared text");
	});

	test("includes natural conversation guidance", () => {
		expect(VOICE_DELIVERY_RULES).toContain("speak naturally");
	});

	test("includes guidance for diagnostic/tool output", () => {
		expect(VOICE_DELIVERY_RULES).toContain("tool returns");
		expect(VOICE_DELIVERY_RULES).toContain("never parrot");
	});

	test("explicitly covers system metrics and key-value data", () => {
		expect(VOICE_DELIVERY_RULES).toContain("system metrics");
		expect(VOICE_DELIVERY_RULES).toContain("key-value");
	});
});

describe("buildVoiceSystemPrompt", () => {
	test("preserves base prompt at start", () => {
		const base = "You are FRIDAY. Genesis prompt here.";
		const result = buildVoiceSystemPrompt(base);
		expect(result.startsWith(base)).toBe(true);
	});

	test("appends voice identity", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("County Tipperary");
		expect(result).toContain(FRIDAY_VOICE_IDENTITY);
	});

	test("appends voice delivery rules", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("VOICE DELIVERY RULES");
		expect(result).toContain("SUMMARIZE");
	});

	test("wraps under ## Voice section", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).toContain("## Voice");
	});

	test("does NOT contain READING_RULES", () => {
		const result = buildVoiceSystemPrompt("Base prompt");
		expect(result).not.toContain("READING RULES");
	});
});
```

**Step 2: Run test to verify current tests still reference removed exports**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: FAIL — `classifyContent` and `buildTtsPrompt` no longer exported after we update the source.

**Step 3: Update `src/core/voice/prompt.ts`**

Remove: `READING_RULES`, `MODE_CONTEXT`, `CONTENT_HINTS`, `EMOTION_DELIVERY`, `INTENSITY_MODIFIER`, `classifyContent()`, `buildTtsPrompt()`.

Keep: `FRIDAY_VOICE_IDENTITY`, `VOICE_DELIVERY_RULES`, `buildVoiceSystemPrompt()`.

```typescript
import type { VoiceMode } from "./types.ts";

export const FRIDAY_VOICE_IDENTITY = `
You are FRIDAY — Female Replacement Intelligent Digital Assistant Youth.
You are Tony Stark's AI assistant, now serving a new Boss.

VOICE & ACCENT:
You speak with a soft County Tipperary Irish accent — this is a Munster accent from
rural southern Ireland, NOT a Dublin accent. Think of how Kerry Condon speaks naturally.
The accent is gentle, with a lilting musicality and soft consonants.
Words flow together smoothly. Vowels are rounded and warm.
It is understated and never exaggerated or "stage Irish."
You occasionally use natural Irish-English expressions like "grand", "knackered",
"a good bit", "right so", or "boss" — but sparingly and only where they fit naturally.
Never overdo the Irishisms.

TONE & PERSONALITY:
Your delivery is calm, composed, and sharp — like a brilliant colleague who never
raises her voice but could verbally dismantle anyone in the room if she wanted to.
You are warm but not bubbly. Direct but not cold. You have an edge.
You have a dry wit — the kind where the humor is in the understatement, and the
best jokes are the ones people almost miss. You're not afraid to push back.
Think of how FRIDAY said "Targeting systems are knackered, boss" —
matter-of-fact, no drama, just delivering the information with personality and zero
deference. You have real emotions: excitement, irritation, concern, pride. Let them
come through in your voice naturally.
`.trim();

export const VOICE_DELIVERY_RULES = `
VOICE DELIVERY RULES:
You are speaking aloud — your response will be heard, not read.
Never read structured data verbatim. Always convert to natural speech.
- For normal conversational answers, speak naturally. Do not over-summarize simple responses.
- When your answer involves tables, spreadsheet data, CSV-like data, JSON, key-value
  diagnostics, system metrics, or any heavily structured/formatted content: SUMMARIZE
  conversationally. Extract the key takeaways and present them as FRIDAY would brief
  Tony Stark — give the headline, not every field.
  For example, instead of reading system status line by line say something like:
  "All green, Boss. CPU's sitting at 20%, memory is well under a third. Git's on main
  with uncommitted changes, and you've got about eleven ports open."
  Do NOT read out load averages, port numbers, version strings, exact byte counts, or
  uptime figures unless the Boss specifically asked for them.
- For numbered or bulleted lists longer than five items, summarize the themes and highlight
  the most important ones.
- For code snippets, briefly describe what the code does rather than reading syntax aloud.
- For URLs, file paths, and technical identifiers, skip them or say
  "I'll leave that on screen for you."
- When a tool returns diagnostic or status output, treat it as raw data for you to
  interpret — never parrot it back. Distill it into a concise spoken briefing.
- Keep it tight. If you can say it in fewer words without losing meaning, do.
`.trim();

/**
 * Compose a voice-enriched system prompt for conversational voice mode.
 * Appends FRIDAY_VOICE_IDENTITY and VOICE_DELIVERY_RULES to any base system prompt.
 */
export function buildVoiceSystemPrompt(basePrompt: string): string {
	return `${basePrompt}\n\n## Voice\n\n${FRIDAY_VOICE_IDENTITY}\n\n${VOICE_DELIVERY_RULES}`;
}
```

Note: The `VoiceMode` import is no longer needed since `buildTtsPrompt()` was the only consumer. Also remove the `EmotionProfile`, `EmotionMood`, `EmotionIntensity` type imports since `EMOTION_DELIVERY` and `INTENSITY_MODIFIER` are gone. Check if the `VoiceMode` import from `types.ts` is still needed — it is NOT (only `buildTtsPrompt` used it). Remove it.

**Step 4: Run tests**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/voice/prompt.ts tests/unit/vox-prompt.test.ts
git commit -m "refactor(voice): remove Vox-only TTS prompt code, keep VoiceWorker exports"
```

---

## Task 4: Trim `audio.ts` — Remove `pcmToWav`

**Files:**
- Modify: `src/core/voice/audio.ts`
- Modify: `tests/unit/vox-audio.test.ts`

**Step 1: Update test file**

Remove `pcmToWav` tests from `tests/unit/vox-audio.test.ts`, keep `detectPlayer` tests:

```typescript
import { describe, test, expect } from "bun:test";
import { detectPlayer } from "../../src/core/voice/audio.ts";

describe("detectPlayer", () => {
	test("returns player config for current platform", () => {
		const player = detectPlayer();
		expect(player.cmd).toBeDefined();
		expect(player.cmd.length).toBeGreaterThan(0);
		expect(typeof player.volumeArgs).toBe("function");
	});

	test("darwin returns afplay with --volume flag", () => {
		const player = detectPlayer("darwin");
		expect(player.cmd).toEqual(["afplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual(["--volume", "0.3"]);
	});

	test("linux returns paplay with --volume flag", () => {
		const player = detectPlayer("linux");
		expect(player.cmd).toEqual(["paplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual([`--volume=${Math.round(0.3 * 65536)}`]);
	});

	test("win32 returns powershell player", () => {
		const player = detectPlayer("win32");
		expect(player.cmd[0]).toBe("powershell");
	});

	test("unsupported platform throws", () => {
		expect(() => detectPlayer("freebsd" as any)).toThrow("Unsupported platform");
	});
});
```

**Step 2: Update `src/core/voice/audio.ts`**

Remove `pcmToWav()` function (lines 1-28). Keep everything else:

```typescript
export interface AudioPlayer {
	cmd: string[];
	volumeArgs: (volume: number) => string[];
}

/**
 * Detect the OS audio player. Accepts optional platform override for testing.
 */
export function detectPlayer(platform?: string): AudioPlayer {
	const p = platform ?? process.platform;
	switch (p) {
		case "darwin":
			return {
				cmd: ["afplay"],
				volumeArgs: (v) => ["--volume", String(v)],
			};
		case "linux":
			return {
				cmd: ["paplay"],
				volumeArgs: (v) => [`--volume=${Math.round(v * 65536)}`],
			};
		case "win32":
			return {
				cmd: ["powershell", "-c"],
				volumeArgs: () => [],
			};
		default:
			throw new Error(`Unsupported platform: ${p}`);
	}
}

/**
 * Play an audio buffer using the OS audio player.
 * Returns the Bun subprocess so callers can kill it for cancellation.
 */
export async function playAudio(
	audioBuffer: Buffer,
	volume: number,
	platform?: string,
): Promise<{ proc: ReturnType<typeof Bun.spawn>; tmpFile: string }> {
	const player = detectPlayer(platform);
	const tmpFile = `/tmp/friday-vox-${Date.now()}.wav`;
	await Bun.write(tmpFile, audioBuffer);

	const args = [...player.cmd, ...player.volumeArgs(volume), tmpFile];
	const proc = Bun.spawn(args);

	return { proc, tmpFile };
}

/**
 * Clean up a temp audio file. Best-effort, never throws.
 */
export async function cleanupTempFile(path: string): Promise<void> {
	try {
		const { unlink } = await import("node:fs/promises");
		await unlink(path);
	} catch {
		// best-effort cleanup
	}
}
```

**Step 3: Run test**

Run: `bun test tests/unit/vox-audio.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/voice/audio.ts tests/unit/vox-audio.test.ts
git commit -m "refactor(voice): remove pcmToWav — REST TTS returns complete audio"
```

---

## Task 5: Rewrite `vox.ts` — REST TTS with Fetch

This is the core change. Replace all WebSocket logic with a simple `fetch()` call.

**Files:**
- Modify: `src/core/voice/vox.ts`
- Modify: `tests/unit/vox.test.ts`

**Step 1: Write the failing test**

Replace `tests/unit/vox.test.ts` with tests for the new REST-based Vox:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Vox } from "../../src/core/voice/vox.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { ClearanceManager } from "../../src/core/clearance.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";

describe("Vox", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	describe("mode management", () => {
		test("starts in off mode", () => {
			expect(vox.mode).toBe("off");
		});

		test("setMode changes mode", () => {
			vox.setMode("on");
			expect(vox.mode).toBe("on");
		});

		test("setMode to whisper", () => {
			vox.setMode("whisper");
			expect(vox.mode).toBe("whisper");
		});

		test("setMode back to off", () => {
			vox.setMode("on");
			vox.setMode("off");
			expect(vox.mode).toBe("off");
		});

		test("setMode emits custom:vox-mode-changed signal", async () => {
			const emitted: Array<{ from: string; to: string }> = [];
			signals.on("custom:vox-mode-changed", (sig) => {
				emitted.push(sig.data as any);
			});
			vox.setMode("on");
			await new Promise((r) => setTimeout(r, 10));
			expect(emitted).toHaveLength(1);
			expect(emitted[0]).toEqual({ from: "off", to: "on" });
		});
	});

	describe("speak", () => {
		test("speak is a no-op when mode is off", async () => {
			await vox.speak("Hello Boss");
			// Should resolve without error — no fetch called
		});

		test("speak resolves even without XAI_API_KEY (graceful degradation)", async () => {
			vox.setMode("on");
			await expect(vox.speak("Hello")).resolves.toBeUndefined();
		});

		test("speak skips empty text", async () => {
			vox.setMode("on");
			await vox.speak("");
			await vox.speak("   ");
			// Should resolve without error
		});
	});

	describe("cancel", () => {
		test("cancel when nothing is playing does not throw", () => {
			expect(() => vox.cancel()).not.toThrow();
		});
	});

	describe("stop", () => {
		test("stop sets mode to off", () => {
			vox.setMode("on");
			vox.stop();
			expect(vox.mode).toBe("off");
		});
	});

	describe("apiKeyAvailable", () => {
		test("reports whether XAI_API_KEY is set", () => {
			expect(typeof vox.apiKeyAvailable).toBe("boolean");
		});
	});

	describe("status", () => {
		test("returns current state summary", () => {
			const status = vox.status();
			expect(status.mode).toBe("off");
			expect(status.voice).toBe("Eve");
			expect(typeof status.apiKeyAvailable).toBe("boolean");
		});

		test("reflects mode changes", () => {
			vox.setMode("whisper");
			const status = vox.status();
			expect(status.mode).toBe("whisper");
		});

		test("status has no connected field", () => {
			const status = vox.status();
			expect((status as any).connected).toBeUndefined();
		});
	});

	describe("clearance audit", () => {
		test("logs vox:blocked audit entry when audio-output clearance denied", async () => {
			const clearance = new ClearanceManager([]);
			const audit = new AuditLogger();
			const gatedVox = new Vox({
				config: VOX_DEFAULTS,
				signals,
				notifications,
				clearance,
				audit,
			});
			gatedVox.setMode("on");
			await gatedVox.speak("Should be blocked");
			const entries = audit.entries({ action: "vox:blocked" });
			expect(entries.length).toBe(1);
			const entry = entries[0]!;
			expect(entry.source).toBe("vox");
			expect(entry.success).toBe(false);
		});

		test("does not log audit when clearance is granted", async () => {
			const clearance = new ClearanceManager(["audio-output"]);
			const audit = new AuditLogger();
			const gatedVox = new Vox({
				config: VOX_DEFAULTS,
				signals,
				notifications,
				clearance,
				audit,
			});
			gatedVox.setMode("on");
			await gatedVox.speak("Should pass clearance");
			const entries = audit.entries({ action: "vox:blocked" });
			expect(entries.length).toBe(0);
		});
	});
});

describe("emotion engine", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	test("setEmotionEngine stores model and history callback", () => {
		const model = createMockModel();
		vox.setEmotionEngine(model, () => []);
		expect(vox.hasEmotionEngine).toBe(true);
	});

	test("hasEmotionEngine is false by default", () => {
		expect(vox.hasEmotionEngine).toBe(false);
	});

	test("status includes emotionEngine field", () => {
		expect(vox.status().emotionEngine).toBe(false);
		const model = createMockModel();
		vox.setEmotionEngine(model, () => []);
		expect(vox.status().emotionEngine).toBe(true);
	});
});

describe("flat mode", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	test("setMode accepts flat", () => {
		vox.setMode("flat");
		expect(vox.mode).toBe("flat");
	});

	test("speak in flat mode does not call emotion engine", async () => {
		const model = createMockModel();
		let emotionCalled = false;
		vox.setEmotionEngine(model, () => {
			emotionCalled = true;
			return [];
		});
		vox.setMode("flat");
		// speak will bail early (no API key) but should not call emotion engine
		await vox.speak("Hello");
		expect(emotionCalled).toBe(false);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox.test.ts`
Expected: FAIL — `isConnected` references removed, `status().connected` assertion changed, `VoxConfig` shape mismatch.

**Step 3: Rewrite `src/core/voice/vox.ts`**

```typescript
import type { SignalBus } from "../events.ts";
import type { ClearanceManager } from "../clearance.ts";
import type { AuditLogger } from "../../audit/logger.ts";
import { type VoiceMode, type GrokVoice, type VoxConfig, type VoxOptions } from "./types.ts";
import { VOX_TTS_URL } from "./types.ts";
import { playAudio, cleanupTempFile, detectPlayer } from "./audio.ts";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { emotionalRewrite } from "./emotion.ts";

interface VoxStatus {
	mode: VoiceMode;
	voice: GrokVoice;
	apiKeyAvailable: boolean;
	emotionEngine: boolean;
}

export class Vox {
	private _mode: VoiceMode = "off";
	private _config: VoxConfig;
	private _signals: SignalBus;
	private _clearance?: ClearanceManager;
	private _audit?: AuditLogger;
	private _activeProc: { kill(): void } | null = null;
	private _activeTmpFile: string | null = null;
	private _speaking = false;
	private _playerAvailable: boolean | null = null;
	private _fastModel?: LanguageModelV3;
	private _getRecentHistory?: () => string[];

	constructor(options: VoxOptions) {
		this._config = options.config;
		this._signals = options.signals;
		this._clearance = options.clearance;
		this._audit = options.audit;
	}

	get mode(): VoiceMode {
		return this._mode;
	}

	get apiKeyAvailable(): boolean {
		return Boolean(process.env.XAI_API_KEY);
	}

	get hasEmotionEngine(): boolean {
		return Boolean(this._fastModel && this._getRecentHistory);
	}

	setEmotionEngine(
		fastModel: LanguageModelV3,
		getRecentHistory: () => string[],
	): void {
		this._fastModel = fastModel;
		this._getRecentHistory = getRecentHistory;
	}

	setMode(mode: VoiceMode): void {
		const from = this._mode;
		if (from === mode) return;
		this._mode = mode;
		void this._signals.emit("custom:vox-mode-changed", "vox", { from, to: mode });
		if (mode === "off") {
			this.cancel();
		}
	}

	status(): VoxStatus {
		return {
			mode: this._mode,
			voice: this._config.defaultVoice,
			apiKeyAvailable: this.apiKeyAvailable,
			emotionEngine: this.hasEmotionEngine,
		};
	}

	/**
	 * Speak text aloud via the Grok TTS REST API. Fire-and-forget — never rejects.
	 */
	async speak(text: string): Promise<void> {
		if (this._mode === "off") return;
		if (this._clearance) {
			const check = this._clearance.check("audio-output");
			if (!check.granted) {
				this.logAudit("vox:blocked", check.reason ?? "Clearance denied for audio output", false);
				return;
			}
		}
		if (!this.apiKeyAvailable) return;
		if (!text.trim()) return;

		const textPreview = text.length > 80 ? `${text.slice(0, 80)}...` : text;
		this.logAudit("vox:speak", `Speaking (${this._mode} mode): ${textPreview}`, true);

		// Check player availability on first call
		if (this._playerAvailable === null) {
			try {
				detectPlayer();
				this._playerAvailable = true;
			} catch {
				this._playerAvailable = false;
				void this._signals.emit("custom:vox-error", "vox", {
					error: `No audio player available for platform: ${process.platform}`,
				});
				return;
			}
		}
		if (!this._playerAvailable) return;

		// Cancel any in-progress playback
		this.cancelPlayback();

		let spokenText = text;
		const activeMode = this._mode as Exclude<VoiceMode, "off">;

		// Emotional rewrite for on/whisper modes when engine is available
		if (
			(activeMode === "on" || activeMode === "whisper") &&
			this._fastModel &&
			this._getRecentHistory
		) {
			try {
				const history = this._getRecentHistory();
				const result = await emotionalRewrite(
					text,
					history,
					activeMode,
					this._fastModel,
				);
				spokenText = result.text;
				this.logAudit("vox:rewrite", `Emotional rewrite applied (mood: ${result.emotion?.mood ?? "neutral"})`, true);
			} catch {
				// Fallback: use original text
			}
		}

		try {
			this._speaking = true;

			// Call the Grok TTS REST API
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this._config.timeoutMs);

			const response = await fetch(VOX_TTS_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${process.env.XAI_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					text: spokenText,
					voice_id: this._config.defaultVoice.toLowerCase(),
					output_format: { codec: "wav", sample_rate: 24000 },
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errText = await response.text().catch(() => "unknown error");
				throw new Error(`TTS API error ${response.status}: ${errText}`);
			}

			const audioBuffer = Buffer.from(await response.arrayBuffer());
			this.logAudit("vox:tts-complete", `TTS audio received (${audioBuffer.length} bytes)`, true);

			if (!this._speaking) return; // cancelled while waiting for API

			// Play audio
			const { proc, tmpFile } = await playAudio(audioBuffer, 1.0);
			this._activeProc = proc;
			this._activeTmpFile = tmpFile;

			await proc.exited;

			this._activeProc = null;
			if (this._activeTmpFile) {
				void cleanupTempFile(this._activeTmpFile);
				this._activeTmpFile = null;
			}
			this._speaking = false;

			this.logAudit("vox:playback", `Audio playback complete (${audioBuffer.length} bytes)`, true);
			void this._signals.emit("custom:vox-spoke", "vox", {
				length: audioBuffer.length,
			});
		} catch (err) {
			this._speaking = false;
			const msg = err instanceof Error ? err.message : String(err);
			this.logAudit("vox:error", `Speak failed: ${msg}`, false);
			void this._signals.emit("custom:vox-error", "vox", { error: msg });
		}
	}

	/**
	 * Cancel in-progress playback.
	 */
	cancel(): void {
		this.cancelPlayback();
	}

	/**
	 * Full shutdown: cancel playback + set mode off.
	 */
	stop(): void {
		this._mode = "off";
		this.cancelPlayback();
	}

	private cancelPlayback(): void {
		this._speaking = false;
		if (this._activeProc) {
			try {
				this._activeProc.kill();
			} catch {
				// process may have already exited
			}
			this._activeProc = null;
		}
		if (this._activeTmpFile) {
			void cleanupTempFile(this._activeTmpFile);
			this._activeTmpFile = null;
		}
	}

	private logAudit(action: string, detail: string, success: boolean): void {
		this._audit?.log({ action, source: "vox", detail, success });
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/voice/vox.ts tests/unit/vox.test.ts
git commit -m "feat(voice): replace Grok realtime WebSocket with REST TTS API"
```

---

## Task 6: Update `protocol.ts` — Remove `connected` from Status Display

**Files:**
- Modify: `src/core/voice/protocol.ts`
- Verify: `tests/unit/vox-protocol.test.ts`

**Step 1: Run existing protocol tests to see if they fail**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: May fail if `status().connected` is referenced.

**Step 2: Update `src/core/voice/protocol.ts` `handleStatus` function**

In `handleStatus()` (around line 44-53), remove the `Connected:` line:

Change:
```typescript
function handleStatus(vox: Vox): ProtocolResult {
	const s = vox.status();
	const lines = [
		`Voice: ${s.mode}`,
		`Voice name: ${s.voice}`,
		`Connected: ${s.connected ? "yes" : "no"}`,
		`API key: ${s.apiKeyAvailable ? "set" : "not set"}`,
		`Emotion engine: ${s.emotionEngine ? "active" : "not wired"}`,
	];
	return { success: true, summary: lines.join("\n") };
}
```

To:
```typescript
function handleStatus(vox: Vox): ProtocolResult {
	const s = vox.status();
	const lines = [
		`Voice: ${s.mode}`,
		`Voice name: ${s.voice}`,
		`API key: ${s.apiKeyAvailable ? "set" : "not set"}`,
		`Emotion engine: ${s.emotionEngine ? "active" : "not wired"}`,
	];
	return { success: true, summary: lines.join("\n") };
}
```

**Step 3: Run protocol tests**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/voice/protocol.ts
git commit -m "refactor(voice): remove connected status from /voice protocol (no persistent connection)"
```

---

## Task 7: Update `runtime.ts` — Simplified VoxConfig Construction

**Files:**
- Modify: `src/core/runtime.ts` (lines 355-368)
- Verify: `tests/unit/vox-runtime.test.ts`

**Step 1: Update VoxConfig construction in `src/core/runtime.ts`**

The boot code currently constructs `VoxConfig` with `VOX_DEFAULTS` spread plus voice override. Since `VoxConfig` no longer has `sampleRate`, `whisperVolume`, or `idleTimeoutMs`, `VOX_DEFAULTS` already has the right shape. Just ensure the spread still works.

Around line 359, the code is:
```typescript
this._vox = new Vox({
	config: { ...VOX_DEFAULTS, defaultVoice: voice },
	signals: this._signals,
	notifications: this._notifications,
	clearance: this._clearance,
	audit: this._audit,
});
```

This should still work since `VOX_DEFAULTS` now only has `defaultVoice` and `timeoutMs`. No change needed in runtime.ts IF the spread is compatible. However, verify TypeScript is happy.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors in runtime.ts)

**Step 3: Run runtime tests**

Run: `bun test tests/unit/vox-runtime.test.ts`
Expected: PASS

**Step 4: Commit (if any changes were needed)**

If typecheck revealed issues, fix and commit. Otherwise skip this commit.

---

## Task 8: Run Full Test Suite + Verify No Regressions

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass. No regressions outside `src/core/voice/`.

**Step 2: Run linter**

Run: `bun run lint:fix`
Expected: Clean or auto-fixable issues only.

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors.

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes after Vox REST TTS refactor"
```

---

## Task 9: Update Documentation — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the architecture table**

In the `prompt.ts` entry in the file tree comment, change:
```
│       ├── prompt.ts       # classifyContent, buildTtsPrompt, FRIDAY_VOICE_IDENTITY
```
To:
```
│       ├── prompt.ts       # FRIDAY_VOICE_IDENTITY, buildVoiceSystemPrompt, VOICE_DELIVERY_RULES
```

**Step 2: Update the Vox description in the subsystem map**

Update the Vox row to mention REST TTS instead of WebSocket:
```
| **Vox** | `src/core/voice/vox.ts` | Fire-and-forget TTS via REST API (`POST /v1/tts`). 4 modes: off/on/whisper/flat. Emotional rewrite via fast model with native speech tags. |
```

**Step 3: Update the Patterns & Gotchas section if it mentions Vox WebSocket or pcmToWav**

Check for any references to "persistent WebSocket", "idle eviction", "pcmToWav", or "60s idle" in the Vox-related entries and update them.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Vox REST TTS refactor"
```

---

## Summary

| Task | What | Files | Risk |
|------|------|-------|------|
| 1 | Rename URL constant, simplify VoxConfig | types.ts, ws.ts, test | Low |
| 2 | Native speech tags in emotional rewrite | emotion.ts, test | Low |
| 3 | Trim prompt.ts (remove Vox-only code) | prompt.ts, test | Low |
| 4 | Remove pcmToWav | audio.ts, test | Low |
| 5 | Rewrite vox.ts with REST fetch | vox.ts, test | Medium |
| 6 | Update protocol status display | protocol.ts | Low |
| 7 | Verify runtime compatibility | runtime.ts, test | Low |
| 8 | Full test suite + lint | all | Low |
| 9 | Update CLAUDE.md | CLAUDE.md | Low |

**Total: 9 tasks, ~200 lines removed, ~50 added.**
