# Emotional Voice Adaptation Design

**Date:** 2026-03-01
**Status:** Approved
**Subsystem:** Vox (voice output)

## Problem

Friday's voice is emotionally flat. The TTS system prompt (`buildTtsPrompt()`) classifies *content type* (tables, code, URLs) but never considers the *emotional texture* of the conversation. Whether the user just got devastating news or achieved something amazing, Friday speaks in the same calm delivery.

The Grok Voice Agent API supports paralinguistic cues (`[whisper]`, `[sigh]`, `[laugh]`, `[pause]`) and responds to emotional delivery instructions in the session prompt. These capabilities are unused.

## Solution

Add a **two-layer emotional injection system** powered by the fast model:

1. **Layer 1: Dynamic TTS instructions** — Emotional delivery directions injected into the `session.update` instructions (e.g., "speak with warm concern", "let excitement lift your voice")
2. **Layer 2: Inline auditory cues** — The fast model rewrites the text itself with markers like `[sigh]`, `[laugh]`, `[whisper]` and light rephrasing for natural spoken delivery

The fast model analyzes the last 3-5 conversation messages to detect the emotional context, then produces both the rewritten text and an emotion profile in a single call.

## Architecture

### Data Flow

```
Cortex.chatStream():
  response = streamText()
  vox.speak(text)                    // unchanged API

Vox.speak(text):
  if mode === "flat":
    → buildTtsPrompt(text, mode)     // static, no emotion (current behavior)
  if mode === "on" or "whisper":
    history = getRecentHistory()     // callback, last 3-5 messages
    { text, emotion } = emotionalRewrite(text, history, mode, fastModel)
    → buildTtsPrompt(text, mode, emotion)  // enhanced with emotional delivery
  → send to Grok WebSocket
```

### Boot Wiring (Late Binding)

Vox is created before Cortex in the boot sequence (Cortex needs a vox reference). The fast model and history callback are wired in *after* both exist:

```
Boot:
  1. Vox created (no emotion engine yet)
  2. Cortex created (with vox ref)
  3. subsystemModel created
  4. vox.setEmotionEngine(subsystemModel, () => cortex.getRecentHistory(5))
```

This follows the existing pattern of late-wiring subsystem dependencies.

## Types

### New Types (`src/core/voice/types.ts`)

```typescript
export type EmotionMood =
  | "neutral" | "warm" | "excited" | "concerned"
  | "amused" | "serious" | "frustrated" | "proud";

export type EmotionIntensity = "subtle" | "moderate" | "strong";

export interface EmotionProfile {
  mood: EmotionMood;
  intensity: EmotionIntensity;
}

export interface EmotionalRewriteResult {
  text: string;           // rewritten text with auditory cues
  emotion: EmotionProfile;
}
```

### Updated VoiceMode

```typescript
export type VoiceMode = "off" | "on" | "whisper" | "flat";
```

- `off` — no voice output
- `on` — full emotional voice (emotional rewrite + dynamic TTS prompt)
- `whisper` — emotional rewrite (with whisper-aware constraints) + whispered TTS delivery
- `flat` — literal TTS without emotional rewrite (debugging, precision)

## New File: `src/core/voice/emotion.ts`

The emotional rewrite module:

```typescript
export async function emotionalRewrite(
  text: string,
  recentMessages: string[],
  mode: "on" | "whisper",
  fastModel: LanguageModelV3,
): Promise<EmotionalRewriteResult>
```

### Fast Model Prompt

The fast model receives:
1. FRIDAY's voice identity (so rewrites are in character)
2. The last 3-5 messages (user + assistant interleaved) for emotional context
3. The current text to speak
4. The current voice mode (on vs whisper)
5. Instructions to analyze mood, inject auditory cues, and lightly rephrase

Mode-specific guidance:
- **on mode:** Use any appropriate cues (`[laugh]`, `[sigh]`, `[pause]`, `[whisper]`). Light rephrasing for natural spoken delivery. No length constraint.
- **whisper mode:** Inject `[whisper]` cues. Keep rewrite to 1-2 sentences max. Strip everything non-essential. Can still use `[sigh]` or quiet `[laugh]` where appropriate.

### Output Format

The fast model returns JSON:
```json
{
  "text": "[laugh] Right, the deployment went through — smooth as you like, boss.",
  "mood": "amused",
  "intensity": "moderate"
}
```

### Fallback

If the fast model call fails (timeout, error, etc.), Vox falls back to the current behavior — static TTS prompt with the original unmodified text. Voice should never block on emotion analysis failures.

## Enhanced `prompt.ts`

### Emotion Delivery Mapping

```typescript
const EMOTION_DELIVERY: Record<EmotionMood, string> = {
  neutral: "Speak in your natural calm, composed tone.",
  warm: "Let warmth come through — you're pleased, your tone is gentle and supportive.",
  excited: "You're genuinely excited. Let the energy lift your voice — quicker pace, brighter tone.",
  concerned: "There's concern in your voice. Slower, more careful delivery. You care about this.",
  amused: "You're amused. A hint of a smile in your voice — don't suppress it.",
  serious: "This is serious. Drop the wit, deliver with weight and clarity.",
  frustrated: "You're a bit frustrated — clipped, direct, with an edge. Not angry, just... done.",
  proud: "You're proud of this. Let quiet satisfaction come through — you're impressed.",
};

const INTENSITY_MODIFIER: Record<EmotionIntensity, string> = {
  subtle: "Keep it understated — the emotion is there but barely perceptible.",
  moderate: "Let the emotion come through naturally, as you would in conversation.",
  strong: "Don't hold back — this is a moment that warrants a real emotional response.",
};
```

### Updated `buildTtsPrompt()`

```typescript
export function buildTtsPrompt(
  content: string,
  mode: Exclude<VoiceMode, "off">,
  emotion?: EmotionProfile,
): string
```

When `emotion` is provided, the prompt includes:
```
EMOTIONAL DELIVERY:
[EMOTION_DELIVERY[mood]]
[INTENSITY_MODIFIER[intensity]]
```

This is inserted between MODE and CONTENT NOTES sections.

## Vox Changes

### New Fields

```typescript
private _fastModel?: LanguageModelV3;
private _getRecentHistory?: () => string[];
```

### New Method

```typescript
setEmotionEngine(
  fastModel: LanguageModelV3,
  getRecentHistory: () => string[],
): void
```

Called after boot wiring completes.

### speak() Enhancement

The `speak()` method gains an emotional rewrite step between receiving text and sending to the Grok WebSocket:

1. If mode is `"flat"` → skip emotional rewrite, use static prompt
2. If emotion engine is not wired → skip emotional rewrite, use static prompt (graceful fallback)
3. If mode is `"on"` or `"whisper"` and emotion engine is available:
   a. Call `emotionalRewrite(text, getRecentHistory(), mode, fastModel)`
   b. Use rewritten text and emotion profile in `buildTtsPrompt()`
   c. On error → fall back to static prompt with original text

### Cortex Addition

Add a public method:

```typescript
getRecentHistory(n: number): string[]
```

Returns the last N messages from `HistoryManager` as plain text strings (role-prefixed for context).

## /voice Protocol Update

- `/voice flat` — enable flat mode (literal TTS)
- `/voice on` — enable emotional voice mode
- `/voice status` — show mode + whether emotion engine is active
- All existing subcommands unchanged

## Testing Strategy

### emotion.ts Tests
- Mock fast model returns valid JSON → verify rewrite + emotion profile
- Mock fast model returns invalid JSON → verify graceful fallback
- Whisper mode → verify output is brief, contains `[whisper]` guidance
- Different conversation contexts → verify appropriate mood detection
- Edge cases: empty history, single message, very long text

### prompt.ts Tests
- `buildTtsPrompt()` with emotion → verify EMOTIONAL DELIVERY section present
- `buildTtsPrompt()` without emotion → verify no EMOTIONAL DELIVERY section (backward compat)
- Each mood maps to correct delivery string
- Each intensity maps to correct modifier

### vox.ts Tests
- Flat mode → speak sends original text, no emotional rewrite called
- On mode with emotion engine → emotional rewrite called, enhanced prompt sent
- On mode without emotion engine (not wired) → graceful fallback to static prompt
- Whisper mode → emotional rewrite called with mode "whisper"
- Emotion engine error → graceful fallback, no throw

### protocol.ts Tests
- `/voice flat` → mode changes to flat
- `/voice on` → mode changes to on
- `/voice status` → includes emotion engine status

## Grok Voice API Capabilities Used

- **`session.update` instructions** — dynamic per-utterance system prompt with emotional delivery directions
- **Auditory cues** — `[whisper]`, `[sigh]`, `[laugh]`, `[pause]` embedded in text (supported on Ara, Eve, Leo voices)
- **Voice-to-voice model** — single unified model that processes paralinguistic cues natively

## Files Modified

| File | Change |
|------|--------|
| `src/core/voice/types.ts` | Add EmotionMood, EmotionIntensity, EmotionProfile, EmotionalRewriteResult; update VoiceMode |
| `src/core/voice/emotion.ts` | **NEW** — emotionalRewrite() function with fast model call |
| `src/core/voice/prompt.ts` | Add EMOTION_DELIVERY, INTENSITY_MODIFIER; update buildTtsPrompt() signature |
| `src/core/voice/vox.ts` | Add emotion engine fields, setEmotionEngine(), enhance speak() |
| `src/core/voice/protocol.ts` | Add flat mode to /voice protocol |
| `src/core/cortex.ts` | Add getRecentHistory() method |
| `src/core/runtime.ts` | Wire emotion engine after subsystemModel creation |
| `tests/unit/emotion.test.ts` | **NEW** — emotional rewrite tests |
| `tests/unit/voice-prompt.test.ts` | Update for emotion-enhanced buildTtsPrompt() |
| `tests/unit/vox.test.ts` | Update for flat mode, emotion engine integration |
| `tests/unit/voice-protocol.test.ts` | Update for flat mode |
