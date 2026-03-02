# Voice-Cortex Narration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the VoiceBridge stream Cortex responses to Grok TTS progressively, speak a quick acknowledgment before processing, and narrate tool executions with FRIDAY personality.

**Architecture:** Enhance `VoiceBridge` with a sequential TTS queue gated by Grok's `response.done`. Add a `NarrationPicker` utility for shuffle-cycled phrase selection. Subscribe to `tool:executing` signals for delayed narration. All TTS segments (acks, sentences, narrations) flow through the same FIFO queue.

**Tech Stack:** TypeScript, Bun, bun:test, AI SDK v6 (streamText), Grok Realtime API (OpenAI-compatible WebSocket)

**Design Doc:** `docs/plans/2026-03-01-voice-cortex-narration-design.md`

---

### Task 1: NarrationPicker — Failing Tests

**Files:**
- Create: `tests/unit/voice-narration.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from "bun:test";
import { NarrationPicker, ACK_PHRASES, TOOL_NARRATIONS, GENERIC_NARRATIONS } from "../../src/core/voice/narration.ts";

describe("NarrationPicker", () => {
  test("returns items from the source array", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    const result = picker.next();
    expect(phrases).toContain(result);
  });

  test("cycles through all items before repeating", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      seen.add(picker.next());
    }
    expect(seen.size).toBe(3);
  });

  test("re-shuffles after exhausting the pool", () => {
    const phrases = ["a", "b", "c"];
    const picker = new NarrationPicker(phrases);
    // Exhaust first cycle
    for (let i = 0; i < 3; i++) picker.next();
    // Should still return valid items in second cycle
    const result = picker.next();
    expect(phrases).toContain(result);
  });

  test("does not repeat the last item of cycle as first item of next cycle", () => {
    // With only 2 items, if last of cycle 1 === first of cycle 2, it's a repeat
    const phrases = ["a", "b"];
    const picker = new NarrationPicker(phrases);
    const results: string[] = [];
    for (let i = 0; i < 20; i++) {
      results.push(picker.next());
    }
    // Check no consecutive duplicates
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).not.toBe(results[i - 1]);
    }
  });

  test("handles single-item array", () => {
    const picker = new NarrationPicker(["only"]);
    expect(picker.next()).toBe("only");
    expect(picker.next()).toBe("only");
  });
});

describe("ACK_PHRASES", () => {
  test("has at least 30 phrases", () => {
    expect(ACK_PHRASES.length).toBeGreaterThanOrEqual(30);
  });

  test("no duplicates", () => {
    const unique = new Set(ACK_PHRASES);
    expect(unique.size).toBe(ACK_PHRASES.length);
  });

  test("no phrases contain possessive 'your'", () => {
    for (const phrase of ACK_PHRASES) {
      expect(phrase.toLowerCase()).not.toContain("your");
    }
  });
});

describe("TOOL_NARRATIONS", () => {
  test("covers core tools", () => {
    const expectedTools = [
      "git.status", "git.diff", "git.log",
      "docker.ps", "docker.logs",
      "fs.read", "fs.write",
      "bash.exec",
      "recall_memory",
      "web_fetch",
      "getEnvironmentStatus",
    ];
    for (const tool of expectedTools) {
      expect(TOOL_NARRATIONS[tool]).toBeDefined();
      expect(TOOL_NARRATIONS[tool]!.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("no phrases contain possessive 'your'", () => {
    for (const [, phrases] of Object.entries(TOOL_NARRATIONS)) {
      for (const phrase of phrases) {
        expect(phrase.toLowerCase()).not.toContain("your");
      }
    }
  });
});

describe("GENERIC_NARRATIONS", () => {
  test("has at least 5 fallback phrases", () => {
    expect(GENERIC_NARRATIONS.length).toBeGreaterThanOrEqual(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/voice-narration.test.ts`
Expected: FAIL — module `../../src/core/voice/narration.ts` not found

---

### Task 2: NarrationPicker — Implementation

**Files:**
- Create: `src/core/voice/narration.ts`

**Step 1: Write the implementation**

```typescript
/**
 * Fisher-Yates shuffle-then-cycle phrase picker.
 * Guarantees no consecutive repeats across cycle boundaries.
 */
export class NarrationPicker {
  private readonly source: readonly string[];
  private shuffled: string[] = [];
  private index = 0;
  private lastPicked: string | null = null;

  constructor(source: readonly string[]) {
    this.source = source;
    this.reshuffle();
  }

  next(): string {
    if (this.source.length === 0) return "";
    if (this.source.length === 1) return this.source[0]!;

    if (this.index >= this.shuffled.length) {
      this.reshuffle();
      // Avoid repeating the last item from the previous cycle
      if (this.shuffled[0] === this.lastPicked) {
        // Swap first with a random later position
        const swapIdx = 1 + Math.floor(Math.random() * (this.shuffled.length - 1));
        [this.shuffled[0], this.shuffled[swapIdx]] = [this.shuffled[swapIdx]!, this.shuffled[0]!];
      }
    }

    const picked = this.shuffled[this.index]!;
    this.index++;
    this.lastPicked = picked;
    return picked;
  }

  private reshuffle(): void {
    this.shuffled = [...this.source];
    // Fisher-Yates shuffle
    for (let i = this.shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffled[i], this.shuffled[j]] = [this.shuffled[j]!, this.shuffled[i]!];
    }
    this.index = 0;
  }
}

export const ACK_PHRASES: readonly string[] = [
  "On it, boss.",
  "Consider it done.",
  "Let me pull that up.",
  "Right away.",
  "I'm on the case.",
  "Leave it with me.",
  "Checking now.",
  "One moment.",
  "Working on that.",
  "Let me take a look.",
  "I'll sort that out.",
  "Give me a second.",
  "Straight away.",
  "On the case.",
  "Let me see what I can do.",
  "I'll handle it.",
  "Absolutely.",
  "Right so.",
  "Let me dig into that.",
  "Coming right up.",
  "I'll get right on it.",
  "Noted — looking into it.",
  "Already on it.",
  "Let me run that down.",
  "Say no more.",
  "Grand — I'll check that.",
  "One sec, boss.",
  "I'm all over it.",
  "Let me have a look.",
  "I'll see what we've got.",
];

export const TOOL_NARRATIONS: Record<string, readonly string[]> = {
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
  "git.log": [
    "Digging through the commit history...",
    "Let me trace back through the timeline...",
    "Checking the logs — always good to know where we've been...",
  ],
  "git.branch": [
    "Checking the branches...",
    "Let me see what branches are in play...",
    "Looking at the branch layout...",
  ],
  "git.stash": [
    "Checking the stash...",
    "Let me see what's tucked away...",
    "Looking at stashed changes...",
  ],
  "git.push": [
    "Pushing that up now...",
    "Sending changes upstream...",
    "Pushing to the remote...",
  ],
  "git.pull": [
    "Pulling in the latest...",
    "Let me grab the upstream changes...",
    "Syncing with remote...",
  ],
  "docker.ps": [
    "Checking what's running in the containers...",
    "Let me see what Docker's got going on...",
    "Peeking under the hood at the containers...",
  ],
  "docker.logs": [
    "Reading the container logs — let's see what's been happening...",
    "Pulling up those logs now...",
    "Checking what the container's been up to...",
  ],
  "docker.inspect": [
    "Inspecting the container details...",
    "Let me get a closer look at that container...",
    "Pulling up the full container spec...",
  ],
  "docker.stats": [
    "Checking container resource usage...",
    "Let me pull up the stats...",
    "Looking at how the containers are performing...",
  ],
  "docker.exec": [
    "Running a command inside the container...",
    "Executing in the container now...",
    "Hopping into the container to run that...",
  ],
  "fs.read": [
    "Reading that file now...",
    "Let me take a look at that...",
    "Pulling up the file...",
    "Opening that up...",
  ],
  "fs.write": [
    "Writing that out now...",
    "Saving changes...",
    "Putting that down on disk...",
  ],
  "fs.list": [
    "Listing the directory contents...",
    "Let me see what's in there...",
    "Browsing the file system...",
  ],
  "fs.delete": [
    "Removing that file...",
    "Deleting now...",
    "Taking care of that removal...",
  ],
  "bash.exec": [
    "Running that command now...",
    "Executing — fingers crossed...",
    "Let me fire that off...",
    "On it — running the command...",
  ],
  "recall_memory": [
    "Let me check my memory on that...",
    "Searching through past conversations...",
    "I think I remember something about this — let me look...",
    "Digging through the archives...",
  ],
  "web_fetch": [
    "Fetching that from the web...",
    "Let me grab that...",
    "Reaching out to the internet...",
  ],
  "getEnvironmentStatus": [
    "Running a systems scan...",
    "Checking the vitals...",
    "Let me see how everything's running...",
  ],
  "manage_rhythm": [
    "Adjusting the scheduler...",
    "Updating the rhythm...",
    "Tweaking the schedule...",
  ],
  "gmail.search": [
    "Searching through the inbox...",
    "Let me dig through the emails...",
    "Looking for that in the mail...",
  ],
  "gmail.read": [
    "Opening up that email...",
    "Let me read that...",
    "Pulling up the message...",
  ],
  "gmail.send": [
    "Sending that off now...",
    "Firing off the email...",
    "Message away...",
  ],
  "gmail.reply": [
    "Drafting the reply...",
    "Sending that reply now...",
    "Replying to the thread...",
  ],
  "gmail.modify": [
    "Updating the email labels...",
    "Modifying that message...",
    "Making those changes to the email...",
  ],
};

export const GENERIC_NARRATIONS: readonly string[] = [
  "Working on something here, one moment...",
  "Processing that...",
  "Crunching through this — bear with me...",
  "Hold that thought, I'm on it...",
  "Just need a moment on this one...",
];

/** Get a tool-specific narration, or fall back to generic. */
export function getToolNarration(toolName: string, toolPickers: Map<string, NarrationPicker>, genericPicker: NarrationPicker): string {
  const phrases = TOOL_NARRATIONS[toolName];
  if (phrases) {
    if (!toolPickers.has(toolName)) {
      toolPickers.set(toolName, new NarrationPicker(phrases));
    }
    return toolPickers.get(toolName)!.next();
  }
  return genericPicker.next();
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/voice-narration.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/voice/narration.ts tests/unit/voice-narration.test.ts
git commit -m "feat(voice): add NarrationPicker, ack phrases, and tool narrations"
```

---

### Task 3: Add SignalBus to VoiceBridgeConfig

**Files:**
- Modify: `src/core/voice/bridge.ts:1-11` (imports and config interface)
- Modify: `src/server/handler.ts:311-315` (voice config construction)
- Modify: `tests/unit/voice-bridge.test.ts:16-21` (test config)

**Step 1: Update VoiceBridgeConfig in bridge.ts**

Add `signals` import and config field. In `src/core/voice/bridge.ts`, change lines 1-11:

```typescript
import type { Cortex } from "../cortex.ts";
import { type GrokVoice, VOX_WS_URL } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";
import type { SignalBus, SignalHandler } from "../events.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceBridgeConfig {
  voice: GrokVoice;
  sampleRate: number;
  instructions: string;
  signals?: SignalBus;
}
```

**Step 2: Update handler.ts to pass signals**

In `src/server/handler.ts`, change the `voiceConfig` construction at lines 311-315:

```typescript
				const voiceConfig: VoiceBridgeConfig = {
					voice,
					sampleRate: 48000,
					instructions: FRIDAY_VOICE_IDENTITY,
					signals: this.runtime.signals,
				};
```

**Step 3: Run existing tests**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: All pass (signals is optional)

**Step 4: Commit**

```bash
git add src/core/voice/bridge.ts src/server/handler.ts
git commit -m "feat(voice): add optional SignalBus to VoiceBridgeConfig"
```

---

### Task 4: TTS Queue and Response Gating — Failing Tests

**Files:**
- Modify: `tests/unit/voice-bridge.test.ts`

**Step 1: Add failing tests for TTS queue behavior**

Append to `tests/unit/voice-bridge.test.ts`:

```typescript
import { SignalBus } from "../../src/core/events.ts";

describe("VoiceBridge TTS queue", () => {
  function createBridgeWithMockWs() {
    const cortex = {} as any;
    const signals = new SignalBus();
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
      signals,
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    const messages: string[] = [];
    (bridge as any).grokWs = {
      send: (data: string) => messages.push(data),
      readyState: 1,
    };
    (bridge as any).active = true;

    return { bridge, messages, callbacks, signals };
  }

  test("enqueueTts adds to the queue", () => {
    const { bridge } = createBridgeWithMockWs();
    (bridge as any).enqueueTts("Hello");
    expect((bridge as any).ttsQueue).toHaveLength(1);
  });

  test("flushQueue sends first item when no response in flight", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any).enqueueTts("Hello");
    (bridge as any).flushQueue();
    // Should have sent session.update + conversation.item.create + response.create
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect((bridge as any)._responseInFlight).toBe(true);
  });

  test("flushQueue does not send when response is in flight", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any)._responseInFlight = true;
    (bridge as any).enqueueTts("Hello");
    (bridge as any).flushQueue();
    expect(messages).toHaveLength(0);
  });

  test("response.done clears gate and flushes next item", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any).enqueueTts("First");
    (bridge as any).enqueueTts("Second");
    (bridge as any).flushQueue();
    const firstBatchCount = messages.length;
    expect((bridge as any)._responseInFlight).toBe(true);

    // Simulate response.done from Grok
    (bridge as any).handleGrokMessage(JSON.stringify({ type: "response.done" }));
    // Should have sent the second item now
    expect(messages.length).toBeGreaterThan(firstBatchCount);
  });
});

describe("VoiceBridge sentence buffering", () => {
  test("isSentenceBoundary detects period", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    expect((bridge as any).isSentenceBoundary("Hello world.")).toBe(true);
  });

  test("isSentenceBoundary detects question mark", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    expect((bridge as any).isSentenceBoundary("How are you?")).toBe(true);
  });

  test("isSentenceBoundary detects exclamation", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    expect((bridge as any).isSentenceBoundary("Wow!")).toBe(true);
  });

  test("isSentenceBoundary detects newline", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    expect((bridge as any).isSentenceBoundary("Line one\n")).toBe(true);
  });

  test("isSentenceBoundary returns false for partial text", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    expect((bridge as any).isSentenceBoundary("Hello wor")).toBe(false);
  });

  test("isSentenceBoundary triggers on buffer overflow (>200 chars)", () => {
    const bridge = new VoiceBridge({} as any, { voice: "Eve", sampleRate: 48000, instructions: "" }, makeMockCallbacks());
    const longText = "a".repeat(201);
    expect((bridge as any).isSentenceBoundary(longText)).toBe(true);
  });
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: FAIL — `enqueueTts`, `flushQueue`, `isSentenceBoundary` not defined

---

### Task 5: TTS Queue and Response Gating — Implementation

**Files:**
- Modify: `src/core/voice/bridge.ts`

**Step 1: Add queue infrastructure to VoiceBridge**

In `src/core/voice/bridge.ts`, add imports at line 4 and new private fields after line 27, and new methods:

Add import at top:
```typescript
import { NarrationPicker, ACK_PHRASES, getToolNarration, GENERIC_NARRATIONS } from "./narration.ts";
```

Add private fields after `private userTranscriptBuffer = "";` (line 27):
```typescript
  private ttsQueue: string[] = [];
  private _responseInFlight = false;
  private ackPicker = new NarrationPicker(ACK_PHRASES);
  private toolPickers = new Map<string, NarrationPicker>();
  private genericNarrationPicker = new NarrationPicker(GENERIC_NARRATIONS);
  private toolSignalHandler: SignalHandler | null = null;
  private cortexStartTime = 0;
  private lastNarrationTime = 0;
```

Add new methods before the existing `processThroughCortex`:

```typescript
  private enqueueTts(text: string): void {
    this.ttsQueue.push(text);
    this.flushQueue();
  }

  private flushQueue(): void {
    if (this._responseInFlight || this.ttsQueue.length === 0) return;
    if (!this.grokWs || this.grokWs.readyState !== 1) return;

    const text = this.ttsQueue.shift()!;
    this._responseInFlight = true;
    this.sendToGrokTts(text);
  }

  private isSentenceBoundary(buffer: string): boolean {
    if (buffer.length > 200) return true;
    return /[.!?\n]\s*$/.test(buffer);
  }
```

**Step 2: Update handleGrokMessage to clear the response gate**

In the `response.done` case (currently line 195-198), change to:

```typescript
      case "response.done": {
        this._responseInFlight = false;
        this.flushQueue();
        if (this.ttsQueue.length === 0) {
          this.callbacks.onStateChange("idle");
        }
        break;
      }
```

**Step 3: Run tests**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add src/core/voice/bridge.ts tests/unit/voice-bridge.test.ts
git commit -m "feat(voice): add TTS queue with response.done gating"
```

---

### Task 6: Streaming processThroughCortex — Failing Tests

**Files:**
- Modify: `tests/unit/voice-bridge.test.ts`

**Step 1: Add failing tests for streaming behavior**

```typescript
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel } from "../helpers/stubs.ts";

describe("VoiceBridge streaming processThroughCortex", () => {
  test("sends ack before cortex response", async () => {
    const model = createMockModel({ text: "Hello there." });
    const cortex = new Cortex({ injectedModel: model });
    const signals = new SignalBus();
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
      signals,
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    const messages: string[] = [];
    (bridge as any).grokWs = { send: (d: string) => messages.push(d), readyState: 1 };
    (bridge as any).active = true;

    // Simulate response.done for each TTS segment so the queue advances
    const origSend = (bridge as any).grokWs.send;
    (bridge as any).grokWs.send = (d: string) => {
      origSend(d);
      const parsed = JSON.parse(d);
      if (parsed.type === "response.create") {
        // Auto-complete the response
        setTimeout(() => {
          (bridge as any).handleGrokMessage(JSON.stringify({ type: "response.done" }));
        }, 0);
      }
    };

    await (bridge as any).processThroughCortex("What is the status?");

    // First conversation.item.create should be an ack phrase (before cortex response)
    const itemCreates = messages
      .map((m) => JSON.parse(m))
      .filter((m: any) => m.type === "conversation.item.create");

    expect(itemCreates.length).toBeGreaterThanOrEqual(2); // ack + at least one response chunk
    // First item should be an ack phrase (short, from ACK_PHRASES pool)
    const firstText = itemCreates[0]?.item?.content?.[0]?.text;
    expect(typeof firstText).toBe("string");
    expect(firstText.length).toBeLessThan(40); // ack phrases are short
  });

  test("cortex error speaks error phrase", async () => {
    const cortex = { chatStream: async () => { throw new Error("LLM down"); } } as any;
    const signals = new SignalBus();
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
      signals,
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    const messages: string[] = [];
    (bridge as any).grokWs = {
      send: (d: string) => {
        messages.push(d);
        const parsed = JSON.parse(d);
        if (parsed.type === "response.create") {
          setTimeout(() => {
            (bridge as any).handleGrokMessage(JSON.stringify({ type: "response.done" }));
          }, 0);
        }
      },
      readyState: 1,
    };
    (bridge as any).active = true;

    await (bridge as any).processThroughCortex("Tell me something");

    // Should have sent ack + error phrase
    const itemCreates = messages
      .map((m) => JSON.parse(m))
      .filter((m: any) => m.type === "conversation.item.create");
    expect(itemCreates.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Run to verify failures**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: FAIL — processThroughCortex doesn't send ack

---

### Task 7: Streaming processThroughCortex — Implementation

**Files:**
- Modify: `src/core/voice/bridge.ts`

**Step 1: Rewrite processThroughCortex**

Replace the existing `processThroughCortex` method (lines 207-220) with:

```typescript
  private async processThroughCortex(transcript: string): Promise<void> {
    try {
      this.callbacks.onStateChange("thinking");
      this.cortexStartTime = Date.now();
      this.lastNarrationTime = 0;

      // 1. Immediate ack
      this.enqueueTts(this.ackPicker.next());

      // Wait for ack to be sent (need response.done before cortex chunks flow)
      await this.waitForQueueDrain();

      // 2. Subscribe to tool signals for narration
      this.subscribeToolSignals();

      // 3. Stream cortex response
      const stream = await this.cortex.chatStream(transcript);
      let buffer = "";

      for await (const chunk of stream.textStream) {
        if (!this.active) break;
        buffer += chunk;
        if (this.isSentenceBoundary(buffer)) {
          this.enqueueTts(buffer.trim());
          buffer = "";
        }
      }

      // Flush remaining buffer
      if (buffer.trim() && this.active) {
        this.enqueueTts(buffer.trim());
      }

      // Ensure history is recorded (Cortex pushes to history in fullText handler)
      await stream.fullText;

      // Wait for all TTS to finish
      await this.waitForQueueDrain();
    } catch {
      // Speak error phrase
      this.enqueueTts("Something went wrong on my end — sorry about that.");
      await this.waitForQueueDrain();
    } finally {
      this.unsubscribeToolSignals();
    }
  }

  private subscribeToolSignals(): void {
    if (!this.config.signals || this.toolSignalHandler) return;

    this.toolSignalHandler = (signal) => {
      const elapsed = Date.now() - this.cortexStartTime;
      const sinceLast = Date.now() - this.lastNarrationTime;
      // Only narrate after 2s of processing and at least 5s between narrations
      if (elapsed > 2000 && sinceLast > 5000) {
        this.lastNarrationTime = Date.now();
        const narration = getToolNarration(signal.source, this.toolPickers, this.genericNarrationPicker);
        this.enqueueTts(narration);
      }
    };

    this.config.signals.on("tool:executing", this.toolSignalHandler);
  }

  private unsubscribeToolSignals(): void {
    if (this.config.signals && this.toolSignalHandler) {
      this.config.signals.off("tool:executing", this.toolSignalHandler);
      this.toolSignalHandler = null;
    }
  }

  private waitForQueueDrain(): Promise<void> {
    if (this.ttsQueue.length === 0 && !this._responseInFlight) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const check = () => {
        if ((this.ttsQueue.length === 0 && !this._responseInFlight) || !this.active) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      setTimeout(check, 50);
    });
  }
```

**Step 2: Update stop() to clean up signals and queue**

Replace stop() (lines 125-132) with:

```typescript
  async stop(): Promise<void> {
    this.active = false;
    this.unsubscribeToolSignals();
    this.ttsQueue.length = 0;
    this._responseInFlight = false;
    if (this.grokWs) {
      try { this.grokWs.close(); } catch {}
      this.grokWs = null;
    }
    this.callbacks.onStateChange("idle");
  }
```

**Step 3: Run tests**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: All pass

**Step 4: Run full test suite**

Run: `bun test`
Expected: All existing tests pass (no regressions)

**Step 5: Commit**

```bash
git add src/core/voice/bridge.ts tests/unit/voice-bridge.test.ts
git commit -m "feat(voice): streaming processThroughCortex with ack and tool narration"
```

---

### Task 8: Tool Narration Signal Integration — Failing Test

**Files:**
- Modify: `tests/unit/voice-bridge.test.ts`

**Step 1: Add failing test for tool narration**

```typescript
describe("VoiceBridge tool narration", () => {
  test("narrates tool after 2s delay", async () => {
    const model = createMockModel({ text: "Response text." });
    const cortex = new Cortex({ injectedModel: model });
    const signals = new SignalBus();
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
      signals,
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    const messages: string[] = [];
    (bridge as any).grokWs = {
      send: (d: string) => {
        messages.push(d);
        const parsed = JSON.parse(d);
        if (parsed.type === "response.create") {
          setTimeout(() => {
            (bridge as any).handleGrokMessage(JSON.stringify({ type: "response.done" }));
          }, 0);
        }
      },
      readyState: 1,
    };
    (bridge as any).active = true;

    // Set cortexStartTime to 3s ago to simulate delay
    (bridge as any).cortexStartTime = Date.now() - 3000;
    (bridge as any).lastNarrationTime = 0;
    (bridge as any).subscribeToolSignals();

    // Emit tool:executing signal
    await signals.emit("tool:executing", "git.status", { args: {} });

    // Should have queued a narration
    const queue = (bridge as any).ttsQueue as string[];
    expect(queue.length).toBeGreaterThanOrEqual(1);

    // Clean up
    (bridge as any).unsubscribeToolSignals();
  });

  test("does not narrate tool before 2s threshold", async () => {
    const signals = new SignalBus();
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
      signals,
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge({} as any, config, callbacks);
    (bridge as any).active = true;
    (bridge as any).grokWs = { send: () => {}, readyState: 1 };

    // cortexStartTime = just now (within 2s)
    (bridge as any).cortexStartTime = Date.now();
    (bridge as any).lastNarrationTime = 0;
    (bridge as any).subscribeToolSignals();

    await signals.emit("tool:executing", "git.status", { args: {} });

    const queue = (bridge as any).ttsQueue as string[];
    expect(queue).toHaveLength(0);

    (bridge as any).unsubscribeToolSignals();
  });
});
```

**Step 2: Run to verify**

Run: `bun test tests/unit/voice-bridge.test.ts`
Expected: Should pass if Task 7 implementation is correct (tool narration is already implemented in Task 7). If these tests fail, it indicates a bug in the signal subscription logic to fix.

**Step 3: Commit**

```bash
git add tests/unit/voice-bridge.test.ts
git commit -m "test(voice): add tool narration signal integration tests"
```

---

### Task 9: Cleanup — Lint, Typecheck, Full Suite

**Files:**
- All modified files

**Step 1: Run linter**

Run: `bun run lint:fix`
Expected: Clean (or auto-fixed)

**Step 2: Run type checker**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass, no regressions

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for voice narration"
```

(Skip if nothing to commit.)

---

### Task 10: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add to the Subsystem Map table:

```
| **VoiceBridge** | `src/core/voice/bridge.ts` | Sequential TTS queue gated by `response.done`. Streams Cortex text to Grok TTS sentence-by-sentence. Quick ack + tool narration via SignalBus. |
```

Update the Patterns & Gotchas section with:

```
- **Voice narration**: VoiceBridge uses a sequential TTS queue (FIFO) gated by Grok's `response.done`. Acks are hardcoded phrases (no LLM call). Tool narrations fire after 2s delay with 5s debounce.
```

**Step 2: Run lint**

Run: `bun run lint:fix`
Expected: Clean

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with voice narration subsystem"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | NarrationPicker failing tests | `tests/unit/voice-narration.test.ts` | — |
| 2 | NarrationPicker implementation | `src/core/voice/narration.ts` | — |
| 3 | Add SignalBus to VoiceBridgeConfig | — | `bridge.ts`, `handler.ts` |
| 4 | TTS queue failing tests | — | `voice-bridge.test.ts` |
| 5 | TTS queue implementation | — | `bridge.ts` |
| 6 | Streaming processThroughCortex failing tests | — | `voice-bridge.test.ts` |
| 7 | Streaming processThroughCortex implementation | — | `bridge.ts` |
| 8 | Tool narration signal tests | — | `voice-bridge.test.ts` |
| 9 | Lint, typecheck, full suite | — | all |
| 10 | Documentation update | — | `CLAUDE.md` |
