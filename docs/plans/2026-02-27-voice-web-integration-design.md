# Voice Web Integration & Singleton Runtime Design

**Date**: 2026-02-27
**Status**: Approved
**Scope**: Singleton FridayRuntime, Cortex-mediated voice pipeline, ttyd terminal integration, web app restructure

---

## Overview

Transform the Friday web application from a React chat UI + voice demo into a production voice interface backed by a singleton FridayRuntime. The web chat UI is replaced by ttyd (terminal over the web), and the voice mode connects to the Grok Voice Agent API through FridayRuntime for full-duplex voice conversations with Cortex reasoning.

### Key decisions

1. **Singleton runtime** — one FridayRuntime instance shared across all clients (web voice, ttyd terminal, local CLI)
2. **Backend proxy** — browser never touches the xAI API key; all Grok communication goes through FridayRuntime
3. **Cortex-mediated voice** — Grok handles STT and TTS only; all reasoning goes through Cortex with full tool/memory/SMARTS access
4. **ttyd replaces web chat** — the real OpenTUI terminal runs in the browser via ttyd iframe
5. **Unix socket IPC** — `friday chat` detects a running `friday serve` and connects to the shared runtime via `~/.friday/friday.sock`
6. **Raw audio streaming** — browser captures mic via Web Audio API, streams PCM to backend via binary WebSocket frames

---

## Architecture

```
┌─────────────────── Web Application ───────────────────┐
│                                                        │
│  ┌─── Terminal Mode (/) ───┐  ┌─── Voice Mode ────┐   │
│  │  ttyd iframe             │  │  VoiceOrb canvas  │   │
│  │  (full Friday TUI)       │  │  VoiceStatus      │   │
│  │  runs: friday chat       │  │  VoiceControls    │   │
│  │                          │  │  Audio pipeline   │   │
│  └──────────────────────────┘  └──────────────────┘   │
│         ↕ (ttyd WS)              ↕ (Friday WS /ws)    │
└────────────────────────────────────────────────────────┘
         ↕                              ↕
┌────────────── FridayServer (singleton) ───────────────┐
│  FridayRuntime (one instance)                         │
│  ├── Cortex (LLM brain, tools, SMARTS, recall)       │
│  ├── VoiceBridge (Grok Realtime WebSocket)            │
│  ├── Memory, Sensorium, Modules, Arc Rhythm...        │
│  ├── ClientRegistry (tracks all connected clients)    │
│  └── Unix socket (~/.friday/friday.sock)              │
│       ├── ttyd-spawned `friday chat` connects here    │
│       └── any local `friday chat` connects here       │
└───────────────────────────────────────────────────────┘
```

---

## 1. Singleton Runtime & Client Registry

### Current behavior

`src/server/index.ts` creates a new `FridayRuntime` per WebSocket connection. Each browser tab gets its own runtime, memory, and Cortex instance.

### New behavior

`friday serve` boots **one** FridayRuntime at server startup. All WebSocket clients connect to this shared runtime. A `ClientRegistry` tracks connected clients and fans out events.

### ClientRegistry

```typescript
// src/server/client-registry.ts

interface RegisteredClient {
  id: string;
  clientType: "chat" | "voice" | "tui";
  send: SendFn;
  capabilities: Set<string>; // "audio-in", "audio-out", "text"
}

class ClientRegistry {
  register(client: RegisteredClient): void;
  unregister(id: string): void;
  broadcast(msg: ServerMessage, filter?: (c: RegisteredClient) => boolean): void;
  getByType(type: string): RegisteredClient[];
  get count(): number;
}
```

### Protocol additions

**Client → Server**:
```typescript
| { type: "session:identify"; id: string; clientType: "chat" | "voice" | "tui" }
```

**Server → Client**:
```typescript
| { type: "session:ready"; requestId: string; provider: string; model: string; capabilities: string[] }
```

### Server boot sequence

1. Create FridayRuntime
2. Boot runtime (all subsystems)
3. Create ClientRegistry
4. Start Bun.serve() — WebSocket connections register in ClientRegistry
5. Open Unix socket at `~/.friday/friday.sock`
6. Spawn ttyd child process

### Changes

- `src/server/index.ts`: Boot runtime once at startup, pass to all connections
- `src/server/client-registry.ts`: New file
- `src/server/handler.ts`: Refactor — shared runtime, client registry reference
- `src/server/protocol.ts`: Add `session:identify`, `session:ready`

---

## 2. Unix Socket IPC

### Purpose

Allow any `friday chat` process (including those spawned by ttyd) to connect to the singleton runtime instead of booting a standalone one.

### Socket lifecycle

- `friday serve` creates `~/.friday/friday.sock` and writes `~/.friday/friday.pid`
- Socket + PID cleaned up on shutdown (SIGTERM/SIGINT handler)
- Stale socket detection: `friday chat` validates PID is alive before connecting

### RuntimeBridge interface

```typescript
// src/core/bridges/types.ts

interface RuntimeBridge {
  chat(content: string): AsyncIterable<string>;  // stream text chunks
  process(input: string): Promise<{ output: string; source: string }>;
  isBooted(): boolean;
  shutdown(): Promise<void>;
}
```

Two implementations:
- `LocalBridge` — direct runtime calls (current standalone behavior)
- `SocketBridge` — IPC to singleton via Unix socket

### friday chat startup flow

```
1. Check: does ~/.friday/friday.sock exist?
2. If yes: validate PID → create SocketBridge → connect
3. If no: create FridayRuntime → create LocalBridge → boot standalone
4. Pass bridge to TUI's FridayApp
```

### Socket protocol

Newline-delimited JSON using the same `ClientMessage`/`ServerMessage` types from `src/server/protocol.ts`.

### Files

- `src/server/socket.ts`: Unix socket server (listens, accepts, routes messages)
- `src/core/bridges/types.ts`: RuntimeBridge interface
- `src/core/bridges/local.ts`: LocalBridge (direct runtime calls)
- `src/core/bridges/socket.ts`: SocketBridge (IPC client)
- `src/cli/commands/chat.ts`: Updated startup — detect socket, select bridge

---

## 3. ttyd Integration

### How it works

`friday serve` spawns ttyd as a child process. ttyd runs `friday chat`, which detects the Unix socket and connects to the singleton runtime. The browser embeds ttyd in an iframe.

### ttyd configuration

```bash
ttyd \
  --port 7681 \
  --writable \
  --base-path /terminal \
  -t "titleFixed=F.R.I.D.A.Y." \
  -t 'theme={"background":"#0D1117","foreground":"#F0E6D8","cursor":"#E8943A"}' \
  -t "fontSize=14" \
  friday chat
```

### Web component

```tsx
// web/src/components/terminal/TerminalEmbed.tsx
function TerminalEmbed({ src }: { src: string }) {
  return (
    <iframe
      src={src}
      className="w-full h-full border-none"
      title="Friday Terminal"
      allow="clipboard-read; clipboard-write"
    />
  );
}
```

### Serve command updates

`friday serve` spawns ttyd alongside the HTTP server:
1. Check ttyd is installed (`which ttyd`)
2. Spawn with configuration above
3. Track child process for cleanup on shutdown
4. Reverse proxy or direct iframe to ttyd port

### Files removed (web chat)

```
web/src/components/chat/       — ChatPanel, MessageList, etc.
web/src/components/layout/     — Layout, Sidebar, Header
web/src/contexts/ChatContext.tsx
web/src/hooks/useChat.ts
web/src/components/AutoBoot.tsx
```

---

## 4. Voice Conversation Pipeline (Cortex-Mediated)

### Data flow

```
Browser Mic                                              Browser Speaker
    │                                                          ▲
    │ PCM audio (binary WS frames)                             │ PCM audio (binary WS frames)
    ▼                                                          │
┌─── FridayServer (/ws, voice client) ─────────────────────────┐
│                                                               │
│  1. Receive binary audio → base64 encode                     │
│  2. Forward to Grok: input_audio_buffer.append               │
│  3. Grok VAD detects speech end                              │
│  4. Grok transcribes → conversation.item.created             │
│  5. Transcript → Cortex.chatStream(transcript)               │
│  6. Cortex responds (with tools, SMARTS, recall)             │
│  7. Cortex text → Grok TTS:                                 │
│     conversation.item.create + response.create(["audio"])    │
│  8. Grok streams audio:                                      │
│     response.output_audio.delta → binary → browser           │
│  9. Grok streams transcript:                                 │
│     response.output_audio_transcript.delta → JSON → browser  │
│ 10. Inject user + assistant transcripts into history          │
│     → broadcast conversation:message to all clients          │
└───────────────────────────────────────────────────────────────┘
```

### VoiceBridge class

```typescript
// src/core/voice/bridge.ts

interface VoiceBridgeConfig {
  voice: GrokVoice;
  sampleRate: number;          // 48000 (match browser native)
  instructions: string;        // FRIDAY_VOICE_IDENTITY for TTS
}

interface VoiceBridgeCallbacks {
  onAudioDelta: (base64: string) => void;       // PCM chunk for browser playback
  onTranscriptDelta: (text: string, done: boolean) => void;  // real-time transcript
  onStateChange: (state: VoiceState) => void;   // idle/listening/thinking/speaking/error
  onUserTranscript: (text: string) => void;     // completed user speech transcript
}

class VoiceBridge {
  private grokWs: WebSocket | null = null;
  private cortex: Cortex;
  private config: VoiceBridgeConfig;
  private callbacks: VoiceBridgeCallbacks;
  private active = false;

  constructor(cortex: Cortex, config: VoiceBridgeConfig, callbacks: VoiceBridgeCallbacks);

  async start(): Promise<void>;       // Open Grok WS, configure session
  appendAudio(pcmBase64: string): void;  // Forward mic audio to Grok
  async stop(): Promise<void>;        // Close Grok WS

  private handleGrokMessage(data: unknown): Promise<void>;
  private async processThroughCortex(transcript: string): Promise<void>;
  private sendToGrokTts(text: string): void;
}
```

### Grok session configuration

```json
{
  "type": "session.update",
  "session": {
    "voice": "Eve",
    "instructions": "<FRIDAY_VOICE_IDENTITY for TTS only>",
    "turn_detection": { "type": "server_vad" },
    "audio": {
      "input": { "format": { "type": "audio/pcm", "rate": 48000 } },
      "output": { "format": { "type": "audio/pcm", "rate": 48000 } }
    }
  }
}
```

### Cortex integration

When Grok transcribes user speech:
1. VoiceBridge receives transcript text
2. Calls `cortex.chatStream(transcript)` — full reasoning with tools, SMARTS, recall
3. Collects full text response
4. Sends response to Grok for TTS via `conversation.item.create` + `response.create`
5. Injects both user and assistant messages into conversation history

### Relationship to existing Vox

- **Vox stays**: continues to handle CLI TTS-only mode (text → Grok → local audio playback)
- **VoiceBridge is new**: handles full-duplex voice for web clients
- Both share `FRIDAY_VOICE_IDENTITY`, `buildTtsPrompt()`, and Grok API patterns

### Constraints

- Only one active voice session at a time. Second client receives `voice:error { code: "SESSION_IN_USE" }`
- Barge-in: if user speaks while Friday is speaking, Grok's VAD detects it → server sends `response.cancel` → new turn begins

### Files

- `src/core/voice/bridge.ts`: New VoiceBridge class
- `src/server/handler.ts`: Handle binary audio frames, voice lifecycle messages
- `src/server/protocol.ts`: Voice message types

---

## 5. Browser Audio Pipeline

### Mic capture (Web Audio API)

```typescript
// web/src/audio/pcm-worklet.ts (AudioWorklet processor)
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0]; // mono channel
    if (!input) return true;
    // Convert Float32 → Int16 PCM little-endian
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
```

**Capture chain**: `getUserMedia` → `AudioContext(48kHz)` → `MediaStreamSource` → `AudioWorkletNode` → PCM chunks → binary WebSocket frames

### Audio playback

Receive base64 PCM chunks from server, decode, queue for gapless playback:

```typescript
// Playback scheduling in useVoiceAudio.ts
function queueAudioChunk(base64: string) {
  const pcm = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const float32 = pcmToFloat32(pcm);  // Int16 LE → Float32
  const buffer = audioContext.createBuffer(1, float32.length, 48000);
  buffer.getChannelData(0).set(float32);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;
}
```

### useVoiceAudio hook

```typescript
// web/src/hooks/useVoiceAudio.ts
interface UseVoiceAudioReturn {
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  isCapturing: boolean;
  micLevel: number;           // 0–1, drives orb reactivity
  playAudio: (pcmBase64: string) => void;
  stopPlayback: () => void;
}
```

### useVoiceSession hook

Replaces the demo-mode `useVoiceState`. Manages real voice lifecycle over WebSocket:

```typescript
// web/src/hooks/useVoiceSession.ts
interface UseVoiceSessionReturn {
  state: VoiceState;          // idle | listening | thinking | speaking | error
  statusText: string;         // real transcript (typewriter from deltas)
  isConnected: boolean;
  voiceMode: "on" | "whisper";
  startSession: () => void;   // sends voice:start
  endSession: () => void;     // sends voice:stop
  setMode: (mode: "on" | "whisper") => void;
  toggleMute: () => void;     // pauses mic capture locally
}
```

### Files

- `web/src/audio/pcm-worklet.ts`: AudioWorklet mic capture processor
- `web/src/hooks/useVoiceAudio.ts`: Mic capture + audio playback
- `web/src/hooks/useVoiceSession.ts`: Voice lifecycle over WebSocket
- `web/src/contexts/VoiceSessionContext.tsx`: Voice session provider
- `web/src/components/voice/VoiceMode.tsx`: Updated — real voice, no demo
- `web/src/components/voice/VoiceControls.tsx`: Updated — real controls

---

## 6. Extended WebSocket Protocol

### Client → Server (new voice messages)

```typescript
| { type: "session:identify"; id: string; clientType: "chat" | "voice" | "tui" }
| { type: "voice:start"; id: string; voice?: GrokVoice }
| { type: "voice:stop"; id: string }
| { type: "voice:mode"; id: string; mode: "on" | "whisper" }
// Binary frames: raw PCM audio (ArrayBuffer, not JSON)
```

### Server → Client (new voice messages)

```typescript
| { type: "session:ready"; requestId: string; provider: string; model: string; capabilities: string[] }
| { type: "voice:state"; state: "idle" | "listening" | "thinking" | "speaking" | "error" }
| { type: "voice:transcript"; role: "user" | "assistant"; delta: string; done: boolean }
| { type: "voice:audio"; delta: string }  // base64 PCM for browser playback
| { type: "voice:started"; requestId: string }
| { type: "voice:stopped"; requestId: string }
| { type: "voice:error"; code: string; message: string }
| { type: "conversation:message"; role: "user" | "assistant"; content: string; source: "voice" | "chat" | "tui" }
```

### Binary frame handling

```typescript
// In server websocket handler
async message(ws, message) {
  if (message instanceof Buffer) {
    // Binary = audio from voice client
    ws.data.handler.handleAudio(message);
    return;
  }
  // Text = JSON protocol message
  await ws.data.handler.handle(message.toString(), send);
}
```

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| No mic permission | VoiceMode shows permission overlay, graceful fallback |
| XAI_API_KEY missing | Voice mode disabled, status shows "Voice unavailable" |
| Grok WS disconnect | VoiceBridge reconnects with backoff, state → error |
| Multiple voice clients | Second client gets `voice:error { code: "SESSION_IN_USE" }` |
| Cortex tool call during voice | State → "thinking", orb shows copper animation |
| Barge-in (user speaks during TTS) | Grok VAD detects → server sends `response.cancel` → new turn |
| ttyd not installed | `friday serve` warns and runs without terminal mode |
| Stale Unix socket | `friday chat` validates PID, cleans up stale socket |

---

## 8. Implementation Phases

### Phase 1: Singleton Runtime + Client Registry
- Refactor `src/server/index.ts` — boot one runtime at startup
- Create `src/server/client-registry.ts`
- Update `src/server/handler.ts` — shared runtime
- Add `session:identify` / `session:ready` to protocol
- Tests: multiple clients share one runtime

### Phase 2: Unix Socket IPC
- Create `src/server/socket.ts` — Unix socket server
- Create `src/core/bridges/` — RuntimeBridge, LocalBridge, SocketBridge
- Update `friday chat` startup — detect socket, select bridge
- Update TUI FridayApp — use RuntimeBridge
- Tests: `friday serve` + `friday chat` share runtime

### Phase 3: ttyd Integration
- Add ttyd spawn to `friday serve`
- Create `web/src/components/terminal/TerminalEmbed.tsx`
- Remove web chat components (ChatPanel, Layout, Sidebar, ChatContext, useChat, AutoBoot)
- Update `web/src/App.tsx` routing
- Tests: browser loads terminal via ttyd

### Phase 4: VoiceBridge Backend
- Create `src/core/voice/bridge.ts`
- Add voice message types to protocol
- Handle binary audio frames in server
- Wire VoiceBridge → Cortex (STT → reasoning → TTS)
- Inject voice transcripts into conversation history
- Tests: voice round-trip with Cortex reasoning

### Phase 5: Browser Audio Pipeline
- Create `web/src/audio/pcm-worklet.ts`
- Create `web/src/hooks/useVoiceAudio.ts`
- Create `web/src/hooks/useVoiceSession.ts`
- Evolve VoiceMode from demo to real voice
- Tests: end-to-end mic → Friday → speaker

### Phase 6: Cross-Client Sync
- Broadcast conversation updates to all clients
- Voice transcripts appear in terminal TUI
- Tests: speak in voice, see transcript in terminal

---

## MCU Concept Mapping

- **VoiceBridge** = Friday's ear + mouth (bidirectional voice via Grok)
- **ClientRegistry** = J.A.R.V.I.S. awareness of which rooms/suits are active
- **RuntimeBridge** = the comms link between any interface and the central AI
- **Unix socket** = the secure internal comm channel (like Stark Tower's closed network)
- **ttyd terminal** = the lab workstation interface
- **Voice mode** = the suit HUD / ambient room interface
