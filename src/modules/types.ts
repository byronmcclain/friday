import type { ClearanceName } from "../core/clearance.ts";
import type { SignalName } from "../core/events.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalEmitter } from "../core/events.ts";
import type { ScopedMemory } from "../core/memory.ts";
import type { NotificationManager } from "../core/notifications.ts";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolContext {
  workingDirectory: string;
  audit: AuditLogger;
  signal: SignalEmitter;
  memory: ScopedMemory;
  notifications?: NotificationManager;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: Record<string, unknown>;
}

export interface FridayTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface FridayProtocol {
  name: string;
  description: string;
  aliases: string[];
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(
    args: Record<string, unknown>,
    context: ProtocolContext,
  ): Promise<ProtocolResult>;
}

export interface ProtocolContext extends ToolContext {
  tools: Map<string, FridayTool>;
}

export interface ProtocolResult {
  success: boolean;
  summary: string;
  details?: string;
}

export interface FridayModule {
  name: string;
  description: string;
  version: string;
  tools: FridayTool[];
  protocols: FridayProtocol[];
  knowledge: string[];
  triggers: SignalName[];
  clearance: ClearanceName[];
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
}
