import type { Cortex } from "../cortex.ts";
import { type GrokVoice, VOX_WS_URL } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";
import type { SignalBus, SignalHandler } from "../events.ts";
import { NarrationPicker, ACK_PHRASES, getToolNarration, GENERIC_NARRATIONS } from "./narration.ts";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceBridgeConfig {
  voice: GrokVoice;
  sampleRate: number;
  instructions: string;
  signals?: SignalBus;
}

export interface VoiceBridgeCallbacks {
  onAudioDelta: (base64: string) => void;
  onTranscriptDelta: (text: string, done: boolean) => void;
  onStateChange: (state: VoiceState) => void;
  onUserTranscript: (text: string) => void;
}

export class VoiceBridge {
  private grokWs: WebSocket | null = null;
  private cortex: Cortex;
  private config: VoiceBridgeConfig;
  private callbacks: VoiceBridgeCallbacks;
  private active = false;
  private _generation = 0;
  private userTranscriptBuffer = "";
  private ttsQueue: string[] = [];
  private _responseInFlight = false;
  private ackPicker = new NarrationPicker(ACK_PHRASES);
  private toolPickers = new Map<string, NarrationPicker>();
  private genericNarrationPicker = new NarrationPicker(GENERIC_NARRATIONS);
  private toolSignalHandler: SignalHandler | null = null;
  private cortexStartTime = 0;
  private lastNarrationTime = 0;

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
    this._generation++;
    const gen = this._generation;
    this.callbacks.onStateChange("idle");

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(VOX_WS_URL, {
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
        if (this._generation !== gen) return;
        this.active = false;
        this.callbacks.onStateChange("error");
        reject(new Error("Grok voice connection error"));
      });

      ws.addEventListener("close", () => {
        if (this._generation !== gen) return;
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
    this.unsubscribeToolSignals();
    this.ttsQueue.length = 0;
    this._responseInFlight = false;
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
        // Acknowledged server-side, no action needed
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
        this._responseInFlight = false;
        this.flushQueue();
        if (this.ttsQueue.length === 0) {
          this.callbacks.onStateChange("idle");
        }
        break;
      }

      case "error": {
        this.callbacks.onStateChange("error");
        break;
      }
    }
  }

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

  private async processThroughCortex(transcript: string): Promise<void> {
    try {
      this.callbacks.onStateChange("thinking");
      this.cortexStartTime = Date.now();
      this.lastNarrationTime = 0;

      // 1. Immediate ack
      this.enqueueTts(this.ackPicker.next());

      // Wait for ack to be sent
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

      // Ensure history is recorded
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
