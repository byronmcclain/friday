import { describe, test, expect } from "bun:test";
import { HistoryManager } from "../../src/core/history-manager.ts";

describe("HistoryManager", () => {
	test("push and toMessages returns messages", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "Hello" });
		hm.push({ role: "assistant", content: "Hi there" });
		const msgs = hm.toMessages();
		expect(msgs).toHaveLength(2);
		expect(msgs[0]!.role).toBe("user");
	});

	test("pop removes last message", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "Hello" });
		hm.push({ role: "assistant", content: "Hi" });
		hm.pop();
		expect(hm.toMessages()).toHaveLength(1);
	});

	test("clear resets everything", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "Hello" });
		hm.clear();
		expect(hm.toMessages()).toHaveLength(0);
	});

	test("compact does nothing under budget", async () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "Hello" });
		await hm.compact();
		expect(hm.toMessages()).toHaveLength(1);
	});

	test("compact summarizes old messages when over budget", async () => {
		const summarizeFn = async () => "Summary of earlier conversation.";
		const hm = new HistoryManager({
			maxTokens: 100,
			summarize: summarizeFn,
		});

		for (let i = 0; i < 20; i++) {
			hm.push({
				role: "user",
				content: `Message number ${i} with enough text to accumulate tokens`,
			});
			hm.push({
				role: "assistant",
				content: `Response number ${i} with sufficient length for testing`,
			});
		}

		await hm.compact();
		const msgs = hm.toMessages();
		expect(msgs.length).toBeLessThan(40);
		// First message should contain the summary
		const firstContent =
			typeof msgs[0]!.content === "string"
				? msgs[0]!.content
				: JSON.stringify(msgs[0]!.content);
		expect(firstContent).toContain("Summary of earlier conversation");
	});

	test("recordUsage calibrates token count", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "Hello" });
		hm.recordUsage(5000);
		expect(hm.tokenEstimate).toBe(5000);
	});

	test("setHistory replaces all messages", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "old" });
		hm.setHistory([
			{ role: "user", content: "new1" },
			{ role: "assistant", content: "new2" },
		]);
		const msgs = hm.toMessages();
		expect(msgs).toHaveLength(2);
		expect(msgs[0]!.content).toBe("new1");
	});

	test("length returns message count", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "a" });
		hm.push({ role: "assistant", content: "b" });
		expect(hm.length).toBe(2);
	});

	test("getHistory returns defensive copy", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		hm.push({ role: "user", content: "a" });
		const copy = hm.getHistory();
		copy.push({ role: "assistant", content: "injected" });
		expect(hm.toMessages()).toHaveLength(1);
	});

	test("compact with no summarize function just truncates", async () => {
		const hm = new HistoryManager({ maxTokens: 100 });

		for (let i = 0; i < 20; i++) {
			hm.push({
				role: "user",
				content: `Message number ${i} with enough text to accumulate tokens`,
			});
			hm.push({
				role: "assistant",
				content: `Response number ${i} with sufficient length for testing`,
			});
		}

		await hm.compact();
		const msgs = hm.toMessages();
		expect(msgs.length).toBeLessThan(40);
		// No summary prefix — first message should be a regular message
		expect(msgs[0]!.role).toBe("user");
		const firstContent =
			typeof msgs[0]!.content === "string"
				? msgs[0]!.content
				: JSON.stringify(msgs[0]!.content);
		expect(firstContent).not.toContain("Previous context summary");
	});

	test("compact skips when too few messages", async () => {
		const hm = new HistoryManager({ maxTokens: 1 });
		hm.push({ role: "user", content: "a" });
		hm.push({ role: "assistant", content: "b" });
		await hm.compact();
		// Should not compact — only 2 messages, threshold is 4
		expect(hm.toMessages()).toHaveLength(2);
	});

	test("tokenEstimate tracks push and pop", () => {
		const hm = new HistoryManager({ maxTokens: 100_000 });
		expect(hm.tokenEstimate).toBe(0);
		hm.push({ role: "user", content: "Hello world" });
		const afterPush = hm.tokenEstimate;
		expect(afterPush).toBeGreaterThan(0);
		hm.pop();
		expect(hm.tokenEstimate).toBe(0);
	});
});
