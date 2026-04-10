# Cortex Dual-Mode Redesign: Text + Voice Workers

**Date**: 2026-03-02
**Status**: Approved
**MCU Name**: Cortex Hemispheres (text pathway + voice pathway)

## Problem

FRIDAY's Cortex is a text-only agent loop (AI SDK `streamText()`) that gets shoe-horned into voice via VoiceBridge. VoiceBridge calls `cortex.chatStream()` for reasoning, then manually buffers text into sentences and pipes them to Grok's realtime API for TTS — fighting the API's native agent capabilities (`response.cancel`, `_ttsResponseExpected` flags, "Do not respond" instructions to suppress auto-responses).

## Solution

Make Cortex natively dual-mode: **one brain, two I/O pathways.** Text mode uses AI SDK's `streamText()` via TextWorker. Voice mode uses Grok's realtime API as a native agent loop via VoiceWorker. Both share the same cortical infrastructure: system prompt enrichment (Genesis + SMARTS + Sensorium), tool registry, conversation history, clearance/audit/signals.

## Architecture

```
          ┌─────────────────────────────────────────┐
          │              CORTEX                      │
          │  buildSystemPrompt()  (Genesis+SMARTS+   │
          │                        Sensorium)        │
          │  HistoryManager       (shared history)   │
          │  Tool Registry        (shared tools)     │
          │  Clearance / Audit / Signals             │
          ├───────────────┬─────────────────────────┤
          │  chatStream() │  chatStreamVoice()       │
          │       ↓       │         ↓                │
          │  TextWorker   │  VoiceWorker             │
          │  (AI SDK      │  (Grok realtime WS       │
          │   streamText) │   + native tool calling) │
          └───────────────┴─────────────────────────┘
```

## Key Design Decisions

1. **Cortex remains the single brain interface** — gains `chatStreamVoice()`, all other methods unchanged
2. **Workers are stateless processors** — receive WorkerRequest, return WorkerResult
3. **Grok realtime API is the voice agent** — reasoning + tool calling + speech, not a TTS pipe
4. **Portable tool infrastructure** — `ToolDefinition` (JSON Schema) + `executeTool` callback shared by both workers
5. **Data-driven narration** — `ToolEvent` stream replaces hardcoded 2s/5s timing thresholds
6. **VoiceBridge decomposed** → VoiceWorker (agent loop) + VoiceSessionManager (thin audio I/O)
7. **Vox unchanged** — stays for notification TTS (VoiceChannel), not part of agent response path

## New Types

### Worker Interface (`src/core/workers/types.ts`)

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

interface ToolEvent {
  type: "start" | "result" | "error";
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface WorkerRequest {
  systemPrompt: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxToolIterations: number;
}

interface WorkerResult {
  textStream: AsyncIterable<string>;
  audioStream?: AsyncIterable<string>;   // base64 PCM (voice only)
  toolEvents: AsyncIterable<ToolEvent>;
  fullText: PromiseLike<string>;
  usage: PromiseLike<TokenUsage>;
}

interface CortexWorker {
  process(request: WorkerRequest): WorkerResult;
}
```

### Voice Chat Stream (`src/core/stream-types.ts`)

```typescript
interface VoiceChatStream extends ChatStream {
  audioStream: AsyncIterable<string>;
  toolEvents: AsyncIterable<ToolEvent>;
}
```

## Data Flow

### Text Mode (unchanged)
```
user input → runtime.process() → cortex.chatStream()
  → buildSystemPrompt(genesis + SMARTS + sensorium)
  → buildWorkerRequest()
  → TextWorker.process() → AI SDK streamText()
  → ChatStream { textStream, fullText, usage }
  → vox.speak(fullText) [fire-and-forget, if mode != "off"]
```

### Voice Mode (new)
```
browser mic → handler.handleAudio() → sessionManager.appendAudio()
  → Grok VAD → transcription → sessionManager.handleUtterance()
  → cortex.chatStreamVoice(transcript)
    → buildSystemPrompt(genesis + SMARTS + sensorium)
    → buildWorkerRequest()
    → VoiceWorker.process() → Grok realtime WS
      → session.update (system prompt + tools)
      → function_call → executeTool() → function_call_output
      → response.output_audio.delta → audioStream
      → response.output_audio_transcript.delta → textStream
  → VoiceChatStream { textStream, audioStream, toolEvents, fullText, usage }
  → sessionManager: audioStream → voice:audio → browser speaker
  → sessionManager: toolEvents → NarrationPicker → ack/narration
```

## What Stays / Goes / Is New

| Component | Status | Notes |
|-----------|--------|-------|
| Cortex | Enhanced | +chatStreamVoice(), delegates to workers |
| Vox | Unchanged | Notification TTS stays |
| VoiceBridge | Removed (Phase 4) | → VoiceWorker + VoiceSessionManager |
| NarrationPicker | Unchanged | Pure utility |
| HistoryManager | Unchanged | Both modes write to same history |
| SessionHub | Unchanged | Session lifecycle unaffected |
| Handler voice messages | Same types | voice:audio, voice:transcript, voice:state |
| Web frontend hooks | Zero changes | useVoiceSession, useVoiceAudio |

## Implementation Phases

### Phase 1: Portable Tool Infrastructure (no behavior change)
- New: `src/core/tool-bridge.ts`, `tests/unit/tool-bridge.test.ts`
- Changed: `src/core/cortex.ts` (internals only — buildAiTools delegates to new functions)

### Phase 2: TextWorker Extraction (no behavior change)
- New: `src/core/workers/types.ts`, `src/core/workers/text-worker.ts`, `tests/unit/text-worker.test.ts`
- Changed: `src/core/cortex.ts` (chatStream delegates to TextWorker)

### Phase 3: VoiceWorker + Cortex Voice API (new capability)
- New: `src/core/workers/voice-worker.ts`, `tests/unit/voice-worker.test.ts`, `tests/unit/cortex-voice.test.ts`
- Changed: `src/core/cortex.ts` (+chatStreamVoice), `src/core/stream-types.ts` (+VoiceChatStream)

### Phase 4: VoiceSessionManager + Handler Integration
- New: `src/core/voice/session-manager.ts`, `tests/unit/voice-session-manager.test.ts`
- Changed: `src/server/handler.ts` (VoiceBridge → VoiceSessionManager)
- Deleted: `src/core/voice/bridge.ts`, `tests/unit/voice-bridge.test.ts`

### Phase 5: Narration Cleanup + Polish
- Changed: `src/core/voice/session-manager.ts` (ToolEvent-driven narration)
- Simplified: `src/core/voice/prompt.ts` (no more shoe-horned TTS prompt)
