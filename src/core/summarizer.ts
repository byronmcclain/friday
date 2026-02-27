import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import type { LLMProvider } from "../providers/types.ts";
import { type ConversationMessage, getTextContent } from "./types.ts";
import { withTimeout } from "../utils/timeout.ts";

const MIN_MESSAGES_FOR_SUMMARY = 4;
const MAX_SUMMARIZER_CHARS = 16_000;

export const SUMMARY_PROMPT = `You are a conversation summarizer. Given the conversation below, write a concise 1-3 sentence summary that captures the main topic(s) and outcome(s).

Rules:
- Focus on what was discussed and any decisions or results
- Write in past tense ("Discussed...", "Implemented...", "Debugged...")
- Do not include greetings or meta-commentary
- Return ONLY the summary text, no labels or prefixes`;

/** Type guard: LanguageModelV3 has specificationVersion, LLMProvider does not */
function isLanguageModel(
	modelOrProvider: LanguageModelV3 | LLMProvider,
): modelOrProvider is LanguageModelV3 {
	return "specificationVersion" in modelOrProvider;
}

export class ConversationSummarizer {
	private model: LanguageModelV3 | undefined;
	private provider: LLMProvider | undefined;
	private fastModel: string | undefined;

	constructor(modelOrProvider: LanguageModelV3 | LLMProvider, fastModel?: string) {
		if (isLanguageModel(modelOrProvider)) {
			this.model = modelOrProvider;
		} else {
			this.provider = modelOrProvider;
			this.fastModel = fastModel;
		}
	}

	async summarize(messages: ConversationMessage[]): Promise<string | undefined> {
		if (messages.length < MIN_MESSAGES_FOR_SUMMARY) return undefined;

		try {
			let conversationText = messages
				.map((m) => `${m.role}: ${getTextContent(m.content)}`)
				.join("\n\n");

			if (conversationText.length > MAX_SUMMARIZER_CHARS) {
				conversationText = `[Earlier messages omitted]\n\n${conversationText.slice(-MAX_SUMMARIZER_CHARS)}`;
			}

			const fullPrompt = `${SUMMARY_PROMPT}\n\n${conversationText}`;

			if (this.model) {
				const result = await withTimeout(
					generateText({ model: this.model, prompt: fullPrompt, maxOutputTokens: 256 }),
					30_000,
					"conversation summarization",
				);
				const trimmed = result.text.trim();
				return trimmed || undefined;
			}

			// Legacy LLMProvider path (backward compat until runtime is migrated)
			if (this.provider && this.fastModel) {
				const response = await withTimeout(
					this.provider.chat(
						SUMMARY_PROMPT,
						[{ role: "user", content: conversationText }],
						{ model: this.fastModel, maxTokens: 256 },
					),
					30_000,
					"conversation summarization",
				);

				if (response.type !== "text") return undefined;
				const trimmed = response.text.trim();
				return trimmed || undefined;
			}

			return undefined;
		} catch (error) {
			console.warn("Conversation summarization failed:", error instanceof Error ? error.message : error);
			return undefined;
		}
	}
}
