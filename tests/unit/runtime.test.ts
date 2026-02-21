import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import type { LLMProvider } from "../../src/providers/types.ts";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { mkdirSync, rmdirSync } from "node:fs";
import { stubProvider } from "../helpers/stubs.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";

describe("FridayRuntime", () => {
	test("boots with default configuration", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.isBooted).toBe(true);
	});

	test("exposes cortex after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.cortex).toBeDefined();
		expect(runtime.cortex.providerName).toBe("stub");
	});

	test("exposes protocol registry after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.protocols).toBeDefined();
	});

	test("exposes signal bus after boot", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.signals).toBeDefined();
	});

	test("process routes protocol input to protocol handler", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		runtime.protocols.register({
			name: "test",
			description: "test",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "Protocol executed" }),
		});
		const result = await runtime.process("/test");
		expect(result.output).toContain("Protocol executed");
	});

	test("non-protocol input is not detected as protocol", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.protocols.isProtocol("hello")).toBe(false);
	});

	test("shutdown completes cleanly", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		await runtime.shutdown();
		expect(runtime.isBooted).toBe(false);
	});

	test("process throws when not booted", async () => {
		const runtime = new FridayRuntime();
		expect(runtime.process("hello")).rejects.toThrow("Runtime not booted");
	});

	test("shutdown throws when not booted", async () => {
		const runtime = new FridayRuntime();
		expect(runtime.shutdown()).rejects.toThrow("Runtime not booted");
	});

	test("protocol handler receives rawArgs", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		let receivedArgs: Record<string, unknown> = {};
		runtime.protocols.register({
			name: "deploy",
			description: "deploy",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async (args) => {
				receivedArgs = args;
				return { success: true, summary: "deployed" };
			},
		});
		await runtime.process("/deploy --env production");
		expect(receivedArgs.rawArgs).toBe("--env production");
	});

	test("boot is idempotent — double boot does not throw", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.isBooted).toBe(true);
	});
});

const TEST_SMARTS_DIR_RT = "/tmp/friday-test-runtime-smarts";

describe("FridayRuntime — SMARTS integration", () => {
	beforeEach(async () => {
		await mkdir(TEST_SMARTS_DIR_RT, { recursive: true });
		await writeFile(
			`${TEST_SMARTS_DIR_RT}/test-smart.md`,
			`---
name: test-knowledge
domain: testing
tags: [test, unit]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Test Knowledge

This is test knowledge.`,
		);
	});

	afterEach(async () => {
		await rm(TEST_SMARTS_DIR_RT, { recursive: true, force: true });
	});

	test("boots with smartsDir and loads SMARTS", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedProvider: stubProvider,
			smartsDir: TEST_SMARTS_DIR_RT,
		});
		expect(runtime.smarts).toBeDefined();
		expect(runtime.smarts!.all()).toHaveLength(1);
		await runtime.shutdown();
	});

	test("boots without smartsDir (backwards compatible)", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider });
		expect(runtime.smarts).toBeUndefined();
		await runtime.shutdown();
	});

	test("shutdown triggers SMARTS extraction for long conversations", async () => {
		let extractionTriggered = false;
		const capturingProvider: LLMProvider = {
			name: "capturing",
			defaultModel: "capture",
			chat: async (systemPrompt) => {
				if (systemPrompt.includes("knowledge extraction")) {
					extractionTriggered = true;
				}
				return "[]";
			},
		};

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedProvider: capturingProvider,
			smartsDir: TEST_SMARTS_DIR_RT,
		});

		// Build up 10+ messages in conversation history (5 user + 5 assistant = 10)
		for (let i = 0; i < 5; i++) {
			await runtime.process(`Message ${i} about security`);
		}

		await runtime.shutdown();
		expect(extractionTriggered).toBe(true);
	});

	test("shutdown skips extraction for short conversations", async () => {
		let extractionTriggered = false;
		const capturingProvider: LLMProvider = {
			name: "capturing",
			defaultModel: "capture",
			chat: async (systemPrompt) => {
				if (systemPrompt.includes("knowledge extraction")) {
					extractionTriggered = true;
				}
				return "[]";
			},
		};

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedProvider: capturingProvider,
			smartsDir: TEST_SMARTS_DIR_RT,
		});

		// Only 2 messages — below threshold
		await runtime.process("Quick question");

		await runtime.shutdown();
		expect(extractionTriggered).toBe(false);
	});
});

describe("FridayRuntime — conversation persistence", () => {
	test("boot creates main memory when dataDir is provided", async () => {
		const dataDir = "/tmp/friday-test-data-" + Date.now();
		mkdirSync(dataDir, { recursive: true });
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider, dataDir });
		expect(runtime.memory).toBeDefined();
		await runtime.shutdown();
		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		rmdirSync(dataDir);
	});

	test("conversation is saved on shutdown", async () => {
		const dataDir = "/tmp/friday-test-data-" + Date.now();
		mkdirSync(dataDir, { recursive: true });
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedProvider: stubProvider, dataDir });
		await runtime.process("Hello Friday");
		await runtime.shutdown();

		const memory = new SQLiteMemory(`${dataDir}/friday.db`);
		const sessions = await memory.getConversationHistory(10);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]!.messages.length).toBeGreaterThanOrEqual(2);
		memory.close();

		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		rmdirSync(dataDir);
	});

	test("last session is auto-loaded on boot", async () => {
		const dataDir = "/tmp/friday-test-data-" + Date.now();
		mkdirSync(dataDir, { recursive: true });

		const runtime1 = new FridayRuntime();
		await runtime1.boot({ injectedProvider: stubProvider, dataDir });
		await runtime1.process("Hello Friday");
		await runtime1.shutdown();

		const runtime2 = new FridayRuntime();
		await runtime2.boot({ injectedProvider: stubProvider, dataDir });
		expect(runtime2.cortex.historyLength).toBeGreaterThanOrEqual(2);
		await runtime2.shutdown();

		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		rmdirSync(dataDir);
	});

	test("fresh flag skips loading last session", async () => {
		const dataDir = "/tmp/friday-test-data-" + Date.now();
		mkdirSync(dataDir, { recursive: true });

		const runtime1 = new FridayRuntime();
		await runtime1.boot({ injectedProvider: stubProvider, dataDir });
		await runtime1.process("Hello Friday");
		await runtime1.shutdown();

		const runtime2 = new FridayRuntime();
		await runtime2.boot({ injectedProvider: stubProvider, dataDir, fresh: true });
		expect(runtime2.cortex.historyLength).toBe(0);
		await runtime2.shutdown();

		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		rmdirSync(dataDir);
	});
});
