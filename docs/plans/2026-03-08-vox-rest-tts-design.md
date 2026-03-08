# Vox REST TTS Refactor Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** `src/core/voice/` only — no changes outside Vox subsystem

## Problem

Vox currently uses the Grok Realtime Conversational API (`wss://api.x.ai/v1/realtime`) as a one-way TTS pipe. This is architecturally wrong — using a bidirectional voice conversation API just to speak text. It requires managing WebSocket lifecycle (connect, disconnect, idle eviction, reconnection), conversation sessions, chunk accumulation, and manual PCM-to-WAV conversion.

xAI has released a dedicated TTS API (`POST https://api.x.ai/v1/tts`) that returns binary audio from a single HTTP call, with native speech tag support for expressive delivery.

## Solution

Replace the Grok Realtime WebSocket in Vox with the REST TTS API. Enhance the emotional rewrite pipeline to use native Speech Tags (inline + wrapping) instead of invented cue markers.

## Architecture

### Current Flow (Realtime API — complex)

```
text → emotional rewrite (LLM) → buildTtsPrompt()
→ WebSocket session.update → conversation.item.create → response.create
→ accumulate PCM chunks → pcmToWav() → write temp file → afplay → cleanup
```

### New Flow (REST TTS — simple)

```
text → emotional rewrite (LLM, outputs native tags)
→ POST /v1/tts { text, voice_id } → binary audio response
→ write temp file → afplay → cleanup
```

### Key Simplifications

- No WebSocket lifecycle (connect, disconnect, idle timer, reconnect)
- No chunk accumulation — API returns complete audio
- No `pcmToWav()` — request WAV directly from API
- No `buildTtsPrompt()` — REST API has no instructions field; it speaks the text as given
- No `session.update` — voice selection is a request parameter
- Whisper mode uses native `<whisper>` wrapping tag instead of OS volume reduction

### What Stays the Same

- `Vox` class public API: `speak()`, `cancel()`, `stop()`, `setMode()`, `status()`
- Integration points: Cortex calls `vox.speak(text)`, VoiceChannel wraps `vox.speak()`, protocol controls modes
- Emotional rewrite still uses fast model LLM call — outputs native tags now
- `detectPlayer()`, `playAudio()`, `cleanupTempFile()` in `audio.ts` — unchanged
- Zero changes outside `src/core/voice/`

## File-by-File Changes

### `types.ts` — Simplify Config

- Rename `VOX_WS_URL` → `GROK_REALTIME_URL` (still used by `ws.ts` / VoiceSessionManager)
- Add `VOX_TTS_URL = "https://api.x.ai/v1/tts"`
- Remove from `VoxConfig`: `sampleRate`, `whisperVolume`, `idleTimeoutMs`
- Keep in `VoxConfig`: `defaultVoice`, `timeoutMs`
- Update `VOX_DEFAULTS` accordingly
- All voice types (`GrokVoice`, `VoiceMode`, emotion types) unchanged

### `ws.ts` — KEEP (shared)

- Update import: `VOX_WS_URL` → `GROK_REALTIME_URL`
- No other changes — `VoiceSessionManager` still needs this for bidirectional voice

### `vox.ts` — Major Simplification

**Remove:**
- All WebSocket fields: `_ws`, `_connected`, `_idleTimer`, `_audioChunks`, `_speakResolve`, `_speakTimeout`
- All WebSocket methods: `connect()`, `disconnect()`, `handleMessage()`, `resetIdleTimer()`
- `isConnected` getter
- Import of `openGrokWebSocket` from `ws.ts`
- Import of `buildTtsPrompt` from `prompt.ts`
- Import of `pcmToWav` from `audio.ts`

**New `speak()` flow:**
1. Guard: mode === off, clearance check, API key, empty text
2. Cancel any in-progress playback
3. Emotional rewrite (if on/whisper mode and engine available)
4. `fetch(VOX_TTS_URL, { method: "POST", body: { text, voice_id }, headers: { Authorization } })`
5. `response.arrayBuffer()` → Buffer
6. Write temp file → play with OS player
7. Await playback completion → cleanup

**Keep:**
- `_mode`, `_activeProc`, `_activeTmpFile`, `_speaking`
- `cancel()`, `cancelPlayback()`, `stop()`
- `setMode()`, `status()`, `mode` getter
- `setEmotionEngine()`, `hasEmotionEngine`, `apiKeyAvailable`
- All audit logging and signal emission

**`status()`** — remove `connected` field from `VoxStatus` (no persistent connection concept)

### `prompt.ts` — Trim Vox-Specific Code

**Remove** (only used by old Vox TTS prompt, not by VoiceWorker):
- `buildTtsPrompt()`
- `classifyContent()` and `CONTENT_HINTS`
- `READING_RULES`
- `MODE_CONTEXT`
- `EMOTION_DELIVERY`
- `INTENSITY_MODIFIER`

**Keep** (used by VoiceWorker for conversational voice):
- `FRIDAY_VOICE_IDENTITY` (also used by emotional rewrite)
- `buildVoiceSystemPrompt()`
- `VOICE_DELIVERY_RULES`

### `audio.ts` — Minor Trim

**Remove:**
- `pcmToWav()` — API returns complete audio, no manual WAV header needed

**Keep unchanged:**
- `detectPlayer()`, `playAudio()`, `cleanupTempFile()`

### `emotion.ts` — Enhanced Prompt with Native Tags

Update `EMOTION_REWRITE_PROMPT` to include full native tag reference:

**AVAILABLE SPEECH TAGS section (new):**

```
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

Tags can be nested: <slow><soft>Sleep well, Boss.</soft></slow>
```

**TAG USAGE GUIDELINES section (new, tuned to Friday's personality):**

```
- Less is more. A few well-placed tags beat tagging every sentence.
- Friday is understated — prefer [chuckle] over [laugh], <soft> over <loud>.
- Use [pause] for dramatic timing and dry wit beats.
- Use <emphasis> sparingly — only for words Friday would genuinely stress.
- [tsk] and [sigh] suit Friday's personality — exasperation without drama.
- Reserve <build-intensity> for moments of real significance.
- Never use [cry] or [giggle] — they don't fit Friday's character.
- For amused delivery, prefer <laugh-speak> over inserting [laugh] mid-sentence.
```

**Updated MODE_GUIDANCE:**

```typescript
const MODE_GUIDANCE = {
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
```

**`emotionalRewrite()` function** — signature unchanged, internal prompt updated.

### `channel.ts` — No Changes

`VoiceChannel` calls `vox.speak()` — interface unchanged.

### `protocol.ts` — Minor Update

Update `handleStatus()` to reflect no `connected` field in `VoxStatus`.

### `narration.ts` — No Changes

## Shared Symbol Audit

| Symbol | Shared? | Action |
|---|---|---|
| `ws.ts` / `openGrokWebSocket` | YES — VoiceSessionManager | KEEP, Vox stops importing |
| `VOX_WS_URL` | YES — ws.ts | RENAME to `GROK_REALTIME_URL` |
| `pcmToWav` | NO — only vox.ts + tests | Remove |
| `buildTtsPrompt` | NO — only vox.ts + tests | Remove |
| `classifyContent` | NO — only buildTtsPrompt + tests | Remove |
| `READING_RULES` | NO — private const | Remove |
| `MODE_CONTEXT` | NO — private const | Remove |
| `EMOTION_DELIVERY` | NO — private const | Remove |
| `INTENSITY_MODIFIER` | NO — private const | Remove |
| `CONTENT_HINTS` | NO — private const | Remove |
| `sampleRate` in VoxConfig | NO — VoiceSessionManager has own | Remove from VoxConfig |
| `whisperVolume` | NO — only vox.ts | Remove |
| `idleTimeoutMs` | NO — only vox.ts | Remove |
| `isConnected` getter | NO — web UI references VoiceSession, not Vox | Remove from Vox |
| `FRIDAY_VOICE_IDENTITY` | YES — emotion.ts uses it | KEEP |
| `buildVoiceSystemPrompt` | YES — VoiceWorker uses it | KEEP |
| `VOICE_DELIVERY_RULES` | YES — VoiceWorker uses it | KEEP |

## Testing

| Test File | Changes |
|---|---|
| `vox.test.ts` | Major — replace WebSocket mocking with `fetch` mocking (`globalThis.fetch`). Test: clearance → rewrite → fetch → playAudio. Test cancel kills proc. |
| `vox-prompt.test.ts` | Major — remove `buildTtsPrompt` and `classifyContent` tests. Keep `FRIDAY_VOICE_IDENTITY` and `buildVoiceSystemPrompt` tests. |
| `vox-audio.test.ts` | Remove `pcmToWav` tests. Keep `detectPlayer` tests. |
| `vox-protocol.test.ts` | Minor — update status assertions (no `connected` field) |
| `vox-runtime.test.ts` | Minor — update VoxConfig construction |
| `vox-cortex.test.ts` | No changes |
| `vox-channel.test.ts` | No changes |
| `vox-types.test.ts` | Update VOX_DEFAULTS assertions |
| `emotion.test.ts` | Update expected tag patterns |

## Net Impact

- ~250 lines removed (WebSocket lifecycle, PCM conversion, TTS prompt building)
- ~50 lines added (fetch call, native tag reference in prompt)
- **Net reduction: ~200 lines**
- Richer expressiveness through 14 inline + 12 wrapping native speech tags
- Simpler architecture, fewer moving parts, fewer failure modes

## Documentation Updates

- Update `CLAUDE.md` architecture table for `prompt.ts` exports
- Update `CLAUDE.md` Vox description (REST TTS, no WebSocket)
