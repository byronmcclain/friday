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
    const signalTypes: SignalName[] = [
      "file:changed",
      "file:created",
      "file:deleted",
      "test:passed",
      "test:failed",
      "command:pre-execute",
      "command:post-execute",
      "command:pre-commit",
      "session:start",
      "session:end",
      "error:unhandled",
    ];

    for (const signalName of signalTypes) {
      this.signals.on(signalName, (signal) => this.handleSignal(signal));
    }
  }

  private async handleSignal(signal: Signal): Promise<void> {
    const directives = this.store.findBySignal(signal.name);
    for (const directive of directives) {
      await this.executeDirective(directive, signal);
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

    if (this.actionHandler) {
      await this.actionHandler(directive, directive.action);
    }
  }
}
