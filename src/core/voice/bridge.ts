import type { Cortex } from "../cortex.ts";
import type { GrokVoice } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceBridgeConfig {
  voice: GrokVoice;
  sampleRate: number;
  instructions: string;
}

export interface VoiceBridgeCallbacks {
  onAudioDelta: (base64: string) => void;
  onTranscriptDelta: (text: string, done: boolean) => void;
  onStateChange: (state: VoiceState) => void;
  onUserTranscript: (text: string) => void;
}

const WS_URL = "wss://api.x.ai/v1/realtime";

export class VoiceBridge {
  private grokWs: WebSocket | null = null;
  private cortex: Cortex;
  private config: VoiceBridgeConfig;
  private callbacks: VoiceBridgeCallbacks;
  private active = false;
  private userTranscriptBuffer = "";

  constructor(
    cortex: Cortex,
    config: VoiceBridgeConfig,
    callbacks: VoiceBridgeCallbacks,
  ) {
    this.cortex = cortex;
    this.config = config;
    this.callbacks = callbacks;
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) throw new Error("Voice session already active");

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error("XAI_API_KEY not set");

    this.active = true;
    this.callbacks.onStateChange("idle");

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      } as any);

      const timeout = setTimeout(() => {
        reject(new Error("Grok voice connection timeout"));
        try { ws.close(); } catch {}
      }, 10000);

      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        this.grokWs = ws;

        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            voice: this.config.voice,
            instructions: this.config.instructions,
            turn_detection: { type: "server_vad" },
            audio: {
              input: {
                format: { type: "audio/pcm", rate: this.config.sampleRate },
              },
              output: {
                format: { type: "audio/pcm", rate: this.config.sampleRate },
              },
            },
          },
        }));

        this.callbacks.onStateChange("idle");
        resolve();
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          void this.handleGrokMessage(event.data);
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        this.active = false;
        this.callbacks.onStateChange("error");
        reject(new Error("Grok voice connection error"));
      });

      ws.addEventListener("close", () => {
        this.grokWs = null;
        if (this.active) {
          this.active = false;
          this.callbacks.onStateChange("idle");
        }
      });
    });
  }

  appendAudio(pcmBase64: string): void {
    if (!this.grokWs || !this.active) return;
    this.grokWs.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcmBase64,
    }));
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.grokWs) {
      try { this.grokWs.close(); } catch {}
      this.grokWs = null;
    }
    this.callbacks.onStateChange("idle");
  }

  private async handleGrokMessage(raw: string): Promise<void> {
    let data: Record<string, any>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      case "input_audio_buffer.speech_started": {
        this.callbacks.onStateChange("listening");
        this.userTranscriptBuffer = "";
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        this.callbacks.onStateChange("thinking");
        break;
      }

      case "conversation.item.created": {
        if (data.item?.role === "user" && data.item?.content) {
          const textContent = data.item.content.find(
            (c: any) => c.type === "input_text" || c.type === "text",
          );
          if (textContent?.text || textContent?.transcript) {
            const transcript = textContent.text ?? textContent.transcript;
            this.userTranscriptBuffer = transcript;
            this.callbacks.onUserTranscript(transcript);

            await this.processThroughCortex(transcript);
          }
        }
        break;
      }

      case "input_audio_buffer.committed": {
        break;
      }

      case "response.output_audio.delta": {
        if (data.delta) {
          this.callbacks.onStateChange("speaking");
          this.callbacks.onAudioDelta(data.delta);
        }
        break;
      }

      case "response.output_audio_transcript.delta": {
        if (data.delta) {
          this.callbacks.onTranscriptDelta(data.delta, false);
        }
        break;
      }

      case "response.output_audio_transcript.done": {
        this.callbacks.onTranscriptDelta("", true);
        break;
      }

      case "response.done": {
        this.callbacks.onStateChange("idle");
        break;
      }

      case "error": {
        this.callbacks.onStateChange("error");
        break;
      }
    }
  }

  private async processThroughCortex(transcript: string): Promise<void> {
    try {
      this.callbacks.onStateChange("thinking");

      const stream = await this.cortex.chatStream(transcript);
      const fullText = await stream.fullText;

      if (!fullText.trim() || !this.active) return;

      this.sendToGrokTts(fullText);
    } catch {
      this.callbacks.onStateChange("error");
    }
  }

  private sendToGrokTts(text: string): void {
    if (!this.grokWs || this.grokWs.readyState !== 1) return;

    const prompt = buildTtsPrompt(text, "on");

    this.grokWs.send(JSON.stringify({
      type: "session.update",
      session: { instructions: prompt },
    }));

    this.grokWs.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }));

    this.grokWs.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio"] },
    }));
  }
}
