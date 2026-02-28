export interface RuntimeBridge {
  /** Stream text chunks for a chat input. Protocol inputs yield a single chunk. */
  chat(content: string): AsyncIterable<string>;
  /** Process a protocol command directly. */
  process(input: string): Promise<{ output: string; source: string }>;
  /** Whether the backing runtime is booted and ready. */
  isBooted(): boolean;
  /** Request graceful shutdown. */
  shutdown(): Promise<void>;
}
