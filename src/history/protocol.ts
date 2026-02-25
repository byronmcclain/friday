import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../modules/types.ts";
import type { SQLiteMemory } from "../core/memory.ts";
import { getTextContent } from "../core/types.ts";

export function createHistoryProtocol(memory: SQLiteMemory): FridayProtocol {
  return {
    name: "history",
    description: "Browse and manage conversation history",
    aliases: ["hist"],
    parameters: [],
    clearance: [],
    execute: async (args: Record<string, unknown>, _context: ProtocolContext): Promise<ProtocolResult> => {
      const rawArgs = (args.rawArgs as string) ?? "";
      const parts = rawArgs.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "":
        case "list":
          return handleList(memory, rest);
        case "show":
          return handleShow(memory, rest);
        case "clear":
          return handleClear(memory);
        default:
          return {
            success: false,
            summary: `Unknown subcommand: "${subcommand}". Available: list, show <id>, clear`,
          };
      }
    },
  };
}

async function handleList(memory: SQLiteMemory, args: string): Promise<ProtocolResult> {
  const count = args ? Number.parseInt(args, 10) : 20;
  const limit = Number.isNaN(count) || count < 1 ? 20 : count;
  const sessions = await memory.getConversationHistory(limit);
  if (sessions.length === 0) {
    return { success: true, summary: "No conversation history." };
  }
  const lines = sessions.map((s) => {
    const date = s.startedAt.toISOString().replace("T", " ").slice(0, 16);
    const msgCount = s.messages.length;
    return `  ${s.id}  ${date}  ${s.provider}/${s.model}  ${msgCount} messages`;
  });
  return { success: true, summary: `Conversations (${sessions.length}):\n${lines.join("\n")}` };
}

async function handleShow(memory: SQLiteMemory, id: string): Promise<ProtocolResult> {
  if (!id) return { success: false, summary: "Usage: /history show <id>" };
  const session = await memory.getConversationById(id);
  if (!session) return { success: false, summary: `Session "${id}" not found.` };

  const header = `Session: ${session.id}\nStarted: ${session.startedAt.toISOString()}\nProvider: ${session.provider}/${session.model}\nMessages: ${session.messages.length}`;
  const messages = session.messages
    .map((m) => {
      const text = getTextContent(m.content);
      return `  [${m.role}] ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`;
    })
    .join("\n");
  return { success: true, summary: `${header}\n\n${messages}` };
}

async function handleClear(memory: SQLiteMemory): Promise<ProtocolResult> {
  const row = memory.database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM conversations").get();
  const count = row?.n ?? 0;
  await memory.deleteAllConversations();
  return { success: true, summary: `Cleared ${count} conversation(s).` };
}
