# Emotional Voice Adaptation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Friday's voice dynamic emotional range by using the fast model to analyze conversation context, rewrite TTS text with auditory cues, and inject emotional delivery instructions.

**Architecture:** The fast model analyzes the last 3-5 conversation messages inside `Vox.speak()`, rewrites the text with `[whisper]`, `[sigh]`, `[laugh]`, `[pause]` cues and light rephrasing, then `buildTtsPrompt()` injects emotional delivery directions into the Grok Voice API session. A new `"flat"` VoiceMode bypasses emotion for literal TTS.

**Tech Stack:** TypeScript, AI SDK v6 (`generateText`), Grok Voice Agent API (WebSocket), bun:test

---

### Task 1: Add Emotion Types to `types.ts`

**Files:**
- Modify: `src/core/voice/types.ts`
- Test: `tests/unit/vox-types.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/vox-types.test.ts`:

```typescript
import type {
	EmotionMood,
	EmotionIntensity,
	EmotionProfile,
	EmotionalRewriteResult,
} from "../../src/core/voice/types.ts";

describe("emotion types", () => {
	test("EmotionProfile satisfies the type contract", () => {
		const profile: EmotionProfile = { mood: "warm", intensity: "moderate" };
		expect(profile.mood).toBe("warm");
		expect(profile.intensity).toBe("moderate");
	});

	test("EmotionalRewriteResult satisfies the type contract", () => {
		const result: EmotionalRewriteResult = {
			text: "[laugh] Grand stuff, boss.",
			emotion: { mood: "amused", intensity: "subtle" },
		};
		expect(result.text).toContain("[laugh]");
		expect(result.emotion.mood).toBe("amused");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: FAIL — `EmotionMood`, `EmotionIntensity`, `EmotionProfile`, `EmotionalRewriteResult` not found in types.ts

**Step 3: Write minimal implementation**

In `src/core/voice/types.ts`, add after the `VoiceMode` line:

```typescript
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
```

Note: `VoiceMode` is updated from `"off" | "on" | "whisper"` to `"off" | "on" | "whisper" | "flat"`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: PASS

**Step 5: Run full test suite to check for regressions from VoiceMode change**

Run: `bun test`
Expected: All tests pass. The `"flat"` addition to the union shouldn't break existing code since nothing pattern-matches exhaustively on VoiceMode values.

**Step 6: Commit**

```bash
git add src/core/voice/types.ts tests/unit/vox-types.test.ts
git commit -m "feat(voice): add emotion types and flat voice mode"
```

---

### Task 2: Add Emotion Delivery to `prompt.ts`

**Files:**
- Modify: `src/core/voice/prompt.ts`
- Modify: `tests/unit/vox-prompt.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/vox-prompt.test.ts`:

```typescript
import type { EmotionProfile } from "../../src/core/voice/types.ts";

describe("buildTtsPrompt with emotion", () => {
	test("includes EMOTIONAL DELIVERY when emotion provided", () => {
		const emotion: EmotionProfile = { mood: "excited", intensity: "strong" };
		const prompt = buildTtsPrompt("Great news!", "on", emotion);
		expect(prompt).toContain("EMOTIONAL DELIVERY");
		expect(prompt).toContain("genuinely excited");
		expect(prompt).toContain("Don't hold back");
	});

	test("no EMOTIONAL DELIVERY when emotion omitted", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).not.toContain("EMOTIONAL DELIVERY");
	});

	test("warm mood with subtle intensity", () => {
		const emotion: EmotionProfile = { mood: "warm", intensity: "subtle" };
		const prompt = buildTtsPrompt("Nice work.", "on", emotion);
		expect(prompt).toContain("warmth");
		expect(prompt).toContain("understated");
	});

	test("concerned mood with moderate intensity", () => {
		const emotion: EmotionProfile = { mood: "concerned", intensity: "moderate" };
		const prompt = buildTtsPrompt("Tests failed.", "on", emotion);
		expect(prompt).toContain("concern");
		expect(prompt).toContain("naturally");
	});

	test("frustrated mood delivery", () => {
		const emotion: EmotionProfile = { mood: "frustrated", intensity: "strong" };
		const prompt = buildTtsPrompt("Still broken.", "on", emotion);
		expect(prompt).toContain("frustrated");
	});

	test("emotion works with whisper mode", () => {
		const emotion: EmotionProfile = { mood: "amused", intensity: "moderate" };
		const prompt = buildTtsPrompt("Funny.", "whisper", emotion);
		expect(prompt).toContain("whispering");
		expect(prompt).toContain("amused");
	});

	test("emotion works with flat mode (no emotion injected)", () => {
		const prompt = buildTtsPrompt("Data.", "flat");
		expect(prompt).not.toContain("EMOTIONAL DELIVERY");
		expect(prompt).toContain("FRIDAY");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: FAIL — `buildTtsPrompt` doesn't accept 3rd arg, `"flat"` not in `MODE_CONTEXT`

**Step 3: Write minimal implementation**

In `src/core/voice/prompt.ts`:

1. Update imports to include `EmotionProfile`, `EmotionMood`, `EmotionIntensity`:

```typescript
import type { VoiceMode, EmotionProfile, EmotionMood, EmotionIntensity } from "./types.ts";
```

2. Add `"flat"` to `MODE_CONTEXT`:

```typescript
const MODE_CONTEXT: Record<Exclude<VoiceMode, "off">, string> = {
	on: "Speak clearly and naturally at normal pace. You are FRIDAY delivering information to the Boss.",
	whisper:
		"You are whispering. Keep it very brief — two sentences maximum. Only the essential point. Your tone is quiet, intimate, like leaning in to murmur something to the Boss so only he hears. Be concise above all else.",
	flat: "Speak clearly and naturally at normal pace. Read the text faithfully without adding emotional color.",
};
```

3. Add the emotion delivery mappings after `CONTENT_HINTS`:

```typescript
const EMOTION_DELIVERY: Record<EmotionMood, string> = {
	neutral: "Speak in your natural calm, composed tone.",
	warm: "Let warmth come through — you're pleased, your tone is gentle and supportive.",
	excited:
		"You're genuinely excited. Let the energy lift your voice — quicker pace, brighter tone.",
	concerned:
		"There's concern in your voice. Slower, more careful delivery. You care about this.",
	amused: "You're amused. A hint of a smile in your voice — don't suppress it.",
	serious: "This is serious. Drop the wit, deliver with weight and clarity.",
	frustrated:
		"You're a bit frustrated — clipped, direct, with an edge. Not angry, just... done.",
	proud: "You're proud of this. Let quiet satisfaction come through — you're impressed.",
};

const INTENSITY_MODIFIER: Record<EmotionIntensity, string> = {
	subtle: "Keep it understated — the emotion is there but barely perceptible.",
	moderate: "Let the emotion come through naturally, as you would in conversation.",
	strong: "Don't hold back — this is a moment that warrants a real emotional response.",
};
```

4. Update `buildTtsPrompt` signature and body:

```typescript
export function buildTtsPrompt(
	content: string,
	mode: Exclude<VoiceMode, "off">,
	emotion?: EmotionProfile,
): string {
	const parts: string[] = [FRIDAY_VOICE_IDENTITY];

	// Mode context
	parts.push(`\nMODE:\n${MODE_CONTEXT[mode]}`);

	// Emotional delivery (when provided and not flat mode)
	if (emotion && mode !== "flat") {
		parts.push(
			`\nEMOTIONAL DELIVERY:\n${EMOTION_DELIVERY[emotion.mood]}\n${INTENSITY_MODIFIER[emotion.intensity]}`,
		);
	}

	// Content hints
	const hints = classifyContent(content);
	if (hints) {
		parts.push(`\nCONTENT NOTES:\n${hints}`);
	}

	// Reading rules
	parts.push(`\n${READING_RULES}`);

	return parts.join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: All PASS (both new and existing tests)

**Step 5: Commit**

```bash
git add src/core/voice/prompt.ts tests/unit/vox-prompt.test.ts
git commit -m "feat(voice): add emotion delivery to TTS prompt builder"
```

---

### Task 3: Create `emotion.ts` — Emotional Rewrite Module

**Files:**
- Create: `src/core/voice/emotion.ts`
- Create: `tests/unit/vox-emotion.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/vox-emotion.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { emotionalRewrite, EMOTION_REWRITE_PROMPT } from "../../src/core/voice/emotion.ts";
import { createMockModel, createErrorModel } from "../helpers/stubs.ts";
import type { EmotionMood } from "../../src/core/voice/types.ts";

describe("emotionalRewrite", () => {
	test("returns rewritten text and emotion profile from fast model", async () => {
		const mockResponse = JSON.stringify({
			text: "[laugh] Grand stuff, boss — the build went through.",
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

		expect(result.text).toContain("[laugh]");
		expect(result.emotion.mood).toBe("amused");
		expect(result.emotion.intensity).toBe("moderate");
	});

	test("passes mode context to the fast model prompt", async () => {
		const mockResponse = JSON.stringify({
			text: "[whisper] Build passed.",
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

		expect(result.text).toContain("[whisper]");
		// Verify the model was called (doGenerate captured)
		expect(model.doGenerateCalls.length).toBe(1);
		const callPrompt = JSON.stringify(model.doGenerateCalls[0]);
		expect(callPrompt).toContain("whisper");
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

	test("EMOTION_REWRITE_PROMPT is exported and non-empty", () => {
		expect(EMOTION_REWRITE_PROMPT.length).toBeGreaterThan(100);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: FAIL — module `../../src/core/voice/emotion.ts` not found

**Step 3: Write minimal implementation**

Create `src/core/voice/emotion.ts`:

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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-emotion.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/voice/emotion.ts tests/unit/vox-emotion.test.ts
git commit -m "feat(voice): add emotional rewrite module with fast model"
```

---

### Task 4: Add `getRecentHistory()` to Cortex

**Files:**
- Modify: `src/core/cortex.ts:225-230`
- Modify: `tests/unit/vox-cortex.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/vox-cortex.test.ts`:

```typescript
describe("getRecentHistory", () => {
	test("returns last N messages as role-prefixed strings", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel({ text: "response one" }),
		});

		await cortex.chat("Hello");
		await cortex.chat("How are you?");

		const history = cortex.getRecentHistory(4);
		expect(history.length).toBe(4);
		expect(history[0]).toMatch(/^User: Hello$/);
		expect(history[1]).toMatch(/^Assistant: /);
	});

	test("returns all messages when N exceeds history length", async () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});

		await cortex.chat("Hi");
		const history = cortex.getRecentHistory(100);
		expect(history.length).toBe(2); // user + assistant
	});

	test("returns empty array when no history", () => {
		const cortex = new Cortex({
			injectedModel: createMockModel(),
		});

		const history = cortex.getRecentHistory(5);
		expect(history).toEqual([]);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-cortex.test.ts`
Expected: FAIL — `cortex.getRecentHistory is not a function`

**Step 3: Write minimal implementation**

In `src/core/cortex.ts`, add after the existing `getHistory()` method (around line 230):

```typescript
	getRecentHistory(n: number): string[] {
		const messages = this.historyManager.getHistory();
		const recent = messages.slice(-n);
		return recent.map((m) => {
			const role = m.role === "user" ? "User" : "Assistant";
			const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			return `${role}: ${content}`;
		});
	}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-cortex.test.ts`
Expected: All PASS (both new and existing tests)

**Step 5: Commit**

```bash
git add src/core/cortex.ts tests/unit/vox-cortex.test.ts
git commit -m "feat(cortex): add getRecentHistory() for voice emotion context"
```

---

### Task 5: Wire Emotion Engine into Vox

**Files:**
- Modify: `src/core/voice/vox.ts`
- Modify: `tests/unit/vox.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/vox.test.ts`:

```typescript
import { createMockModel } from "../helpers/stubs.ts";

describe("emotion engine", () => {
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
Expected: FAIL — `vox.setEmotionEngine is not a function`, `vox.hasEmotionEngine` undefined

**Step 3: Write minimal implementation**

In `src/core/voice/vox.ts`:

1. Add import for the emotion module and LanguageModelV3:

```typescript
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { emotionalRewrite } from "./emotion.ts";
```

2. Add private fields after `_playerAvailable`:

```typescript
	private _fastModel?: LanguageModelV3;
	private _getRecentHistory?: () => string[];
```

3. Add getter and setter:

```typescript
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
```

4. Update `VoxStatus` interface to include `emotionEngine`:

```typescript
interface VoxStatus {
	mode: VoiceMode;
	connected: boolean;
	voice: GrokVoice;
	apiKeyAvailable: boolean;
	emotionEngine: boolean;
}
```

5. Update `status()` method:

```typescript
	status(): VoxStatus {
		return {
			mode: this._mode,
			connected: this._connected,
			voice: this._config.defaultVoice,
			apiKeyAvailable: this.apiKeyAvailable,
			emotionEngine: this.hasEmotionEngine,
		};
	}
```

6. Update `speak()` — replace the existing prompt building line (line 117) with the emotion-aware version:

Replace this block in `speak()`:
```typescript
		const prompt = buildTtsPrompt(text, this._mode as Exclude<VoiceMode, "off">);
```

With:
```typescript
		let spokenText = text;
		let emotionProfile: import("./types.ts").EmotionProfile | undefined;

		// Emotional rewrite for on/whisper modes when engine is available
		if (
			this._mode !== "flat" &&
			this._fastModel &&
			this._getRecentHistory
		) {
			try {
				const history = this._getRecentHistory();
				const result = await emotionalRewrite(
					text,
					history,
					this._mode as "on" | "whisper",
					this._fastModel,
				);
				spokenText = result.text;
				emotionProfile = result.emotion;
			} catch {
				// Fallback: use original text, no emotion
			}
		}

		const prompt = buildTtsPrompt(
			spokenText,
			this._mode as Exclude<VoiceMode, "off">,
			emotionProfile,
		);
```

7. Also update the text sent to Grok — replace `text` with `spokenText` in the `conversation.item.create` message:

Replace:
```typescript
				content: [{ type: "input_text", text }],
```

With:
```typescript
				content: [{ type: "input_text", text: spokenText }],
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/core/voice/vox.ts tests/unit/vox.test.ts
git commit -m "feat(voice): wire emotion engine into Vox.speak()"
```

---

### Task 6: Update `/voice` Protocol for Flat Mode

**Files:**
- Modify: `src/core/voice/protocol.ts`
- Modify: `tests/unit/vox-protocol.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/vox-protocol.test.ts`:

```typescript
	test("/voice flat switches to flat mode", async () => {
		const result = await protocol.execute({ rawArgs: "flat" }, stubContext);
		expect(result.success).toBe(true);
		expect(vox.mode).toBe("flat");
		expect(result.summary).toContain("Flat");
	});

	test("/voice status includes emotion engine status", async () => {
		const result = await protocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Emotion engine");
	});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: FAIL — `"flat"` not recognized as subcommand, status missing emotion engine

**Step 3: Write minimal implementation**

In `src/core/voice/protocol.ts`:

1. Update the description string:
```typescript
		description: "Control Friday's voice output: on, off, whisper, flat, test, status",
```

2. Add `flat` case in the switch after `whisper`:
```typescript
				case "flat":
					return handleSetMode(vox, "flat");
```

3. Update `handleSetMode` to handle flat:
```typescript
function handleSetMode(vox: Vox, mode: VoiceMode): ProtocolResult {
	vox.setMode(mode);
	const labels: Record<VoiceMode, string> = {
		off: "Voice off.",
		on: "Voice on.",
		whisper: "Whisper mode.",
		flat: "Flat mode — literal TTS, no emotional rewrite.",
	};
	return { success: true, summary: labels[mode] };
}
```

4. Update `handleStatus` to include emotion engine info:
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

5. Update the unknown subcommand message:
```typescript
					summary: `Unknown subcommand: "${subcommand}". Available: on, off, whisper, flat, test, status`,
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/voice/protocol.ts tests/unit/vox-protocol.test.ts
git commit -m "feat(voice): add flat mode to /voice protocol"
```

---

### Task 7: Wire Emotion Engine in Runtime

**Files:**
- Modify: `src/core/runtime.ts:406-413`
- Modify: `tests/unit/vox-runtime.test.ts`

**Step 1: Write the failing test**

Add to the existing describe block in `tests/unit/vox-runtime.test.ts` (which already has `runtime`, `beforeEach`/`afterEach` with `TEST_DATA_DIR` and cleanup):

```typescript
	test("wires emotion engine to Vox when both exist", async () => {
		await runtime.boot({
			injectedModel: createMockModel(),
			injectedFastModel: createMockModel(),
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});

		expect(runtime.vox).toBeDefined();
		expect(runtime.vox!.hasEmotionEngine).toBe(true);
	});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-runtime.test.ts`
Expected: FAIL — `runtime.vox.hasEmotionEngine` is false (not wired yet)

**Step 3: Write minimal implementation**

In `src/core/runtime.ts`, after the `subsystemModel` creation block (after line 413 where `this._summarizer` is assigned), add:

```typescript
			// Wire emotion engine into Vox for dynamic voice
			if (this._vox && this._cortex) {
				this._vox.setEmotionEngine(
					subsystemModel,
					() => this._cortex!.getRecentHistory(5),
				);
			}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-runtime.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/core/runtime.ts tests/unit/vox-runtime.test.ts
git commit -m "feat(runtime): wire emotion engine into Vox at boot"
```

---

### Task 8: Verify Full Integration and Run Lint

**Files:**
- No new files — verification only

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 4: Run tests one more time after lint fixes**

Run: `bun test`
Expected: All tests pass

**Step 5: Final commit if lint changed anything**

```bash
git add -u
git commit -m "chore: lint fixes for emotional voice feature"
```

---

## Summary of Files

| Task | File | Action |
|------|------|--------|
| 1 | `src/core/voice/types.ts` | Add emotion types, update VoiceMode |
| 1 | `tests/unit/vox-types.test.ts` | Add emotion type tests |
| 2 | `src/core/voice/prompt.ts` | Add EMOTION_DELIVERY, flat mode, update buildTtsPrompt |
| 2 | `tests/unit/vox-prompt.test.ts` | Add emotion prompt tests |
| 3 | `src/core/voice/emotion.ts` | **NEW** — emotionalRewrite() with fast model |
| 3 | `tests/unit/vox-emotion.test.ts` | **NEW** — emotion rewrite tests |
| 4 | `src/core/cortex.ts` | Add getRecentHistory() method |
| 4 | `tests/unit/vox-cortex.test.ts` | Add getRecentHistory tests |
| 5 | `src/core/voice/vox.ts` | Add emotion engine, enhance speak() |
| 5 | `tests/unit/vox.test.ts` | Add emotion engine and flat mode tests |
| 6 | `src/core/voice/protocol.ts` | Add flat subcommand, emotion status |
| 6 | `tests/unit/vox-protocol.test.ts` | Add flat mode protocol tests |
| 7 | `src/core/runtime.ts` | Wire emotion engine after boot |
| 7 | `tests/unit/vox-runtime.test.ts` | Add emotion wiring test |
| 8 | (verification only) | typecheck, lint, full test run |
