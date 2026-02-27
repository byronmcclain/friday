import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsCurator, EXTRACTION_PROMPT, buildExtractionPrompt } from "../../src/smarts/curator.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { getTextContent } from "../../src/core/types.ts";
import { textResponse, createMockModel } from "../helpers/stubs.ts";
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

	test("EXTRACTION_PROMPT is defined and non-empty", () => {
		expect(EXTRACTION_PROMPT).toBeDefined();
		expect(EXTRACTION_PROMPT.length).toBeGreaterThan(0);
	});

	test("skips extraction for short conversations (< 4 messages)", async () => {
		const stubProvider: LLMProvider = {
			name: "stub",
			defaultModel: "stub",
			defaultFastModel: "stub-fast",
			chat: async () => textResponse("should not be called"),
		};
		const curator = new SmartsCurator(store, stubProvider);
		const messages: ConversationMessage[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
		];
		await curator.extractFromConversation(messages);
		expect(store.all()).toHaveLength(0);
	});

	test("calls provider with extraction prompt for long conversations", async () => {
		let calledWith = "";
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async (_system, messages) => {
				calledWith = getTextContent(messages[messages.length - 1]?.content ?? "");
				return textResponse(JSON.stringify([
					{
						action: "create",
						name: "docker-networking",
						domain: "docker",
						tags: ["docker", "networking", "bridge"],
						confidence: 0.7,
						content: "# Docker Networking\n\nUse bridge networks for container isolation.",
					},
				]));
			},
		};
		const curator = new SmartsCurator(store, mockProvider);
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
		expect(calledWith).toContain("Docker");
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("docker-networking");
		expect(store.all()[0]!.source).toBe("conversation");
	});

	test("handles malformed provider response gracefully", async () => {
		const badProvider: LLMProvider = {
			name: "bad",
			defaultModel: "bad",
			defaultFastModel: "bad-fast",
			chat: async () => textResponse("this is not JSON"),
		};
		const curator = new SmartsCurator(store, badProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(0);
	});

	test("handles JSON wrapped in markdown code fences", async () => {
		const fencedProvider: LLMProvider = {
			name: "fenced",
			defaultModel: "fenced",
			defaultFastModel: "fenced-fast",
			chat: async () => textResponse(`Here are the results:

\`\`\`json
[{"action": "create", "name": "fenced-knowledge", "domain": "test", "tags": ["fenced"], "confidence": 0.8, "content": "# Fenced\\n\\nExtracted from fences."}]
\`\`\`

That's what I found.`),
		};
		const curator = new SmartsCurator(store, fencedProvider);
		await curator.extractFromConversation(makeMessages(10));
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0]!.name).toBe("fenced-knowledge");
	});

	test("uses provided fast model in chat call", async () => {
		let usedModel = "";
		const modelCapture: LLMProvider = {
			name: "model-capture",
			defaultModel: "default-reasoning",
			defaultFastModel: "default-fast",
			chat: async (_system, _messages, options) => {
				usedModel = options.model;
				return textResponse("[]");
			},
		};
		const curator = new SmartsCurator(store, modelCapture, "custom-fast-model");
		await curator.extractFromConversation(makeMessages(10));
		expect(usedModel).toBe("custom-fast-model");
	});

	test("falls back to defaultFastModel when no fast model given", async () => {
		let usedModel = "";
		const modelCapture: LLMProvider = {
			name: "model-capture",
			defaultModel: "default-reasoning",
			defaultFastModel: "default-fast",
			chat: async (_system, _messages, options) => {
				usedModel = options.model;
				return textResponse("[]");
			},
		};
		const curator = new SmartsCurator(store, modelCapture);
		await curator.extractFromConversation(makeMessages(10));
		expect(usedModel).toBe("default-fast");
	});

	test("falls back to defaultFastModel not expensive reasoning model", () => {
		const provider = { defaultModel: "expensive-model", defaultFastModel: "cheap-model" } as LLMProvider;
		const curator = new SmartsCurator(store, provider);
		expect(curator["model"]).toBe("cheap-model");
	});

	test("handles provider error gracefully", async () => {
		const failingProvider: LLMProvider = {
			name: "failing",
			defaultModel: "failing",
			defaultFastModel: "failing-fast",
			chat: async () => { throw new Error("API down"); },
		};
		const curator = new SmartsCurator(store, failingProvider);
		await curator.extractFromConversation(makeMessages(10, "Go programming"));
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
			// Seed an existing entry
			await store.create({
				name: "docker-networking",
				domain: "docker",
				tags: ["docker", "networking"],
				confidence: 0.6,
				source: "conversation",
				content: "# Docker Networking\n\nOriginal content.",
			});
			expect(store.all()).toHaveLength(1);

			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "update",
						name: "docker-networking",
						domain: "docker",
						tags: ["docker", "networking", "overlay"],
						confidence: 0.7,
						content: "# Docker Networking\n\nUpdated with overlay network insights.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10, "Docker"));

			expect(store.all()).toHaveLength(1);
			const entry = await store.getByName("docker-networking");
			expect(entry!.content).toContain("overlay network insights");
		});

		test("falls back to create when update target does not exist", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "update",
						name: "nonexistent-entry",
						domain: "test",
						tags: ["test"],
						confidence: 0.7,
						content: "# Fallback\n\nCreated because target didn't exist.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));

			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("nonexistent-entry");
		});

		test("entries without action field default to create", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						name: "no-action-field",
						domain: "test",
						tags: ["test"],
						confidence: 0.6,
						content: "# No Action\n\nShould be created.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));

			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("no-action-field");
		});
	});

	test("passes existing SMART names in prompt to provider", async () => {
		let capturedSystem = "";
		// Seed existing entries
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

		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async (system) => {
				capturedSystem = system;
				return textResponse("[]");
			},
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));

		expect(capturedSystem).toContain("- existing-one");
		expect(capturedSystem).toContain("- existing-two");
	});

	describe("volatile extraction filter", () => {
		test("rejects entries containing tool inventory counts", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "friday-tools",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "**Current Live Tools (11 total)**:\n- getEnvironmentStatus\n- fs.read",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with 'Visible Tools' pattern", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "friday-visible-tools",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "Visible Tools:\n- fs.read\n- bash.exec",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with 'Current Friday Toolkit' pattern", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "friday-toolkit",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "# Current Friday Modules\n\nFilesystem, Forge",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with hardware stats (GB/cores)", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "env-hardware",
						domain: "project-context",
						tags: ["hardware"],
						confidence: 0.7,
						content: "**Runtime Environment**: 16 cores, 128 GB RAM, load avg 2.5",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with file/entry/test counts", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "smarts-meta",
						domain: "project-context",
						tags: ["smarts"],
						confidence: 0.7,
						content: "SMARTS has 28+ files indexed via FTS5.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("rejects entries with percentage usage stats", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "system-stats",
						domain: "project-context",
						tags: ["system"],
						confidence: 0.7,
						content: "Memory: 75% used, CPU idle at 11% idle most of the time.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("allows non-volatile entries through", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
					{
						action: "create",
						name: "docker-networking",
						domain: "docker",
						tags: ["docker", "networking"],
						confidence: 0.7,
						content: "# Docker Networking\n\nUse bridge networks for container isolation.",
					},
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("docker-networking");
		});

		test("filters volatile entries while keeping valid ones in same batch", async () => {
			const mockProvider: LLMProvider = {
				name: "mock",
				defaultModel: "mock",
				defaultFastModel: "mock-fast",
				chat: async () => textResponse(JSON.stringify([
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
				])),
			};
			const curator = new SmartsCurator(store, mockProvider);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("valid-knowledge");
		});
	});

	test("caps confidence at 0.7 for extracted entries", async () => {
		const mockProvider: LLMProvider = {
			name: "mock",
			defaultModel: "mock",
			defaultFastModel: "mock-fast",
			chat: async () => textResponse(JSON.stringify([
				{
					action: "create",
					name: "high-confidence",
					domain: "test",
					tags: ["test"],
					confidence: 0.95,
					content: "# High Confidence\n\nShould be capped.",
				},
			])),
		};
		const curator = new SmartsCurator(store, mockProvider);
		await curator.extractFromConversation(makeMessages(10));

		const entry = await store.getByName("high-confidence");
		expect(entry!.confidence).toBe(0.7);
	});

	describe("AI SDK LanguageModelV3 path", () => {
		test("extracts knowledge using generateText() with AI SDK model", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "ai-sdk-knowledge",
						domain: "typescript",
						tags: ["ai-sdk", "migration"],
						confidence: 0.7,
						content: "# AI SDK\n\nUse generateText() for simple completions.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10, "AI SDK migration"));

			expect(store.all()).toHaveLength(1);
			expect(store.all()[0]!.name).toBe("ai-sdk-knowledge");
			expect(store.all()[0]!.source).toBe("conversation");
		});

		test("skips short conversations with AI SDK model", async () => {
			const model = createMockModel({ text: "should not be called" });
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation([
				{ role: "user", content: "Hi" },
				{ role: "assistant", content: "Hello!" },
			]);
			expect(store.all()).toHaveLength(0);
		});

		test("handles malformed response from AI SDK model", async () => {
			const model = createMockModel({ text: "this is not JSON" });
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("handles empty array response from AI SDK model", async () => {
			const model = createMockModel({ text: "[]" });
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));
			expect(store.all()).toHaveLength(0);
		});

		test("filters volatile entries via AI SDK model path", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "tool-count",
						domain: "project-context",
						tags: ["tools"],
						confidence: 0.7,
						content: "Friday has 29 tools available.",
					},
					{
						action: "create",
						name: "valid-insight",
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
			expect(store.all()[0]!.name).toBe("valid-insight");
		});

		test("caps confidence at 0.7 via AI SDK model path", async () => {
			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "create",
						name: "high-conf-ai-sdk",
						domain: "test",
						tags: ["test"],
						confidence: 0.95,
						content: "# High Confidence\n\nShould be capped.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));

			const entry = await store.getByName("high-conf-ai-sdk");
			expect(entry!.confidence).toBe(0.7);
		});

		test("uses modelId from LanguageModelV3 as internal model", () => {
			const model = createMockModel({ text: "[]" });
			const curator = new SmartsCurator(store, model);
			expect(curator["model"]).toBe(model.modelId);
		});

		test("update action works via AI SDK model path", async () => {
			// Seed an existing entry
			await store.create({
				name: "existing-entry",
				domain: "test",
				tags: ["test"],
				confidence: 0.6,
				source: "conversation",
				content: "# Existing\n\nOriginal content.",
			});

			const model = createMockModel({
				text: JSON.stringify([
					{
						action: "update",
						name: "existing-entry",
						domain: "test",
						tags: ["test", "updated"],
						confidence: 0.7,
						content: "# Existing\n\nUpdated with new insights.",
					},
				]),
			});
			const curator = new SmartsCurator(store, model);
			await curator.extractFromConversation(makeMessages(10));

			expect(store.all()).toHaveLength(1);
			const entry = await store.getByName("existing-entry");
			expect(entry!.content).toContain("new insights");
		});
	});
});
