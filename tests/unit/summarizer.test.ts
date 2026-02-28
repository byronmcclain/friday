import { describe, test, expect } from "bun:test";
import { ConversationSummarizer, SUMMARY_PROMPT } from "../../src/core/summarizer.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { createMockModel } from "../helpers/stubs.ts";

function makeMessages(count: number): ConversationMessage[] {
	return Array.from({ length: count }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `Message ${i}`,
	}));
}

describe("ConversationSummarizer", () => {
	test("SUMMARY_PROMPT is defined and non-empty", () => {
		expect(SUMMARY_PROMPT).toBeDefined();
		expect(SUMMARY_PROMPT.length).toBeGreaterThan(0);
	});

	describe("AI SDK path (LanguageModelV3)", () => {
		test("skips summarization for < 4 messages", async () => {
			const model = createMockModel({ text: "should not be called" });
			const summarizer = new ConversationSummarizer(model);
			const messages: ConversationMessage[] = [
				{ role: "user", content: "Hi" },
				{ role: "assistant", content: "Hello!" },
			];
			const result = await summarizer.summarize(messages);
			expect(result).toBeUndefined();
		});

		test("calls generateText with model and returns summary", async () => {
			const model = createMockModel({ text: "Discussed Docker networking and bridge networks." });
			const summarizer = new ConversationSummarizer(model);
			const messages: ConversationMessage[] = [
				{ role: "user", content: "How does Docker networking work?" },
				{ role: "assistant", content: "Docker uses several network drivers..." },
				{ role: "user", content: "What about bridge networks?" },
				{ role: "assistant", content: "Bridge networks provide container isolation..." },
			];
			const result = await summarizer.summarize(messages);
			expect(result).toBe("Discussed Docker networking and bridge networks.");
		});

		test("returns trimmed text", async () => {
			const model = createMockModel({ text: "  Summary with whitespace.  \n" });
			const summarizer = new ConversationSummarizer(model);
			const result = await summarizer.summarize(makeMessages(4));
			expect(result).toBe("Summary with whitespace.");
		});

		test("returns undefined for empty text", async () => {
			const model = createMockModel({ text: "" });
			const summarizer = new ConversationSummarizer(model);
			const result = await summarizer.summarize(makeMessages(4));
			expect(result).toBeUndefined();
		});

		test("returns undefined on error", async () => {
			const model = createMockModel({ text: "ok" });
			// Override doGenerate to throw
			(model as any).doGenerate = async () => { throw new Error("API down"); };
			const summarizer = new ConversationSummarizer(model);
			const result = await summarizer.summarize(makeMessages(4));
			expect(result).toBeUndefined();
		});

		test("truncates very long conversations", async () => {
			const model = createMockModel({ text: "Discussed many topics over a long conversation." });
			const summarizer = new ConversationSummarizer(model);
			// Build a conversation with 200 messages, each ~500 chars -> ~100k chars total
			const messages: ConversationMessage[] = Array.from({ length: 200 }, (_, i) => ({
				role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
				content: `Message ${i}: ${"x".repeat(500)}`,
			}));
			const result = await summarizer.summarize(messages);
			expect(result).toBe("Discussed many topics over a long conversation.");
		});
	});

});
