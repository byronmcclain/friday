import type { FridayTool } from "../modules/types.ts";
import type { ClearanceManager } from "./clearance.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalBus, SignalEmitter } from "./events.ts";
import type { ScopedMemory } from "./memory.ts";
import type { NotificationManager } from "./notifications.ts";

/** Portable tool definition — works for AI SDK, Grok realtime, or any LLM API */
export type ToolDefinition = Pick<FridayTool, "name" | "description" | "parameters">;

/** Convert FridayTool registry to portable definitions */
export function buildToolDefinitions(
	tools: Map<string, FridayTool>,
): ToolDefinition[] {
	const defs: ToolDefinition[] = [];
	for (const [name, tool] of tools) {
		defs.push({
			name,
			description: tool.description,
			parameters: tool.parameters,
		});
	}
	return defs;
}

/** Function signature for executing a tool by name */
export type ToolExecutor = (
	name: string,
	args: Record<string, unknown>,
) => Promise<string>;

/** Configuration for creating a tool executor */
export interface ToolExecutorConfig {
	tools: Map<string, FridayTool>;
	clearance?: ClearanceManager;
	audit?: AuditLogger;
	signals?: SignalBus;
	toolMemory?: ScopedMemory;
	notifications?: NotificationManager;
}

/** Grok realtime API function tool definition */
export interface GrokToolDefinition {
	type: "function";
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, { type: string; description: string }>;
		required: string[];
	};
}

/** Convert portable ToolDefinitions to Grok realtime API function format */
export function toGrokTools(defs: ToolDefinition[]): GrokToolDefinition[] {
	return defs.map((def) => {
		const properties: Record<string, { type: string; description: string }> = {};
		const required: string[] = [];

		for (const param of def.parameters) {
			properties[param.name] = {
				type: param.type,
				description: param.description,
			};
			if (param.required) {
				required.push(param.name);
			}
		}

		return {
			type: "function" as const,
			name: def.name,
			description: def.description,
			parameters: {
				type: "object" as const,
				properties,
				required,
			},
		};
	});
}

/**
 * Create a tool executor callback that wraps clearance checks,
 * audit logging, signal emission, and error handling.
 *
 * This is the shared execution pipeline used by both TextWorker
 * (via AI SDK tool wrappers) and VoiceWorker (via Grok function calls).
 */
export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
	// Pre-build context once — all fields are stable for executor lifetime
	const context = {
		workingDirectory: process.cwd(),
		audit: config.audit ?? ({ log: () => {} } as unknown as AuditLogger),
		signal: config.signals ?? ({ emit: async () => {} } as SignalEmitter),
		memory: config.toolMemory ?? {
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
			list: async () => [],
		},
		notifications: config.notifications,
	};

	return async (name: string, args: Record<string, unknown>): Promise<string> => {
		const fridayTool = config.tools.get(name);
		if (!fridayTool) {
			return `Tool not found: ${name}`;
		}

		// Clearance gate
		if (fridayTool.clearance.length > 0) {
			if (!config.clearance) {
				config.audit?.log({
					action: "tool:blocked",
					source: name,
					detail: `Clearance denied for tool: ${name} (clearance manager not configured)`,
					success: false,
				});
				return `Clearance denied for tool: ${name} (clearance manager not configured)`;
			}
			const check = config.clearance.checkAll(fridayTool.clearance);
			if (!check.granted) {
				config.audit?.log({
					action: "tool:blocked",
					source: name,
					detail: check.reason ?? `Clearance denied for tool: ${name}`,
					success: false,
				});
				return check.reason ?? `Clearance denied for tool: ${name}`;
			}
		}

		// Audit + signal
		config.audit?.log({
			action: "tool:called",
			source: name,
			detail: "Tool invoked by LLM",
			success: true,
		});
		config.signals?.emit("tool:executing", name, { args });

		// Execute with pre-built context
		try {
			const result = await fridayTool.execute(args, context);
			config.signals?.emit("tool:completed", name);
			return result.output || result.error || "Tool returned no output";
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			config.audit?.log({
				action: "tool:error",
				source: name,
				detail: msg,
				success: false,
			});
			config.signals?.emit("tool:completed", name);
			return `Tool execution error: ${msg}`;
		}
	};
}
