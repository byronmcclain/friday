import type { ClearanceName } from "../core/clearance.ts";
import type { SignalName } from "../core/events.ts";

export interface FridayDirective {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: DirectiveTrigger;
  action: DirectiveAction;
  clearance: ClearanceName[];
  executionCount: number;
}

export type DirectiveTrigger =
  | { type: "signal"; signal: SignalName }
  | { type: "schedule"; cron: string }
  | { type: "pattern"; pattern: string }
  | { type: "manual" };

export type DirectiveAction =
  | { type: "protocol"; protocol: string; args?: Record<string, unknown> }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  | { type: "prompt"; prompt: string }
  | { type: "sequence"; steps: DirectiveAction[] };
