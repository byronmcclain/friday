import type { SmartsStore } from "./store.ts";
import type { LLMProvider } from "../providers/types.ts";
import { type ConversationMessage, getTextContent } from "../core/types.ts";
import { withTimeout } from "../utils/timeout.ts";

const MIN_MESSAGES_FOR_EXTRACTION = 4;

const PROJECT_CONTEXT = `This is the Friday project — a personal AI assistant runtime built with Bun and TypeScript. Key subsystems: Cortex (LLM brain), FridayRuntime (composition root), SignalBus (events), Modules (tools/protocols), SMARTS (this knowledge system), Sensorium (environment awareness), Directives (autonomous rules), The Forge (self-improvement).`;

const EXTRACTION_PROMPT_BASE = `You are a knowledge extraction system for an AI assistant project. Review the conversation and extract high-value knowledge AND important context to remember for future conversations.

${PROJECT_CONTEXT}

Return a JSON array of knowledge entries. Each entry must have:
- "action": "create" for new knowledge, or "update" to merge into an existing entry
- "name": kebab-case identifier (for "update", use the exact existing name)
- "domain": broad category relevant to this project (e.g., "bun", "typescript", "ai-agents", "architecture", "devops", "preferences", "decisions", "project-context")
- "tags": array of specific keywords for search indexing
- "confidence": 0.0-1.0 based on how authoritative and verified the information is
- "content": markdown-formatted knowledge (concise, actionable)

## What to extract

### 1. Technical knowledge (domain: use the relevant tech area)
Patterns, gotchas, decision rationales, or architectural insights that are:
- Non-obvious: not easily found in official documentation or basic tutorials
- Actionable: contains a specific pattern, workaround, or design choice
- Durable: will remain relevant across multiple future conversations

### 2. Decisions and rationale (domain: "decisions")
Architectural or design decisions made during the conversation:
- Technology choices and WHY they were chosen over alternatives
- Design patterns adopted and the reasoning behind them
- Trade-offs discussed and which direction was taken
- Example: "Chose FTS5 over vector embeddings for SMARTS because the knowledge base is small and keyword matching is sufficient"

### 3. User preferences and working style (domain: "preferences")
How the user likes to work, communicate, or structure things:
- Coding style preferences, naming conventions, or patterns they favor
- Workflow preferences (e.g., "prefers brainstorming before implementation")
- Communication preferences (e.g., "wants concise responses", "prefers code examples over explanations")
- Tool or library preferences

### 4. Project evolution and context (domain: "project-context")
Important facts about the project's current state that future conversations need:
- What was built, changed, or refactored and why
- Known limitations, tech debt, or planned next steps discussed
- Integration points, deployment details, or environment-specific notes
- Example: "SMARTS curator had a duplication problem — optimized prompt to include existing names and support update action"

## DO NOT extract
- Basic API usage or hello-world examples (e.g., "how to list files in Bun")
- Installation paths or version numbers
- Knowledge about unrelated tech stacks unless it reveals a transferable pattern
- Anything that restates official docs without adding insight
- Trivial snippets that any developer would know
- Ephemeral conversation details (greetings, clarifying questions, debugging dead-ends that led nowhere)

When an existing entry covers the same topic, use "action": "update" with the existing name to merge new insights into it rather than creating a duplicate.

Return ONLY the JSON array. If nothing is worth extracting, return [].`;

export function buildExtractionPrompt(existingNames: string[]): string {
	if (existingNames.length === 0) return EXTRACTION_PROMPT_BASE;
	return `${EXTRACTION_PROMPT_BASE}

Existing knowledge entries (do NOT create duplicates — use "action": "update" to extend these):
${existingNames.map((n) => `- ${n}`).join("\n")}`;
}

/** @deprecated Use buildExtractionPrompt() — kept for test compatibility */
export const EXTRACTION_PROMPT = EXTRACTION_PROMPT_BASE;

interface ExtractedSmart {
	action?: "create" | "update";
	name: string;
	domain: string;
	tags: string[];
	confidence: number;
	content: string;
}

export class SmartsCurator {
	private model: string;

	constructor(
		private store: SmartsStore,
		private provider: LLMProvider,
		fastModel?: string,
	) {
		this.model = fastModel ?? provider.defaultModel;
	}

	async extractFromConversation(messages: ConversationMessage[]): Promise<void> {
		if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return;

		try {
			const conversationText = messages
				.map((m) => `${m.role}: ${getTextContent(m.content)}`)
				.join("\n\n");

			const existingNames = this.store.all().map((e) => e.name);
			const prompt = buildExtractionPrompt(existingNames);

			const chatResponse = await withTimeout(
				this.provider.chat(
					prompt,
					[{ role: "user", content: conversationText }],
					{ model: this.model, maxTokens: 4096 },
				),
				30_000,
				"SMARTS knowledge extraction",
			);
			const response = chatResponse.type === "text" ? chatResponse.text : "";

			const extracted = this.parseResponse(response);
			for (const smart of extracted) {
				const action = smart.action ?? "create";
				const cappedConfidence = Math.max(0, Math.min(smart.confidence, 0.7));

				if (action === "update") {
					const existing = await this.store.getByName(smart.name);
					if (existing) {
						await this.store.update(smart.name, smart.content);
						continue;
					}
					// Entry not found — fall through to create
				}

				await this.store.create({
					name: smart.name,
					domain: smart.domain,
					tags: smart.tags,
					confidence: cappedConfidence,
					source: "conversation",
					content: smart.content,
				});
			}
		} catch (error) {
			console.warn("SMARTS extraction failed:", error instanceof Error ? error.message : error);
		}
	}

	private parseResponse(response: string): ExtractedSmart[] {
		try {
			const match = response.match(/\[[\s\S]*\]/);
			if (!match) return [];
			const parsed = JSON.parse(match[0]);
			if (!Array.isArray(parsed)) return [];

			return parsed.filter(
				(item: unknown): item is ExtractedSmart =>
					typeof item === "object" &&
					item !== null &&
					typeof (item as ExtractedSmart).name === "string" &&
					typeof (item as ExtractedSmart).domain === "string" &&
					Array.isArray((item as ExtractedSmart).tags) &&
					typeof (item as ExtractedSmart).confidence === "number" &&
					Number.isFinite((item as ExtractedSmart).confidence) &&
					typeof (item as ExtractedSmart).content === "string",
			);
		} catch {
			return [];
		}
	}
}
