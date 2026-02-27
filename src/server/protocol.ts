import type { ProviderName } from "../core/types.ts";
import type { SignalName } from "../core/events.ts";

// ─── Client → Server ────────────────────────────────────────────

export type ClientMessage =
	| { type: "chat"; id: string; content: string }
	| { type: "protocol"; id: string; command: string }
	| {
			type: "session:boot";
			id: string;
			provider?: ProviderName;
			model?: string;
			fastModel?: string;
			fresh?: boolean;
	  }
	| { type: "session:shutdown"; id: string }
	| { type: "history:list"; id: string; count?: number }
	| { type: "history:load"; id: string; sessionId: string }
	| { type: "smarts:list"; id: string }
	| { type: "smarts:search"; id: string; query: string };

// ─── Server → Client ────────────────────────────────────────────

export type ServerMessage =
	| {
			type: "chat:response";
			requestId: string;
			content: string;
			source: "cortex" | "protocol";
	  }
	| { type: "chat:chunk"; requestId: string; text: string }
	| {
			type: "protocol:response";
			requestId: string;
			content: string;
			success: boolean;
	  }
	| { type: "session:booted"; requestId: string; provider: string; model: string; fastModel: string }
	| { type: "session:closed"; requestId: string }
	| { type: "history:result"; requestId: string; data: unknown }
	| { type: "smarts:result"; requestId: string; data: unknown }
	| { type: "sensorium:update"; snapshot: unknown }
	| {
			type: "signal";
			name: SignalName;
			source: string;
			data?: Record<string, unknown>;
	  }
	| {
			type: "notification";
			level: "info" | "warning" | "alert";
			title: string;
			body: string;
			source: string;
	  }
	| { type: "error"; requestId?: string; code: string; message: string };

// ─── Validators ─────────────────────────────────────────────────

const VALID_TYPES = new Set([
	"chat",
	"protocol",
	"session:boot",
	"session:shutdown",
	"history:list",
	"history:load",
	"smarts:list",
	"smarts:search",
]);

const REQUIRED_FIELDS: Record<string, string[]> = {
	chat: ["id", "content"],
	protocol: ["id", "command"],
	"session:boot": ["id"],
	"session:shutdown": ["id"],
	"history:list": ["id"],
	"history:load": ["id", "sessionId"],
	"smarts:list": ["id"],
	"smarts:search": ["id", "query"],
};

export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) return null;
	const type = parsed.type as string;
	if (!VALID_TYPES.has(type)) return null;

	const required = REQUIRED_FIELDS[type];
	if (required) {
		for (const field of required) {
			if (parsed[field] === undefined || parsed[field] === null) return null;
		}
	}

	// Validate field types
	if (typeof parsed.id !== "string") return null;
	if ("content" in parsed && typeof parsed.content !== "string") return null;
	if ("command" in parsed && typeof parsed.command !== "string") return null;
	if ("query" in parsed && typeof parsed.query !== "string") return null;
	if ("sessionId" in parsed && typeof parsed.sessionId !== "string") return null;

	return parsed as ClientMessage;
}

export function serializeServerMessage(msg: ServerMessage): string {
	return JSON.stringify(msg);
}
