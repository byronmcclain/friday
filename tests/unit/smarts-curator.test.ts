import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SmartsCurator, EXTRACTION_PROMPT } from "../../src/smarts/curator.ts";
import { SmartsStore } from "../../src/smarts/store.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import type { ConversationMessage } from "../../src/core/types.ts";
import { getTextContent } from "../../src/core/types.ts";
import { textResponse } from "../helpers/stubs.ts";
import { unlink, mkdir, rm } from "node:fs/promises";

const TEST_DB = "/tmp/friday-test-curator.db";
const TEST_DIR = "/tmp/friday-test-curator-smarts";

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

  test("skips extraction for short conversations (< 10 messages)", async () => {
    const stubProvider: LLMProvider = {
      name: "stub",
      defaultModel: "stub",
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
      chat: async (_system, messages) => {
        calledWith = getTextContent(messages[messages.length - 1]?.content ?? "");
        return textResponse(JSON.stringify([
          {
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
      chat: async () => textResponse("this is not JSON"),
    };
    const curator = new SmartsCurator(store, badProvider);
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i} about TypeScript`,
    }));
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(0);
  });

  test("handles JSON wrapped in markdown code fences", async () => {
    const fencedProvider: LLMProvider = {
      name: "fenced",
      defaultModel: "fenced",
      chat: async () => textResponse(`Here are the results:

\`\`\`json
[{"name": "fenced-knowledge", "domain": "test", "tags": ["fenced"], "confidence": 0.8, "content": "# Fenced\\n\\nExtracted from fences."}]
\`\`\`

That's what I found.`),
    };
    const curator = new SmartsCurator(store, fencedProvider);
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.name).toBe("fenced-knowledge");
  });

  test("handles provider error gracefully", async () => {
    const failingProvider: LLMProvider = {
      name: "failing",
      defaultModel: "failing",
      chat: async () => { throw new Error("API down"); },
    };
    const curator = new SmartsCurator(store, failingProvider);
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i} about Go programming`,
    }));
    await curator.extractFromConversation(messages);
    expect(store.all()).toHaveLength(0);
  });
});
