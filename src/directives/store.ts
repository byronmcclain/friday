import type { SignalName } from "../core/events.ts";
import type { FridayDirective } from "./types.ts";

export class DirectiveStore {
  private directives = new Map<string, FridayDirective>();
  private onChange?: () => void;

  onStoreChange(callback: () => void): void {
    this.onChange = callback;
  }

  add(directive: FridayDirective): void {
    this.directives.set(directive.id, directive);
    this.onChange?.();
  }

  get(id: string): FridayDirective | undefined {
    return this.directives.get(id);
  }

  remove(id: string): void {
    this.directives.delete(id);
    this.onChange?.();
  }

  update(id: string, updates: Partial<FridayDirective>): void {
    const existing = this.directives.get(id);
    if (existing) {
      this.directives.set(id, { ...existing, ...updates });
      this.onChange?.();
    }
  }

  list(): FridayDirective[] {
    return [...this.directives.values()];
  }

  listEnabled(): FridayDirective[] {
    return this.list().filter((d) => d.enabled);
  }

  findBySignal(signal: SignalName): FridayDirective[] {
    return this.listEnabled().filter(
      (d) => d.trigger.type === "signal" && d.trigger.signal === signal,
    );
  }
}
