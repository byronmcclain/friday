import type { RuntimeBridge } from "./types.ts";
import type { FridayRuntime } from "../runtime.ts";

export class LocalBridge implements RuntimeBridge {
  private runtime: FridayRuntime;

  constructor(runtime: FridayRuntime) {
    this.runtime = runtime;
  }

  async *chat(content: string): AsyncIterable<string> {
    if (this.runtime.protocols.isProtocol(content)) {
      const result = await this.runtime.process(content);
      yield result.output;
      return;
    }

    const stream = await this.runtime.cortex.chatStream(content);
    for await (const chunk of stream.textStream) {
      yield chunk;
    }
    await stream.fullText;
  }

  async process(input: string): Promise<{ output: string; source: string }> {
    return this.runtime.process(input);
  }

  isBooted(): boolean {
    return this.runtime.isBooted;
  }

  async shutdown(): Promise<void> {
    if (this.runtime.isBooted) {
      await this.runtime.shutdown();
    }
  }
}
