# Vox — Friday's Voice Output System

**Date:** 2026-02-25
**Status:** Approved
**MCU Mapping:** Vox = Friday's voice (alongside Cortex = brain, Sensorium = senses, Genesis = identity)

## Overview

Vox is Friday's voice output subsystem — a core component (not a module) that gives Friday the ability to speak aloud. It uses the xAI Grok Voice Agent API via WebSocket to convert text responses into natural speech with Friday's personality and accent.

Two primary use cases:

1. **Conversational voice** — When voice mode is active, every Cortex response is automatically spoken aloud (fire-and-forget, non-blocking to the TUI).
2. **Notification voice** — A `VoiceChannel` registered with `NotificationManager` speaks alerts from Sensorium, Arc Rhythm, and other subsystems.

## Voice Modes

Three modes, starting from Off by default:

| Mode | Playback Volume | TTS Generation Style | Behavior |
|------|----------------|----------------------|----------|
| **Off** (default) | None | N/A | `speak()` is a no-op |
| **On** | Normal (1.0) | Natural, full delivery | All chat responses + notifications voiced |
| **Whisper** | Low (0.3) | Ultra-brief, intimate, 2 sentences max | Both playback volume AND generation style adjusted |

Whisper mode is a two-layer approach:
- **Playback layer:** Reduced volume via OS audio player flags
- **Generation layer:** TTS system prompt instructs Grok to generate shorter, quieter, more concise speech

The user toggles modes via the `/voice` protocol. Mode persists for the session.

## Architecture

### Core Subsystem (not a module)

Vox lives in `src/core/voice/` as a core subsystem, like Sensorium. Rationale: voice is a fundamental sense — Friday's "mouth" — not a detachable peripheral. It belongs alongside Cortex (brain), Sensorium (eyes), and Genesis (identity).

### File Structure

```
src/core/voice/
├── types.ts          # VoiceMode, GrokVoice, VoxConfig, VoxOptions
├── vox.ts            # Vox class — core voice agent, WebSocket lifecycle, idle management
├── prompt.ts         # FRIDAY_INSTRUCTIONS base, buildTtsPrompt(), content classifiers
├── audio.ts          # pcmToWav(), detectPlayer(), playAudio() — platform abstraction
├── channel.ts        # VoiceChannel implements NotificationChannel
└── protocol.ts       # /voice protocol (on, off, whisper, test, status)
```

### Boot Sequence Position

```
SignalBus → ClearanceManager → AuditLogger → NotificationManager → ProtocolRegistry
→ DirectiveStore/Engine → Memory → SMARTS → Sensorium → Genesis
→ Cortex → Environment Tool → Recall Tool → Arc Rhythm
→ ★ Vox (registers VoiceChannel + /voice protocol)
→ Modules → Forge
```

Vox initializes after Cortex (needs to exist to hook responses) but before Modules (so modules can trigger voice via notifications).

### Shutdown Sequence Position

```
Arc Rhythm → ★ Vox (cancel playback + close WebSocket) → Sensorium → Conversation → ...
```

## Cortex Integration

Cortex receives a `vox?: Vox` reference via `CortexConfig`. After `chat()` produces the final text response, Cortex fires Vox:

```typescript
// In Cortex.chat(), after building the final text response:
if (this.vox) {
  this.vox.speak(response.text).catch(() => {});
}
return response.text;
```

Three lines. Text returns immediately to the TUI. Voice plays in the background. If the user sends another message, the next `speak()` cancels any in-progress playback.

## Dynamic TTS Prompt System

The TTS system prompt is rebuilt per utterance to give the Grok Voice Agent context-aware instructions.

### Prompt Structure

```
┌──────────────────────────────────────┐
│  Base Identity (always present)       │  ← FRIDAY voice, accent, personality
├──────────────────────────────────────┤
│  Mode Context (varies by mode)        │  ← "You are whispering" / normal
├──────────────────────────────────────┤
│  Content Hints (varies per message)   │  ← "This contains a data table..."
├──────────────────────────────────────┤
│  Reading Rules (always present)       │  ← Summarize tables, skip URLs, etc.
└──────────────────────────────────────┘
```

### Base Identity

Carried over from the proof-of-concept — FRIDAY's County Tipperary Irish accent, calm/composed tone, dry wit. Speaks as FRIDAY would brief Tony Stark.

### Mode Context

```
On:      "Speak clearly and naturally at normal pace. You are FRIDAY delivering
          information to the Boss."

Whisper: "You are whispering. Keep it very brief — two sentences maximum.
          Only the essential point. Your tone is quiet, intimate, like leaning
          in to murmur something to the Boss so only he hears. Be concise
          above all else."
```

### Content Classification (Heuristic)

Fast pattern matching on the response text before sending to the voice API — no LLM call:

| Pattern Detected | Content Hint Injected |
|---|---|
| Markdown table (`\|---\|`) | "The response contains tabular data. Summarize key rows, don't read every cell." |
| Code block (triple backtick) | "The response contains code. Briefly describe what it does, don't read syntax." |
| JSON/object literals | "The response contains structured data. Extract the key takeaways." |
| Long bullet list (>5 items) | "The response contains a long list. Highlight the most important items." |
| URLs/file paths | "The response contains URLs or paths. Say 'I'll leave that on screen for you.'" |
| Short conversational text | No hint — speak naturally |

### `session.update` Per Utterance

The dynamic prompt is injected via `session.update` on the WebSocket before each utterance. Since the WebSocket is persistent (see below), this changes the instructions without reconnecting.

## WebSocket Connection Management

### Persistent Connection with Idle Eviction

Instead of opening/closing a WebSocket per utterance, Vox maintains a persistent connection that disconnects after 60 seconds of idle:

```
speak() called → WebSocket alive?
                  ├── No  → connect(), session.update, send text
                  └── Yes → reset idle timer, session.update, send text
                        │
                  audio streams → playback starts
                        │
                  idle timer starts (60s)
                        │
                  ├── 60s no speak → ws.close(), _ws = null
                  └── new speak()  → reset timer, reuse connection
```

### Benefits Over Per-Utterance

| Aspect | Per-Utterance | Persistent + Idle |
|---|---|---|
| WebSocket handshake | Every `speak()` | Once per idle cycle |
| `session.update` | On connect | Every `speak()` (dynamic prompt still works) |
| Close trigger | After `response.done` | 60s idle OR `stop()` |
| Active conversation latency | High (reconnect each time) | Low (reuse connection) |

### Cancel Behavior

Two levels:
- **Soft cancel** (new utterance arrives): Kill the audio player process, discard remaining PCM chunks for the current utterance. WebSocket stays open.
- **Hard cancel** (`stop()` at shutdown): Kill player + close WebSocket + clear idle timer.

### Error Recovery

If the WebSocket dies unexpectedly (network error, server close), the `on("close")` handler sets `_connected = false`. The next `speak()` detects this and calls `connect()` — seamless automatic reconnection.

## Platform-Detected Audio Playback

Runtime detection via `process.platform`:

| Platform | Player | Volume Flag |
|---|---|---|
| macOS (`darwin`) | `afplay` | `--volume 0.3` |
| Linux (`linux`) | `paplay` | `--volume=19660` (0.3 * 65536) |
| Windows (`win32`) | PowerShell `SoundPlayer` | System volume |

Audio flow: PCM16 chunks from Grok → assembled into buffer → WAV header prepended → written to temp file → played via OS player → temp file cleaned up.

## Notification Voice Channel

```typescript
class VoiceChannel implements NotificationChannel {
  name = "voice";
  constructor(private vox: Vox) {}

  async send(notification: FridayNotification): Promise<void> {
    const spoken = `${notification.title}. ${notification.body}`;
    await this.vox.speak(spoken);
  }
}
```

Registered with NotificationManager during Vox initialization. Notifications from Sensorium alerts, Arc Rhythm events, and other subsystems are automatically spoken when voice mode is On or Whisper.

## `/voice` Protocol

Command: `/voice` (aliases: `/vox`, `/speak`)

| Subcommand | Description |
|---|---|
| `/voice` | Show current mode, voice, connection status |
| `/voice on` | Switch to On mode |
| `/voice off` | Switch to Off mode |
| `/voice whisper` | Switch to Whisper mode |
| `/voice test` | Speak a short test phrase |

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FRIDAY_VOICE` | `Eve` | Grok voice name (Ara, Eve, Rex, Sal, Leo) |

### RuntimeConfig

```typescript
interface RuntimeConfig extends Partial<FridayConfig> {
  // ...existing fields...
  enableVox?: boolean;  // default true, disable with --no-voice
}
```

### CortexConfig

```typescript
interface CortexConfig extends Partial<FridayConfig> {
  // ...existing fields...
  vox?: Vox;
}
```

### VoxConfig

```typescript
interface VoxConfig {
  defaultVoice: GrokVoice;     // from FRIDAY_VOICE or "Eve"
  sampleRate: number;          // 48000
  whisperVolume: number;       // 0.3
  timeoutMs: number;           // per-utterance timeout
  idleTimeoutMs: number;       // 60000 (1 minute)
}
```

## Clearance

New clearance: `"audio-output"` — gates the `speak()` path. Granted by default but revocable via ClearanceManager.

## Signals

| Signal | Payload | When |
|---|---|---|
| `custom:vox-mode-changed` | `{ from: VoiceMode, to: VoiceMode }` | Mode switch via protocol |
| `custom:vox-spoke` | `{ length: number }` | After successful speech playback |
| `custom:vox-error` | `{ error: string }` | WebSocket or playback failure |

## Error Handling

Voice is a non-critical subsystem. It never crashes Friday or blocks the chat flow.

| Failure | Behavior |
|---|---|
| `XAI_API_KEY` missing | Vox logs warning at boot, stays in permanent `off` mode |
| WebSocket connection fails | `custom:vox-error` signal, `speak()` resolves silently |
| Per-utterance timeout | Kills WebSocket, resolves. Next `speak()` reconnects |
| Audio player not found | Detected at first `speak()`, logs warning, disables voice |
| Audio playback process fails | Cleanup temp WAV, emit error signal, resolve |
| Cancel during playback | Kill player process, discard PCM chunks |
| Cancel during WebSocket streaming | Discard accumulated PCM chunks (WebSocket stays open) |

Key principle: Every `speak()` call resolves (never rejects to the caller). Errors are routed through signals and audit logs.

## Testing Strategy

### Test Files

```
tests/unit/
├── vox.test.ts              # Vox class: mode state, cancel, speak routing
├── vox-prompt.test.ts       # buildTtsPrompt: content classification, mode injection
├── vox-audio.test.ts        # pcmToWav, detectPlayer, platform branching
├── vox-protocol.test.ts     # /voice protocol subcommands
└── vox-channel.test.ts      # VoiceChannel notification bridge
```

### Stubbing Strategy

- WebSocket stubbed — no real Grok API calls in unit tests
- `Bun.spawn` stubbed for audio playback — verify correct command/args per platform
- `process.platform` overridable via `platformOverride` config option for testing Linux/Windows paths on macOS
- Mode state transitions are pure logic — fully testable without stubs
- Content classification is pure functions — string in, hints out
- Prompt building is pure functions — content + mode in, prompt string out

### Integration Test (optional)

`tests/integration/vox-live.test.ts` — connects to Grok, plays audio. Requires `XAI_API_KEY`, skipped in CI.

## Future: Full Duplex Voice Conversation

The current design operates in TTS-only mode (text in → speech out, one direction). The Grok Voice Agent API supports bidirectional audio with `server_vad` turn detection. When the web UI adds conversational voice:

- Enable `server_vad` turn detection on the session
- Pipe microphone PCM input through the existing WebSocket
- Process both input audio and output audio streams
- The persistent connection with idle eviction pattern is designed with this upgrade path in mind

This is explicitly deferred — the WebSocket architecture is forward-compatible without overbuilding now.

## Dependencies

No new npm packages required. The Grok Voice Agent API is accessed via the `ws` package (already available via Bun's WebSocket support). Audio playback uses OS-native commands.

## MCU Concept Update

Add to the MCU concept mapping: **Vox = voice** (Friday's speech output, the mouth to Sensorium's eyes and Cortex's brain).
