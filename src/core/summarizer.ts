import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
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

export class ConversationSummarizer {
	constructor(private model: LanguageModelV3) {}

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

			const result = await withTimeout(
				generateText({ model: this.model, prompt: fullPrompt, maxOutputTokens: 256 }),
				30_000,
				"conversation summarization",
			);
			const trimmed = result.text.trim();
			return trimmed || undefined;
		} catch (error) {
			console.warn("[Summarizer] Conversation summarization failed:", error instanceof Error ? error.message : error);
			return undefined;
		}
	}
}
