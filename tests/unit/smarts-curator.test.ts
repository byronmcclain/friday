import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsCurator, buildExtractionPrompt } from "../../src/smarts/curator.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { unlink, mkdir, rm } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-curator.db";
const TEST_DIR = "/tmp/friday-test-curator-smarts";

function makeMessages(count: number, topic = "TypeScript"): ConversationMessage[] {
	return Array.from({ length: count }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `Message ${i} about ${topic}`,
	}));
}

describe("SmartsCurator", () => {
	let store: SmartsStore;
	let memory: SQLiteMemory;

	beforeEach(async () => {
		await mkdir(TEST_DIR, { recursive: true });
		memory = new SQLiteMemory(TEST_DB);
		store = new SmartsStore();
		await store.initialize(
			{ smartsDir: TEST_DIR, maxPerMessage: 5, tokenBudget: 24000, minConfidence: 0.5 },
			memory,
		);
	});

	afterEach(async () => {
		memory.close();
		await Promise.allSettled([
			unlink(TEST_DB),
			unlink(`${TEST_DB}-wal`),
			unlink(`${TEST_DB}-shm`),
			rm(TEST_DIR, { recursive: true }),
		]);
	});

	test("buildExtractionPrompt returns non-empty prompt", () => {
		const prompt = buildExtractionPrompt([]);
		expect(prompt).toBeDefined();
		expect(prompt.length).toBeGreaterThan(0);
	});

	test("skips extraction for short conversations (< 4 messages)", async () => {
		const model = createMockModel({ text: "should not be called" });
		const curator = new SmartsCurator(store, model);
		const messages: ConversationMessage[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
		];
		await curator.extractFromConversation(messages);
		expect(store.all()).toHaveLength(0);
	});

	test("extracts knowledge from long conversations", async () => {
		const model = createMockModel({
			text: JSON.stringify([
				{
					action: "create",
					name: "docker-networking",
					domain: "docker",
					tags: ["docker", "networking", "bridge"],
					confidence: 0.7,
					content: "# Docker Networking\n\nUse bridge networks for container isolation.",
				},
			]),
		});
		const curator = new SmartsCurator(store, model);
		const messages: ConversationMessage[] = [
			{ role: "user", content: "How does Docker networking work?" },
			{ role: "assistant", content: "Docker uses several network drivers..." },
			{ role: "user", content: "What about bridge networks?" },
			{ role: "assistant", content: "Bridge networks provide container isolation..." },
			{ role: "user", content: "How do I create a custom bridge?" },
			{ role: "assistant", content: "Use docker network create..." },
			{ role: "user", content: "And how do I connect containers to it?" },
			{ role: "assistant", content: "Use --network flag or docker network connect..." },
			{ role: "user", content: "What about DNS resolution between containers?" },
			{ role: "assistant", content: "Docker provides automatic DNS resolution..." },
		];
		await curator.extractFromConversation(messages);
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("docker-networking");
		expect(store.all()[0]!.source).toBe("conversation");
	});

	test("handles malformed response gracefully", async () => {
		const model = createMockModel({ text: "this is not JSON" });
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	test("handles JSON wrapped in markdown code fences", async () => {
		const model = createMockModel({
			text: `Here are the results:

\`\`\`json
[{"action": "create", "name": "fenced-knowledge", "domain": "test", "tags": ["fenced"], "confidence": 0.8, "content": "# Fenced\\n\\nExtracted from fences."}]
\`\`\`

That's what I found.`,
		});
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("fenced-knowledge");
	});

	test("handles error gracefully", async () => {
		const model = createMockModel({ text: "ok" });
		// Override doGenerate to throw
		(model as any).doGenerate = async () => { throw new Error("API down"); };
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10, "Go programming"));
		expect(store.all()).toHaveLength(0);
	});

	test("handles empty array response", async () => {
		const model = createMockModel({ text: "[]" });
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	describe("buildExtractionPrompt", () => {
		test("returns base prompt when no existing names", () => {
			const prompt = buildExtractionPrompt([]);
			expect(prompt).toContain("knowledge extraction system");
			expect(prompt).not.toContain("Existing knowledge entries");
		});

		test("appends existing names to prompt", () => {
			const prompt = buildExtractionPrompt(["docker-networking", "bun-sqlite-gotchas"]);
			expect(prompt).toContain("Existing knowledge entries");
			expect(prompt).toContain("- docker-networking");
			expect(prompt).toContain("- bun-sqlite-gotchas");
		});

		test("includes project context", () => {
			const prompt = buildExtractionPrompt([]);
			expect(prompt).toContain("Friday project");
			expect(prompt).toContain("Bun and TypeScript");
		});

		test("includes durability test and exclusions", () => {
			const prompt = buildExtractionPrompt([]);
			expect(prompt).toContain("Durability Test");
			expect(prompt).toContain("Lost-if-forgotten");
			expect(prompt).toContain("Stable over time");
			expect(prompt).toContain("Non-obvious");
			expect(prompt).toContain("DO NOT extract");
		});

		test("includes all three extraction categories", () => {
			const prompt = buildExtractionPrompt([]);
			expect(prompt).toContain("Technical gotchas and workarounds");
			expect(prompt).toContain("Decision rationale");
			expect(prompt).toContain("User preferences");
		});

		test("does not include project evolution category", () => {
			const prompt = buildExtractionPrompt([]);
			expect(prompt).not.toContain("Project evolution and context");
		});
	});

	describe("update action", () => {
		test("updates existing entry instead of creating duplicate", async () => {
			await store.create({
				name: "docker-networking",
				domain: "docker",
				tags: ["docker", "networking"],
				confidence: 0.6,
				source: "conversation",
				content: "# Docker Networking\n\nOriginal content.",
			});
			expect(store.all()).toHaveLength(1);

			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "update",
						name: "docker-networking",
						domain: "docker",
						tags: ["docker", "networking", "overlay"],
						confidence: 0.7,
						content: "# Docker Networking\n\nUpdated with overlay network insights.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10, "Docker"));

			expect(store.all()).toHaveLength(1);
			const entry = await store.getByName("docker-networking");
			expect(entry!.content).toContain("overlay network insights");
		});

		test("falls back to create when update target does not exist", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "update",
						name: "nonexistent-entry",
						domain: "test",
						tags: ["test"],
						confidence: 0.7,
						content: "# Fallback\n\nCreated because target didn't exist.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));

			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("nonexistent-entry");
		});

		test("entries without action field default to create", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						name: "no-action-field",
						domain: "test",
						tags: ["test"],
						confidence: 0.6,
						content: "# No Action\n\nShould be created.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));

			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("no-action-field");
		});
	});

	test("passes existing SMART names in prompt to model", async () => {
		await store.create({
			name: "existing-one",
			domain: "test",
			tags: ["test"],
			confidence: 0.5,
			source: "conversation",
			content: "First entry.",
		});
		await store.create({
			name: "existing-two",
			domain: "test",
			tags: ["test"],
			confidence: 0.5,
			source: "conversation",
			content: "Second entry.",
		});

		const model = createMockModel({ text: "[]" });
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10));

		// Check the prompt sent to generateText via doGenerateCalls
		const call = model.doGenerateCalls[0]!;
		const prompt = call.prompt as Array<{ role: string; content: Array<{ type: string; text: string }> }>;
		const userPart = prompt.find((p) => p.role === "user");
		const userText = userPart?.content.find((c) => c.type === "text")?.text;
		expect(userText).toContain("- existing-one");
		expect(userText).toContain("- existing-two");
	});

	describe("volatile extraction filter", () => {
		test("rejects entries containing tool inventory counts", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "friday-tools",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "**Current Live Tools (11 total)**:\n- getEnvironmentStatus\n- fs.read",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with 'Visible Tools' pattern", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "friday-visible-tools",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "Visible Tools:\n- fs.read\n- bash.exec",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with 'Current Friday Toolkit' pattern", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "friday-toolkit",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "# Current Friday Modules\n\nFilesystem, Forge",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with hardware stats (GB/cores)", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "env-hardware",
						domain: "project-context",
						tags: ["hardware"],
						confidence: 0.7,
						content: "**Runtime Environment**: 16 cores, 128 GB RAM, load avg 2.5",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with file/entry/test counts", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "smarts-meta",
						domain: "project-context",
						tags: ["smarts"],
						confidence: 0.7,
						content: "SMARTS has 28+ files indexed via FTS5.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with percentage usage stats", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "system-stats",
						domain: "project-context",
						tags: ["system"],
						confidence: 0.7,
						content: "Memory: 75% used, CPU idle at 11% idle most of the time.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("allows non-volatile entries through", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "docker-networking",
						domain: "docker",
						tags: ["docker", "networking"],
						confidence: 0.7,
						content: "# Docker Networking\n\nUse bridge networks for container isolation.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("docker-networking");
		});

		test("filters volatile entries while keeping valid ones in same batch", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "friday-tools-list",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "Friday has 29 tools available.",
					},
					{
						action: "create",
						name: "valid-knowledge",
						domain: "typescript",
						tags: ["ts"],
						confidence: 0.7,
						content: "# TS Tip\n\nUse satisfies for literal type preservation.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("valid-knowledge");
		});
	});

	test("caps confidence at 0.7 for extracted entries", async () => {
		const model = createMockModel({
			text: JSON.stringify([
				{
					action: "create",
					name: "high-confidence",
					domain: "test",
					tags: ["test"],
					confidence: 0.95,
					content: "# High Confidence\n\nShould be capped.",
				},
			]),
		});
		const curator = new SmartsCurator(store, model);
		await curator.extractFromConversation(makeMessages(10));

		const entry = await store.getByName("high-confidence");
		expect(entry!.confidence).toBe(0.7);
	});
});
