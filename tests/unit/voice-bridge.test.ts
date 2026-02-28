import { describe, test, expect, mock } from "bun:test";
import { VoiceBridge, type VoiceBridgeConfig, type VoiceBridgeCallbacks } from "../../src/core/voice/bridge.ts";

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
