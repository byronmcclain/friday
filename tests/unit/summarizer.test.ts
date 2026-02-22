import { describe, test, expect } from "bun:test";
import { ConversationSummarizer, SUMMARY_PROMPT } from "../../src/core/summarizer.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { textResponse } from "../helpers/stubs.ts";

describe("ConversationSummarizer", () => {
	test("SUMMARY_PROMPT is defined and non-empty", () => {
		expect(SUMMARY_PROMPT).toBeDefined();
		expect(SUMMARY_PROMPT.length).toBeGreaterThan(0);
	});

	test("skips summarization for < 4 messages", async () => {
		let called = false;
		const provider: LLMProvider = {
			name: "stub",
			defaultModel: "stub",
			defaultFastModel: "stub-fast",
			chat: async () => {
				called = true;
				return textResponse("should not be called");
			},
		};
		const summarizer = new ConversationSummarizer(provider, "fast-model");
		const messages: ConversationMessage[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
		];
		const result = await summarizer.summarize(messages);
		expect(result).toBeUndefined();
		expect(called).toBe(false);
	});

	test("calls provider with fast model and summary prompt", async () => {
		let usedModel = "";
		let usedSystemPrompt = "";
		const provider: LLMProvider = {
			name: "capture",
			defaultModel: "reasoning-model",
			defaultFastModel: "default-fast",
			chat: async (systemPrompt, _messages, options) => {
				usedModel = options.model;
				usedSystemPrompt = systemPrompt;
				return textResponse("Discussed Docker networking and bridge networks.");
			},
		};
		const summarizer = new ConversationSummarizer(provider, "my-fast-model");
		const messages: ConversationMessage[] = [
			{ role: "user", content: "How does Docker networking work?" },
			{ role: "assistant", content: "Docker uses several network drivers..." },
			{ role: "user", content: "What about bridge networks?" },
			{ role: "assistant", content: "Bridge networks provide container isolation..." },
		];
		const result = await summarizer.summarize(messages);
		expect(result).toBe("Discussed Docker networking and bridge networks.");
		expect(usedModel).toBe("my-fast-model");
		expect(usedSystemPrompt).toContain("summarizer");
	});

	test("returns trimmed text from provider response", async () => {
		const provider: LLMProvider = {
			name: "whitespace",
			defaultModel: "ws",
			defaultFastModel: "ws-fast",
			chat: async () => textResponse("  Summary with whitespace.  \n"),
		};
		const summarizer = new ConversationSummarizer(provider, "fast");
		const messages: ConversationMessage[] = Array.from({ length: 4 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `Message ${i}`,
		}));
		const result = await summarizer.summarize(messages);
		expect(result).toBe("Summary with whitespace.");
	});

	test("returns undefined on provider error", async () => {
		const provider: LLMProvider = {
			name: "failing",
			defaultModel: "fail",
			defaultFastModel: "fail-fast",
			chat: async () => { throw new Error("API down"); },
		};
		const summarizer = new ConversationSummarizer(provider, "fast");
		const messages: ConversationMessage[] = Array.from({ length: 4 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `Message ${i}`,
		}));
		const result = await summarizer.summarize(messages);
		expect(result).toBeUndefined();
	});

	test("returns undefined for non-text (tool_use) responses", async () => {
		const provider: LLMProvider = {
			name: "tool-user",
			defaultModel: "tool",
			defaultFastModel: "tool-fast",
			chat: async () => ({
				type: "tool_use",
				toolCalls: [{ id: "1", name: "test", input: {} }],
			}),
		};
		const summarizer = new ConversationSummarizer(provider, "fast");
		const messages: ConversationMessage[] = Array.from({ length: 4 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `Message ${i}`,
		}));
		const result = await summarizer.summarize(messages);
		expect(result).toBeUndefined();
	});

	test("returns undefined for empty text response", async () => {
		const provider: LLMProvider = {
			name: "empty",
			defaultModel: "empty",
			defaultFastModel: "empty-fast",
			chat: async () => textResponse(""),
		};
		const summarizer = new ConversationSummarizer(provider, "fast");
		const messages: ConversationMessage[] = Array.from({ length: 4 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `Message ${i}`,
		}));
		const result = await summarizer.summarize(messages);
		expect(result).toBeUndefined();
	});
});
