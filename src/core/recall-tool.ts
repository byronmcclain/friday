import type { FridayTool, ToolContext, ToolResult } from "../modules/types.ts";
import type { SQLiteMemory } from "./memory.ts";
import { getTextContent } from "./types.ts";

const MAX_RECALL_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 500;
const MAX_OUTPUT_LENGTH = 8000;

export function createRecallTool(memory: SQLiteMemory): FridayTool {
	return {
		name: "recall_memory",
		description:
			"Search your memory of past conversations. Use mode 'search' with a query to find relevant past discussions (returns summaries with dates). Use mode 'recall' with a sessionId to retrieve the full conversation transcript. Use this when the user references something previously discussed, or when you need context from a past session.",
		parameters: [
			{
				name: "query",
				type: "string",
				description: "Search terms to find relevant past conversations (required for search mode)",
				required: false,
			},
			{
				name: "mode",
				type: "string",
				description: "'search' to find conversations by keyword, 'recall' to retrieve full messages by session ID. Defaults to 'search'.",
				required: false,
				default: "search",
			},
			{
				name: "sessionId",
				type: "string",
				description: "The session ID to retrieve full messages from (required for recall mode)",
				required: false,
			},
			{
				name: "limit",
				type: "number",
				description: "Maximum number of search results to return (default: 5, max: 20)",
				required: false,
				default: 5,
			},
		],
		clearance: [],

		async execute(
			args: Record<string, unknown>,
			context: ToolContext,
		): Promise<ToolResult> {
			const mode = (args.mode as string) ?? "search";

			if (mode === "recall") {
				return handleRecall(memory, args, context);
			}
			if (mode === "search") {
				return handleSearch(memory, args, context);
			}
			return { success: false, output: `Unknown mode: "${mode}". Use "search" or "recall".` };
		},
	};
}

async function handleSearch(
	memory: SQLiteMemory,
	args: Record<string, unknown>,
	context: ToolContext,
): Promise<ToolResult> {
	const query = args.query as string;
	if (!query?.trim()) {
		return { success: false, output: "Missing required parameter: query (for search mode)" };
	}

	const limit = Math.min(20, Math.max(1, (args.limit as number) ?? 5));
	const results = await memory.searchConversations(query, limit);

	context.audit.log({
		action: "tool:recall.search",
		source: "recall_memory",
		detail: `Search "${query}" → ${results.length} result(s)`,
		success: true,
	});

	if (results.length === 0) {
		return {
			success: true,
			output: "No matching conversations found in memory.",
			artifacts: { results: [], query },
		};
	}

	const lines = results.map((r, i) => {
		const date = r.date ? r.date.replace("T", " ").slice(0, 16) : "unknown date";
		return `${i + 1}. [${date}] (session ${r.sessionId})\n   "${r.summary}"`;
	});

	return {
		success: true,
		output: `Found ${results.length} matching conversation${results.length === 1 ? "" : "s"}:\n\n${lines.join("\n\n")}`,
		artifacts: { results, query },
	};
}

async function handleRecall(
	memory: SQLiteMemory,
	args: Record<string, unknown>,
	context: ToolContext,
): Promise<ToolResult> {
	const sessionId = args.sessionId as string;
	if (!sessionId?.trim()) {
		return { success: false, output: "Missing required parameter: sessionId (for recall mode)" };
	}

	const session = await memory.getConversationById(sessionId);
	if (!session) {
		context.audit.log({
			action: "tool:recall.recall",
			source: "recall_memory",
			detail: `Recall session ${sessionId} → not found`,
			success: false,
		});
		return { success: false, output: `No conversation found with ID: ${sessionId}` };
	}

	context.audit.log({
		action: "tool:recall.recall",
		source: "recall_memory",
		detail: `Recalled session ${sessionId} (${session.messages.length} messages)`,
		success: true,
	});

	const date = session.startedAt.toISOString().replace("T", " ").slice(0, 16);
	const header = `Conversation ${sessionId} (${date}, ${session.provider}/${session.model}, ${session.messages.length} messages)`;

	let output = `${header}\n${"─".repeat(60)}\n`;
	let totalLength = output.length;

	const messages = session.messages.slice(0, MAX_RECALL_MESSAGES);
	for (const msg of messages) {
		let text = getTextContent(msg.content);
		if (text.length > MAX_MESSAGE_LENGTH) {
			text = `${text.slice(0, MAX_MESSAGE_LENGTH)}...`;
		}
		const line = `${msg.role}: ${text}\n`;
		if (totalLength + line.length > MAX_OUTPUT_LENGTH) {
			const remaining = Math.min(session.messages.length - messages.indexOf(msg) - 1, MAX_RECALL_MESSAGES);
			output += `\n... (${remaining} more messages truncated)`;
			break;
		}
		output += line;
		totalLength += line.length;
	}

	if (session.messages.length > MAX_RECALL_MESSAGES) {
		output += `\n... (showing first ${MAX_RECALL_MESSAGES} of ${session.messages.length} messages)`;
	}

	return {
		success: true,
		output,
		artifacts: { sessionId, messageCount: session.messages.length },
	};
}
