# Voice-Cortex Integration & Narration Design

**Date**: 2026-03-01
**Status**: Approved
**Scope**: VoiceBridge streaming, quick acknowledgment, tool narration

## Problem

The current VoiceBridge has a split-brain problem relative to the CLI path:

1. **No quick ack** — VoiceBridge goes straight to Cortex processing; user hears silence
2. **No streaming** — `processThroughCortex()` does `await stream.fullText` (blocks until entire response + all tool iterations complete)
3. **No tool narration** — `tool:executing` signals fire but VoiceBridge doesn't listen to them
4. **Voice path diverges from CLI** — CLI uses `chatStream()` streaming + signal handlers; voice uses a monolithic await

The goal is to make the voice path work as close to the CLI input experience as possible, with maximum responsiveness and personality-driven narration.

## Approach: VoiceBridge-Centric

Enhance `VoiceBridge` directly with three new behaviors. VoiceBridge already owns the Grok WebSocket and the Cortex interaction — adding ack phrases, streaming, and signal subscription keeps the data flow simple.

**Rejected alternatives:**
- **Handler-Orchestrated**: Would bloat `handler.ts` (already 400+ lines) with voice-specific state management
- **VoiceNarrator Middleware**: New abstraction for a focused feature — over-engineering

## Protocol Constraint: Sequential TTS

The Grok/OpenAI Realtime API enforces a critical constraint: **only one response can be active at a time**. You must wait for `response.done` before sending the next `response.create`.

This means acks, narrations, and response chunks must flow through a **sequential TTS queue** with response gating.

Key protocol events used:
- `conversation.item.create` — inject text for TTS
- `response.create` — trigger audio generation (modalities: `["audio"]`)
- `response.done` — signals completion, gates next queue item
- `response.cancel` — can cancel in-progress response if needed

## Design

### 1. Quick Acknowledgment System

**New file**: `src/core/voice/narration.ts`

Pool of ~30 FRIDAY-personality phrases, selected with Fisher-Yates shuffle-then-cycle (no consecutive repeats):

```typescript
const ACK_PHRASES = [
  "On it, boss.",
  "Consider it done.",
  "Let me pull that up.",
  "Right away.",
  "I'm on the case.",
  // ... ~25 more
];
```

Phrases match FRIDAY's MCU personality: competent, warm, slightly irreverent. No "your" possessives (FRIDAY works on her own systems too).

**`NarrationPicker` class**: Shuffles the array on construction, iterates sequentially. When exhausted, re-shuffles. This ensures maximum variety without consecutive repeats.

### 2. Streaming Cortex Response to TTS

**Current**:
```
transcript → cortex.chatStream() → await fullText → sendToGrokTts(fullText)
```

**New**:
```
transcript → cortex.chatStream() → iterate textStream → buffer sentences → queue each
```

**Sentence buffering**: Buffer text chunks until sentence boundary (`/[.!?\n]\s*$/`) or buffer exceeds ~200 chars. Push completed sentences to the TTS queue.

**Response gating**: `_responseInFlight` boolean set true on `response.create`, cleared on `response.done`. The queue processor checks this before sending the next item.

**TTS queue**: Simple FIFO `string[]`. On `response.done`, shift next segment and send via `sendToGrokTts()`. This naturally sequences: ack → response sentences → tool narrations.

**Still awaits `stream.fullText`**: Required so Cortex records the response in history and triggers usage tracking. But we don't block on it for TTS — sentences stream as they arrive.

### 3. Tool Narration System

**Signal subscription**: VoiceBridge subscribes to `tool:executing` on the `SignalBus` (passed in via config). When a tool fires and >2s has elapsed since Cortex processing began, push a human-friendly narration to the TTS queue.

**Multiple phrases per tool** (3-5 variations each, Fisher-Yates picked):

```typescript
const TOOL_NARRATIONS: Record<string, string[]> = {
  "git.status": [
    "Taking a peek at the repo...",
    "Let me see what's changed around here...",
    "Checking the repo state...",
    "Running a quick status check...",
  ],
  "git.diff": [
    "Pulling up the diff — let's see what's changed...",
    "Reviewing the diff now...",
    "Looking at what's different since last commit...",
  ],
  // ... all tools covered
};
```

**Possessive-neutral**: No "your codebase", "your containers" — use "the repo", "the containers". FRIDAY may be working on her own systems.

**Generic fallbacks**: For unmapped tools (e.g., Forge-generated):
```typescript
const GENERIC_NARRATIONS = [
  "Working on something here, one moment...",
  "Processing that...",
  "Crunching through this — bear with me...",
  "Hold that thought, I'm on it...",
  "Just need a moment on this one...",
];
```

**Edge case**: If multiple tools fire within seconds, only narrate the first one after the 2s threshold. Don't spam the queue with narrations for every tool in a multi-tool chain.

**Cleanup**: Unsubscribe from `tool:executing` when VoiceBridge stops. Store handler reference.

## Data Flow

```
User speaks
  ↓
Grok Realtime API → speech_started → speech_stopped → transcript
  ↓
VoiceBridge.processThroughCortex(transcript)
  ├─ 1. Pick random ack phrase → push to TTS queue
  ├─ 2. Flush queue → sendToGrokTts(ack) → await response.done
  ├─ 3. Start cortex.chatStream(transcript)
  ├─ 4. Subscribe to tool:executing signals (2s delay → push narration to queue)
  ├─ 5. Buffer text chunks → on sentence boundary → push to TTS queue
  ├─ 6. Queue processor: on response.done → shift next item → sendToGrokTts()
  └─ 7. After stream ends: flush remaining buffer, await all response.done, unsubscribe signals
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/core/voice/narration.ts` | `NarrationPicker` class, `ACK_PHRASES` (30), `TOOL_NARRATIONS` map, `GENERIC_NARRATIONS` |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/voice/bridge.ts` | TTS queue, response gating (`_responseInFlight`), streaming `processThroughCortex()`, signal subscription, ack dispatch, sentence buffering, `handleGrokMessage` listens for `response.done` |
| `src/core/voice/types.ts` | Add `SignalBus` to `VoiceBridgeConfig` |
| `src/server/handler.ts` | Pass `runtime.signals` into VoiceBridge constructor/config |

## Error Handling

- If Grok WebSocket closes mid-TTS: clear queue, set state to "error"
- If Cortex throws: speak a brief error phrase through the queue
- If tool narration arrives after Cortex response finished: discard (stale)

## Testing Strategy

- Unit test `NarrationPicker` (shuffle, no-repeat, cycle exhaustion + re-shuffle)
- Unit test sentence boundary detection (`isSentenceBoundary()`)
- Unit test TTS queue (sequential processing, response.done gating, queue drain)
- Integration test: mock Cortex + mock Grok WS → verify ack sent before Cortex, narration sent after delay
- Existing VoiceBridge tests updated for new constructor signature

## Sources

- [xAI Grok Voice Agent API](https://docs.x.ai/docs/guides/voice/agent)
- [Azure OpenAI Realtime Audio Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)
- [OpenAI Realtime Client Events](https://platform.openai.com/docs/api-reference/realtime-client-events)
- [Community: Interrupt Realtime Audio with Text](https://community.openai.com/t/interrupt-realtime-audio-with-text-message-webrtc/1068797)
