# xAI Voice Agent Gap Analysis

**Date:** 2026-08-02  
**Status:** Decisions locked (2026-08-02) — ready for implementation planning  
**Baseline:** Friday voice stack as of `feature/deps-upgrade-voice-audit`  
**Sources:** [xAI Speech to Speech docs](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech), [Voice overview](https://docs.x.ai/developers/model-capabilities/audio/voice), [Grok Voice Think Fast 2.0 announcement](https://x.ai/news/grok-voice-think-fast-2)

---

## Purpose

Inventory what Friday’s realtime voice path already does versus current xAI Voice Agent capabilities, then lock an adoption set for implementation.

**Decisions below supersede the seed recommendations** in each inventory item.

---

## Friday baseline (today)

Two separate xAI voice paths:

| Path | Role | Transport |
|------|------|-----------|
| **Realtime agent** | Browser full-duplex voice | `VoiceSessionManager` + `VoiceWorker` → `wss://api.x.ai/v1/realtime` |
| **REST TTS (Vox)** | CLI `/voice` + notification speech | `POST https://api.x.ai/v1/tts` |

### Realtime path specifics

| Area | Current behavior | Key files |
|------|------------------|-----------|
| Connect URL | `wss://api.x.ai/v1/realtime` **with no `?model=`** | `src/core/voice/ws.ts`, `types.ts` |
| Auth | Server-side Bearer `XAI_API_KEY` (Friday proxies browser WS) | `ws.ts`, `handler.ts` |
| Agent loop | Native Grok agent: `session.update` (instructions + tools) → `response.create` | `voice-worker.ts` |
| Tools | Custom Friday functions only (`toGrokTools`) | `tool-bridge.ts` |
| VAD | `server_vad` + `create_response: false` (manual response via VoiceWorker) | `session-manager.ts` |
| STT | `input_audio_transcription.model = "whisper-1"` | `session-manager.ts` |
| Audio | 48 kHz PCM, JSON/base64 frames both directions | `session-manager.ts`, web hooks |
| Voices | Ara, Eve, Rex, Sal, Leo (default Eve) | `types.ts` |
| Reconnect | None — error/idle on WS close | `session-manager.ts` |
| Known gaps | `voice:mode` not server-side; emotion speech tags only on Vox REST | `handler.ts`, `emotion.ts` |

Architecture note: older VoiceBridge (STT → Cortex text → TTS) is gone. Current design treats Grok as the native speech-to-speech agent; Cortex enriches prompt/tools/history.

---

## Gap inventory

Each item: what it is → Friday impact → effort → **seed recommendation** (final pick deferred).

### 1. Explicit voice model selection

**What:** Docs require `wss://api.x.ai/v1/realtime?model=…`. Models:

| Model | Notes |
|-------|-------|
| `grok-voice-latest` | Alias; moves from Think Fast 1.0 → **2.0 on August 5, 2026** |
| `grok-voice-think-fast-2.0` | Current flagship |
| `grok-voice-think-fast-1.0` | Pin to stay on previous gen |

**Friday impact:** Friday omits `?model=`. Behavior today is undefined / provider-default. Alias flip is ~3 days from this doc’s date.

**Effort:** Low (URL + config/env, e.g. `FRIDAY_VOICE_MODEL`).

**Seed:** **Must** — pass explicit model; prefer `grok-voice-latest` (or pin 2.0) before/around Aug 5.

**Decision:** **Adopt (first pass).** Always track `grok-voice-latest` (no version pin). Optional env override `FRIDAY_VOICE_MODEL` for escape hatch.

---

### 2. Session resumption / reconnect

**What:** `resumption.enabled` on `session.update` caches turns by `conversation_id` and replays on reconnect so the model stays conditioned.

**Friday impact:** Close/error ends the session with no backoff or resume. Browser refreshes / flaky networks drop conversational context on the Grok side (Friday history may still exist locally).

**Effort:** Medium (conversation_id plumbing, reconnect policy, UI state).

**Seed:** **Should** — reliability win that matches Friday’s always-on assistant posture.

**Decision:** **Adopt (first pass).** Enable session resumption + reconnect with a **visible** “reconnecting…” orb state (not silent).

---

### 3. Binary audio transport

**What:** `audio.input/output.transport: "binary"` sends raw PCM/Opus as WS binary frames instead of base64 JSON. Lifecycle events stay JSON.

**Friday impact:** Today every mic/audio frame is base64’d into JSON (~50–100 Hz). Binary would cut CPU/bandwidth between Friday server ↔ Grok. Browser ↔ Friday already uses binary PCM on `/ws`.

**Effort:** Medium (Grok WS binary handling in `session-manager`; keep Friday↔browser protocol as-is or align).

**Seed:** **Later** — clear win, not blocking Think Fast 2.0.

**Decision:** **Fast follow-up** (immediately after first pass, not parked indefinitely).

---

### 4. VAD / turn-detection knobs

**What:** `silence_duration_ms`, `threshold`, `prefix_padding_ms`, `idle_timeout_ms`; manual mode via `turn_detection: null`.

**Friday impact:** Fixed `server_vad` + `create_response: false`. No tuning for pause-friendly vs snappy turns; no idle re-engage.

**Effort:** Low–medium (config + optional `/voice` or web settings).

**Seed:** **Should** expose `silence_duration_ms` (and maybe idle timeout); keep `create_response: false` (Friday owns the agent loop).

**Decision:** **Adopt (first pass).** Expose `silence_duration_ms` with a sensible default + **env setting** (e.g. `FRIDAY_VOICE_SILENCE_MS`). Keep `create_response: false`. Defer idle re-engage / full knob UI.

---

### 5. Built-in server tools (`web_search`, `x_search`, `file_search`, remote `mcp`)

**What:** xAI executes these server-side; only custom `function` tools need client round-trips. Can combine with Friday functions.

**Friday impact:** Voice path only registers clearance-gated Friday tools. No native web/X/collections/MCP on the voice agent. Text path already has web-fetch module, etc., but those are Friday-executed.

**Effort:** Medium product decision + low–medium wiring. Tension: Friday Clearance/Audit vs opaque xAI server tools.

**Seed:** **Later / discuss** — enabling `web_search` is tempting for voice Q&A; Clearance story must be explicit (opt-in, audited session flag). Remote MCP is powerful but overlaps Forge/modules.

**Decision:** **Later.** Policy/Clearance story first; not in first pass or fast follow-up.

---

### 6. `force_message` (scripted TTS turns)

**What:** xAI extension — `conversation.item.create` with `type: "force_message"` speaks verbatim TTS without the model. Do **not** send `response.create`.

**Friday impact:** Narration/ACK phrases and Vox greetings are REST/Vox-era; realtime path has no verbatim scripted line (compliance, boot greeting, “listening…”).

**Effort:** Low.

**Seed:** **Should** — greetings and mode-change confirmations without polluting the agent’s reasoning turn.

**Decision:** **Adopt (first pass).** Use for greetings / mode-change acks.

---

### 7. Pronunciation `replace` map

**What:** `session.replace` maps phrases → spoken forms without changing transcripts (e.g. product names).

**Friday impact:** Friday / MCU jargon (“Cortex”, “SMARTS”, “Arc Rhythm”, user names) may be mispronounced.

**Effort:** Low (static map + optional SMARTS-driven updates).

**Seed:** **Later** — nice polish after model + resumption.

**Decision:** **Later.**

---

### 8. Expanded / custom voices

**What:** Large built-in roster via TTS voices API; Custom Voices API clones from a short clip; `voice` accepts built-in or custom `voice_id`.

**Friday impact:** Hardcoded five voices (`GrokVoice` union). Vox + realtime share the same limited set.

**Effort:** Medium (type widening, `/voice` UX, optional clone workflow).

**Seed:** **Later** for roster expansion; **Skip / Later** for custom clone unless BOSS wants a personal Friday voice.

**Decision:** **Later.** Stick to Eve + current five for now; no custom clone.

---

### 9. Ephemeral tokens

**What:** Short-lived tokens so browsers can connect to xAI WS without a long-lived API key.

**Friday impact:** Browser never talks to xAI directly — Friday server holds the key and proxies. Ephemeral tokens matter only if we ever move to client-direct Grok WS.

**Effort:** N/A under current architecture.

**Seed:** **Skip** while proxy architecture remains.

**Decision:** **Skip.**

---

### 10. Per-response instructions & reasoning effort

**What:** Docs include per-response instruction overrides and `reasoning.effort` (`high` | `none`). Think Fast 2.0 reasons while speaking; effort knobs trade latency vs depth.

**Friday impact:** Instructions set on session + per-turn `session.update` in VoiceWorker. No `reasoning.effort` today.

**Effort:** Low for effort flag; medium to productize per-response overrides.

**Seed:** **Later** for `reasoning.effort` (default high is fine for 2.0); revisit if latency complaints appear.

**Decision:** **Later.** Leave provider default (`high`).

---

### 11. TTS / STT stack vs Vox

**What:** Full Voice stack now includes streaming TTS WS, richer codecs, language hints, keyterms, speech tags, STT diarization/batch.

**Friday impact:** Vox remains unary REST WAV @ 24 kHz. Realtime STT still pinned to `whisper-1`. Emotion speech tags apply only on Vox rewrite, not realtime agent speech.

**Effort:** Medium–high if unifying; low if leaving Vox as CLI/notification path.

**Seed:** **Later** — keep dual-path for now; optionally add language_hint/keyterms on realtime; consider speech tags on realtime only if xAI exposes equivalent controls for S2S.

**Decision:** **Later.** Keep dual-path (realtime agent + Vox REST).

---

## Locked adoption set (2026-08-02)

### First implementation pass

| # | Item | Notes |
|---|------|-------|
| 1 | Explicit `?model=grok-voice-latest` | Track latest; optional `FRIDAY_VOICE_MODEL` override |
| 2 | Session resumption + reconnect | Visible “reconnecting…” orb state |
| 4 | `silence_duration_ms` | Sensible default + env (e.g. `FRIDAY_VOICE_SILENCE_MS`); keep `create_response: false` |
| 6 | `force_message` | Greetings / mode-change acks |

### Fast follow-up (immediately after first pass)

| # | Item | Notes |
|---|------|-------|
| 3 | Binary audio transport | Friday server ↔ Grok; browser ↔ Friday can stay as-is |

### Later

| # | Item |
|---|------|
| 5 | Built-in xAI tools (`web_search`, etc.) — needs Clearance/policy first |
| 7 | Pronunciation `replace` map |
| 8 | Expanded / custom voices |
| 10 | `reasoning.effort` / per-response instructions |
| 11 | Vox/STT stack upgrades |

### Skip

| # | Item |
|---|------|
| 9 | Ephemeral tokens (while server-proxied) |

---

## Non-goals (first pass + fast follow-up)

- Rewriting the VoiceBridge-era architecture  
- Moving browser clients to talk to xAI directly  
- Replacing Friday custom tools wholesale with xAI MCP  
- Unifying Vox REST and realtime into a single code path  
- Idle VAD re-engage / full VAD settings UI  

---

## Resolved questions

1. **Model:** Track `grok-voice-latest` (not pinned).  
2. **Built-in tools:** Later — Clearance/policy discussion first.  
3. **Custom voice:** No — Eve + current five for now.  
4. **Reconnect UX:** Visible “reconnecting…” state (not silent).
