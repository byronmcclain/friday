import { describe, test, expect, mock } from "bun:test";
import { VoiceBridge, type VoiceBridgeConfig, type VoiceBridgeCallbacks } from "../../src/core/voice/bridge.ts";
import { SignalBus } from "../../src/core/events.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { createMockModel } from "../helpers/stubs.ts";

function makeMockCallbacks(): VoiceBridgeCallbacks {
  return {
    onAudioDelta: mock(() => {}),
    onTranscriptDelta: mock(() => {}),
    onStateChange: mock(() => {}),
    onUserTranscript: mock(() => {}),
  };
}

describe("VoiceBridge", () => {
  test("constructs without error", () => {
    const cortex = {} as any;
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test instructions",
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);
    expect(bridge).toBeDefined();
    expect(bridge.isActive).toBe(false);
  });

  test("sendToGrokTts formats messages correctly", () => {
    const cortex = {} as any;
    const config: VoiceBridgeConfig = {
      voice: "Eve",
      sampleRate: 48000,
      instructions: "Test",
    };
    const callbacks = makeMockCallbacks();
    const bridge = new VoiceBridge(cortex, config, callbacks);

    const messages: string[] = [];
    (bridge as any).grokWs = {
      send: (data: string) => messages.push(data),
      readyState: 1,
    };

    (bridge as any).sendToGrokTts("Hello world");

    // Should send: session.update, conversation.item.create, response.create
    expect(messages).toHaveLength(3);
    const item = JSON.parse(messages[1]!);
    expect(item.type).toBe("conversation.item.create");
    expect(item.item.content[0].text).toBe("Hello world");

    const response = JSON.parse(messages[2]!);
    expect(response.type).toBe("response.create");
    expect(response.response.modalities).toEqual(["audio"]);
  });
});

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
    expect((bridge as any).ttsQueue).toHaveLength(0); // flushed immediately
    expect((bridge as any)._responseInFlight).toBe(true);
  });

  test("flushQueue sends first item when no response in flight", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any).ttsQueue.push("Hello");
    (bridge as any).flushQueue();
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect((bridge as any)._responseInFlight).toBe(true);
  });

  test("flushQueue does not send when response is in flight", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any)._responseInFlight = true;
    (bridge as any).ttsQueue.push("Hello");
    (bridge as any).flushQueue();
    expect(messages).toHaveLength(0);
  });

  test("response.done clears gate and flushes next item", () => {
    const { bridge, messages } = createBridgeWithMockWs();
    (bridge as any).enqueueTts("First");
    (bridge as any).enqueueTts("Second");
    const firstBatchCount = messages.length;
    expect((bridge as any)._responseInFlight).toBe(true);

    // Simulate response.done from Grok
    (bridge as any).handleGrokMessage(JSON.stringify({ type: "response.done" }));
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

    await (bridge as any).processThroughCortex("What is the status?");

    const itemCreates = messages
      .map((m) => JSON.parse(m))
      .filter((m: any) => m.type === "conversation.item.create");

    expect(itemCreates.length).toBeGreaterThanOrEqual(2);
    const firstText = itemCreates[0]?.item?.content?.[0]?.text;
    expect(typeof firstText).toBe("string");
    expect(firstText.length).toBeLessThan(40);
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

    const itemCreates = messages
      .map((m) => JSON.parse(m))
      .filter((m: any) => m.type === "conversation.item.create");
    expect(itemCreates.length).toBeGreaterThanOrEqual(2);
  });
});

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
    // Check either in queue or already sent (flushed)
    const itemCreates = messages
      .map((m) => JSON.parse(m))
      .filter((m: any) => m.type === "conversation.item.create");
    expect(queue.length + itemCreates.length).toBeGreaterThanOrEqual(1);

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
