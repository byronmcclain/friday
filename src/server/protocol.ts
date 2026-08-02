import type { SignalName } from "../core/events.ts";

// ─── Client → Server ────────────────────────────────────────────

export type ClientMessage =
	| { type: "chat"; id: string; content: string }
	| { type: "protocol"; id: string; command: string }
	| {
			type: "session:boot";
			id: string;
			model?: string;
			fastModel?: string;
			fresh?: boolean;
	  }
	| { type: "session:shutdown"; id: string }
	| { type: "history:list"; id: string; count?: number }
	| { type: "history:load"; id: string; sessionId: string }
	| { type: "smarts:list"; id: string }
	| { type: "smarts:search"; id: string; query: string }
	| { type: "session:identify"; id: string; clientType: "chat" | "voice" | "tui" }
	| { type: "session:list-protocols"; id: string }
	| { type: "voice:start"; id: string; voice?: string }
	| { type: "voice:stop"; id: string }
	| { type: "voice:mode"; id: string; mode: "on" | "whisper" };

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
	| { type: "session:booted"; requestId: string; model: string; fastModel: string }
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
	| { type: "error"; requestId?: string; code: string; message: string }
	| { type: "session:ready"; requestId: string; model: string; capabilities: string[] }
	| {
			type: "session:protocols";
			requestId: string;
			protocols: { name: string; description: string; aliases?: string[] }[];
	  }
	| { type: "voice:state"; state: "idle" | "listening" | "thinking" | "speaking" | "error" }
	| { type: "voice:transcript"; role: "user" | "assistant"; delta: string; done: boolean }
	| { type: "voice:audio"; delta: string }
	| { type: "voice:started"; requestId: string }
	| { type: "voice:stopped"; requestId: string }
	| { type: "voice:error"; code: string; message: string }
	| {
			type: "conversation:message";
			role: "user" | "assistant";
			content: string;
			source: "voice" | "chat" | "tui" | "replay" | "telegram";
	  }
	| {
			type: "audit:entry";
			action: string;
			source: string;
			detail: string;
			success: boolean;
			timestamp: string;
	  };

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
	"session:identify",
	"session:list-protocols",
	"voice:start",
	"voice:stop",
	"voice:mode",
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
	"session:identify": ["id", "clientType"],
	"session:list-protocols": ["id"],
	"voice:start": ["id"],
	"voice:stop": ["id"],
	"voice:mode": ["id", "mode"],
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
	if ("clientType" in parsed && typeof parsed.clientType !== "string") return null;
	if ("mode" in parsed && typeof parsed.mode !== "string") return null;
	if ("voice" in parsed && parsed.voice !== undefined && typeof parsed.voice !== "string")
		return null;

	return parsed as ClientMessage;
}
