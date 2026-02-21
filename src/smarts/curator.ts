import type { SmartsStore } from "./store.ts";
import type { LLMProvider } from "../providers/types.ts";
import type { ConversationMessage } from "../core/types.ts";

const MIN_MESSAGES_FOR_EXTRACTION = 10;

export const EXTRACTION_PROMPT = `You are a knowledge extraction system. Review the conversation below and extract reusable domain knowledge.

Return a JSON array of knowledge entries. Each entry must have:
- "name": kebab-case unique identifier (e.g., "docker-networking-basics")
- "domain": broad category (e.g., "docker", "security", "typescript", "bun")
- "tags": array of keywords for search indexing
- "confidence": 0.0-1.0 based on how authoritative the information is
- "content": markdown-formatted knowledge (concise, actionable, not conversation-specific)

Rules:
- Only extract knowledge that would be useful in future conversations
- Do not extract conversation-specific context or personal information
- Write content as reference material, not as conversation summaries
- Each entry should be self-contained

Return ONLY the JSON array, no other text. If no knowledge is worth extracting, return [].`;

interface ExtractedSmart {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  content: string;
}

export class SmartsCurator {
  constructor(
    private store: SmartsStore,
    private provider: LLMProvider,
  ) {}

  async extractFromConversation(messages: ConversationMessage[]): Promise<void> {
    if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return;

    try {
      const conversationText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");

      const response = await this.provider.chat(
        EXTRACTION_PROMPT,
        [{ role: "user", content: conversationText }],
        { model: this.provider.defaultModel, maxTokens: 4096 },
      );

      const extracted = this.parseResponse(response);
      for (const smart of extracted) {
        await this.store.create({
          name: smart.name,
          domain: smart.domain,
          tags: smart.tags,
          confidence: Math.min(smart.confidence, 0.7),
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
          typeof (item as ExtractedSmart).content === "string",
      );
    } catch {
      return [];
    }
  }
}
