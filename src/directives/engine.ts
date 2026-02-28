import type { SignalBus, Signal, SignalName } from "../core/events.ts";
import type { ClearanceManager } from "../core/clearance.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { DirectiveStore } from "./store.ts";
import type { FridayDirective, DirectiveAction } from "./types.ts";

export interface DirectiveEngineConfig {
  store: DirectiveStore;
  signals: SignalBus;
  audit: AuditLogger;
  clearance: ClearanceManager;
}

export type DirectiveActionHandler = (
  directive: FridayDirective,
  action: DirectiveAction,
) => void | Promise<void>;

export class DirectiveEngine {
  private store: DirectiveStore;
  private signals: SignalBus;
  private audit: AuditLogger;
  private clearance: ClearanceManager;
  private actionHandler?: DirectiveActionHandler;
  private subscribedSignals = new Set<SignalName>();
  private boundHandler = (signal: Signal) => this.handleSignal(signal);

  constructor(config: DirectiveEngineConfig) {
    this.store = config.store;
    this.signals = config.signals;
    this.audit = config.audit;
    this.clearance = config.clearance;
  }

  onDirectiveAction(handler: DirectiveActionHandler): void {
    this.actionHandler = handler;
  }

  start(): void {
    this.syncSubscriptions();
    this._storeUnsub = this.store.onStoreChange(() => this.syncSubscriptions());
  }

  private _storeUnsub?: () => void;

  stop(): void {
    for (const signal of this.subscribedSignals) {
      this.signals.off(signal, this.boundHandler);
    }
    this.subscribedSignals.clear();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
  }

  private syncSubscriptions(): void {
    const needed = new Set<SignalName>();
    for (const directive of this.store.listEnabled()) {
      if (directive.trigger.type === "signal") {
        needed.add(directive.trigger.signal);
      } else if (directive.trigger.type !== "manual") {
        console.warn("[DirectiveEngine] unimplemented trigger type:", directive.trigger.type);
      }
    }

    for (const signal of this.subscribedSignals) {
      if (!needed.has(signal)) {
        this.signals.off(signal, this.boundHandler);
        this.subscribedSignals.delete(signal);
      }
    }

    for (const signal of needed) {
      if (!this.subscribedSignals.has(signal)) {
        this.signals.on(signal, this.boundHandler);
        this.subscribedSignals.add(signal);
      }
    }
  }

  private async handleSignal(signal: Signal): Promise<void> {
    const directives = this.store.findBySignal(signal.name);
    for (const directive of directives) {
      try {
        await this.executeDirective(directive, signal);
      } catch (err) {
        console.error(`Directive '${directive.name}' error:`, err);
      }
    }
  }

  private async executeDirective(
    directive: FridayDirective,
    signal: Signal,
  ): Promise<void> {
    if (directive.clearance.length > 0) {
      const check = this.clearance.checkAll(directive.clearance);
      if (!check.granted) {
        this.audit.log({
          action: "directive:blocked",
          source: directive.name,
          detail: `Clearance denied: ${check.reason}`,
          success: false,
        });
        return;
      }
    }

    if (!this.actionHandler) return;

    try {
      await this.actionHandler(directive, directive.action);
    } catch (err) {
      this.audit.log({
        action: "directive:error",
        source: directive.name,
        detail: `Handler failed: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
        metadata: { signal: signal.name, directiveId: directive.id },
      });
      return;
    }

    this.store.update(directive.id, {
      executionCount: directive.executionCount + 1,
    });

    this.audit.log({
      action: "directive:fire",
      source: directive.name,
      detail: `Triggered by ${signal.name}`,
      success: true,
      metadata: { signal: signal.name, directiveId: directive.id },
    });
  }
}
