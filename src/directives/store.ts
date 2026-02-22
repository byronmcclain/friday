import type { SignalName } from "../core/events.ts";
import type { FridayDirective } from "./types.ts";

export class DirectiveStore {
  private directives = new Map<string, FridayDirective>();
  private changeListeners = new Set<() => void>();

  onStoreChange(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  private notifyChange(): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener();
      } catch (err) {
        console.error("DirectiveStore change listener error:", err);
      }
    }
  }

  add(directive: FridayDirective): void {
    this.directives.set(directive.id, directive);
    this.notifyChange();
  }

  get(id: string): FridayDirective | undefined {
    return this.directives.get(id);
  }

  remove(id: string): void {
    this.directives.delete(id);
    this.notifyChange();
  }

  update(id: string, updates: Partial<FridayDirective>): void {
    const existing = this.directives.get(id);
    if (existing) {
      this.directives.set(id, { ...existing, ...updates, id });
      this.notifyChange();
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
