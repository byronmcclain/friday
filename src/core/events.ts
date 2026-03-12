export type SignalName =
  | "file:changed"
  | "file:created"
  | "file:deleted"
  | "test:passed"
  | "test:failed"
  | "command:pre-execute"
  | "command:post-execute"
  | "command:pre-commit"
  | "session:start"
  | "session:end"
  | "error:unhandled"
  | "tool:executing"
  | "tool:completed"
  | `custom:${string}`;

export interface Signal {
  name: SignalName;
  timestamp: Date;
  source: string;
  data?: Record<string, unknown>;
}

export type SignalHandler = (signal: Signal) => void | Promise<void>;

export interface SignalEmitter {
  emit(name: SignalName, source: string, data?: Record<string, unknown>): Promise<void>;
}

export class SignalBus implements SignalEmitter {
  private listeners = new Map<SignalName, Set<SignalHandler>>();

  on(name: SignalName, handler: SignalHandler): void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(handler);
  }

  off(name: SignalName, handler: SignalHandler): void {
    this.listeners.get(name)?.delete(handler);
  }

  once(name: SignalName, handler: SignalHandler): void {
    let fired = false;
    const wrapper: SignalHandler = async (signal) => {
      if (fired) return;
      fired = true;
      this.off(name, wrapper);
      await handler(signal);
    };
    this.on(name, wrapper);
  }

  async emit(name: SignalName, source: string, data?: Record<string, unknown>): Promise<void> {
    const handlers = this.listeners.get(name);
    if (!handlers || handlers.size === 0) return;
    const signal: Signal = { name, timestamp: new Date(), source, data };
    for (const handler of handlers) {
      try {
        await handler(signal);
      } catch (err) {
        console.error(`Signal handler error for '${name}':`, err);
      }
    }
  }
}
