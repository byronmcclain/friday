import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../modules/types.ts";
import type { SmartsStore } from "./store.ts";

export function createSmartProtocol(store: SmartsStore): FridayProtocol {
  return {
    name: "smart",
    description: "Manage Friday's SMARTS knowledge base",
    aliases: ["smarts", "knowledge"],
    parameters: [],
    clearance: ["read-fs"],
    execute: async (args: Record<string, unknown>, _context: ProtocolContext): Promise<ProtocolResult> => {
      const rawArgs = (args.rawArgs as string) ?? "";
      const parts = rawArgs.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "list":
          return handleList(store);
        case "show":
          return handleShow(store, rest);
        case "domains":
          return handleDomains(store);
        case "search":
          return handleSearch(store, rest);
        case "reload":
          return handleReload(store);
        default:
          return {
            success: false,
            summary: `Unknown subcommand: "${subcommand}". Available: list, show <name>, domains, search <query>, reload`,
          };
      }
    },
  };
}

function handleList(store: SmartsStore): ProtocolResult {
  const entries = store.all();
  if (entries.length === 0) {
    return { success: true, summary: "No SMARTS loaded." };
  }
  const lines = entries.map(
    (e) => `  ${e.name} [${e.domain}] confidence:${e.confidence} source:${e.source}`,
  );
  return { success: true, summary: `SMARTS (${entries.length}):\n${lines.join("\n")}` };
}

async function handleShow(store: SmartsStore, name: string): Promise<ProtocolResult> {
  if (!name) return { success: false, summary: "Usage: /smart show <name>" };
  const entry = await store.getByName(name);
  if (!entry) return { success: false, summary: `SMART "${name}" not found.` };
  return {
    success: true,
    summary: `${entry.name} [${entry.domain}] confidence:${entry.confidence}\n\n${entry.content}`,
  };
}

function handleDomains(store: SmartsStore): ProtocolResult {
  const domains = store.domains();
  if (domains.length === 0) {
    return { success: true, summary: "No domains found." };
  }
  return { success: true, summary: `Domains: ${domains.join(", ")}` };
}

async function handleSearch(store: SmartsStore, query: string): Promise<ProtocolResult> {
  if (!query) return { success: false, summary: "Usage: /smart search <query>" };
  const results = await store.findRelevant(query);
  if (results.length === 0) {
    return { success: true, summary: "No matching SMARTS found." };
  }
  const lines = results.map((e) => `  ${e.name} [${e.domain}] confidence:${e.confidence}`);
  return { success: true, summary: `Matches (${results.length}):\n${lines.join("\n")}` };
}

async function handleReload(store: SmartsStore): Promise<ProtocolResult> {
  await store.reindex();
  return { success: true, summary: `SMARTS reindex complete. ${store.all().length} entries loaded.` };
}
