import type { SmartsStore } from "./store.ts";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { type ConversationMessage, getTextContent } from "../core/types.ts";
import { withTimeout } from "../utils/timeout.ts";

const MIN_MESSAGES_FOR_EXTRACTION = 4;

const VOLATILE_PATTERNS = [
	/\b\d+\s+tools?\b/i,
	/\btool(?:s|kit)\s*\(/i,
	/\bcurrent.*(?:tools|modules)/i,
	/\bvisible\s+tools/i,
	/\blive\s+tools/i,
	/\b\d+\s*(?:GB|MB|cores?)\b/i,
	/\bload\s+avg/i,
	/\bport(?:s)?\s*:\s*\d/i,
	/\b\d+\s*%\s*(?:used|free|idle)/i,
	/\b\d+\+?\s+(?:files?|entries|tests)\b/i,
	/\bcommits?\s+ahead/i,
];

function isVolatile(content: string): boolean {
	return VOLATILE_PATTERNS.some((p) => p.test(content));
}

const PROJECT_CONTEXT = `This is the Friday project — a personal AI assistant runtime built with Bun and TypeScript. Key subsystems: Cortex (LLM brain), FridayRuntime (composition root), SignalBus (events), Modules (tools/protocols), SMARTS (this knowledge system), Sensorium (environment awareness), Directives (autonomous rules), The Forge (self-improvement).`;

const EXTRACTION_PROMPT_BASE = `You are a strict knowledge extraction system. Your job is to extract ONLY durable knowledge that would be permanently lost if this conversation disappeared. Most conversations produce ZERO extractable knowledge — returning [] is the expected default.

${PROJECT_CONTEXT}

## The Durability Test (apply to every candidate)

Before extracting anything, it must pass ALL three gates:
1. **Lost-if-forgotten**: This knowledge cannot be derived by reading the source code, CLAUDE.md, system prompt, or official documentation. If someone could rediscover it from those sources, do NOT extract it.
2. **Stable over time**: This will still be accurate and useful 10+ sessions from now. If it could become stale as the project evolves, do NOT extract it.
3. **Non-obvious**: A senior developer reading the codebase would not independently arrive at this insight. If it's conventional wisdom or standard practice, do NOT extract it.

## What to extract (rare — most conversations have none)

### 1. Technical gotchas and workarounds (domain: use the relevant tech area)
Bugs, limitations, or non-obvious behaviors discovered through actual debugging:
- A runtime quirk that cost real debugging time (e.g., "bun:sqlite transactions must invoke the returned function")
- A workaround for an undocumented limitation
- A subtle interaction between two libraries that isn't covered in either's docs

### 2. Decision rationale (domain: "decisions")
The WHY behind a significant architectural choice — only when the reasoning isn't obvious from the code:
- "Chose X over Y because of Z" — where Z is a non-obvious trade-off
- NOT "we built feature X" (that's visible in code) — only WHY and what alternatives were rejected

### 3. User preferences (domain: "preferences")
Stable personal preferences for communication and workflow:
- How the user likes to be addressed, communication tone
- Workflow patterns (e.g., "always brainstorm before implementing")
- NOT one-time instructions or task-specific requests

## DO NOT extract (these are the most common false positives)

### System state and snapshots
- Hardware specs, CPU/memory usage, load averages, port listings
- Git status, commit counts, branch states
- Docker container states, process lists
- File counts, test counts, entry counts, line counts — any "N things" enumeration

### Project self-descriptions
- What the project IS, what modules/tools exist, architecture summaries — this is in CLAUDE.md
- How subsystems work — this is in the source code
- What was built or changed — this is in git history
- Feature roadmaps, wish lists, planned modules, TODO items — aspirational content goes stale

### Redundant knowledge
- Anything already in the system prompt or CLAUDE.md
- Standard patterns any TypeScript/Bun developer would know
- Official API documentation restated without novel insight
- Basic usage examples ("how to read a file", "how to run tests")

### Conversation ephemera
- Greetings, small talk, clarifying questions
- Debugging dead-ends that led nowhere
- Step-by-step narration of what was done (that's conversation history, not knowledge)

Return a JSON array of knowledge entries. Each entry must have:
- "action": "create" for new knowledge, or "update" to merge into an existing entry
- "name": kebab-case identifier (for "update", use the exact existing name)
- "domain": broad category (e.g., "bun", "typescript", "ai-agents", "architecture", "devops", "preferences", "decisions")
- "tags": array of specific keywords for search indexing
- "confidence": 0.0-1.0 based on how authoritative and verified the information is
- "content": markdown-formatted knowledge (concise, actionable — no preamble, no "this was discussed", just the knowledge itself)

When an existing entry covers the same topic, use "action": "update" with the existing name to merge new insights rather than creating a duplicate.

Return ONLY the JSON array. Return [] if nothing passes all three durability gates.`;

export function buildExtractionPrompt(existingNames: string[]): string {
	if (existingNames.length === 0) return EXTRACTION_PROMPT_BASE;
	return `${EXTRACTION_PROMPT_BASE}

Existing knowledge entries (do NOT create duplicates — use "action": "update" to extend these):
${existingNames.map((n) => `- ${n}`).join("\n")}`;
}


interface ExtractedSmart {
	action?: "create" | "update";
	name: string;
	domain: string;
	tags: string[];
	confidence: number;
	content: string;
}

export class SmartsCurator {
	constructor(
		private store: SmartsStore,
		private languageModel: LanguageModelV3,
	) {}

	async extractFromConversation(messages: ConversationMessage[]): Promise<void> {
		if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return;

		try {
			const conversationText = messages
				.map((m) => `${m.role}: ${getTextContent(m.content)}`)
				.join("\n\n");

			const existingNames = this.store.all().map((e) => e.name);
			const prompt = buildExtractionPrompt(existingNames);

			const result = await withTimeout(
				generateText({
					model: this.languageModel,
					prompt: `${prompt}\n\n${conversationText}`,
					maxOutputTokens: 4096,
				}),
				30_000,
				"SMARTS knowledge extraction",
			);
			const response = result.text;

			const extracted = this.parseResponse(response);
			const filtered = extracted.filter((smart) => !isVolatile(smart.content));
			for (const smart of filtered) {
				const action = smart.action ?? "create";
				const cappedConfidence = Math.max(0, Math.min(smart.confidence, 0.7));

				if (action === "update") {
					const existing = await this.store.getByName(smart.name);
					if (existing) {
						await this.store.update(smart.name, smart.content, {
						tags: smart.tags,
						confidence: cappedConfidence,
					});
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
