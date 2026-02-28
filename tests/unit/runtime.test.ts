import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime, type ShutdownStep } from "../../src/core/runtime.ts";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { GROK_DEFAULTS } from "../../src/providers/index.ts";
import { createMockModel } from "../helpers/stubs.ts";
import { SQLiteMemory } from "../../src/core/memory.ts";

describe("FridayRuntime", () => {
	let runtime: FridayRuntime;

	afterEach(async () => {
		if (runtime?.isBooted) {
			await runtime.shutdown();
		}
	});

	test("boots with default configuration", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.isBooted).toBe(true);
	});

	test("exposes cortex after boot", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.cortex).toBeDefined();
		expect(runtime.cortex.modelName).toBe(GROK_DEFAULTS.model);
	});

	test("exposes protocol registry after boot", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.protocols).toBeDefined();
	});

	test("exposes signal bus after boot", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.signals).toBeDefined();
	});

	test("process routes protocol input to protocol handler", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
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
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.protocols.isProtocol("hello")).toBe(false);
	});

	test("shutdown completes cleanly", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		await runtime.shutdown();
		expect(runtime.isBooted).toBe(false);
	});

	test("shutdown calls onProgress callback for each step", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		const validSteps: ShutdownStep[] = ["arc-rhythm", "vox", "sensorium", "conversation", "knowledge", "modules", "cleanup"];
		const captured: Array<{ step: ShutdownStep; label: string }> = [];
		await runtime.shutdown((step, label) => {
			captured.push({ step, label });
		});
		expect(captured.length).toBeGreaterThan(0);
		for (const { step, label } of captured) {
			expect(validSteps).toContain(step);
			expect(label.length).toBeGreaterThan(0);
		}
		const stepNames = captured.map((c) => c.step);
		expect(stepNames).toContain("modules");
		expect(stepNames).toContain("cleanup");
	});

	test("process throws when not booted", async () => {
		runtime = new FridayRuntime();
		await expect(runtime.process("hello")).rejects.toThrow("Runtime not booted");
	});

	test("shutdown is graceful when not booted", async () => {
		runtime = new FridayRuntime();
		// Should resolve without error (warns instead of throwing)
		await runtime.shutdown();
	});

	test("protocol handler receives rawArgs", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		let receivedArgs: Record<string, unknown> = {};
		runtime.protocols.register({
			name: "deploy",
			description: "deploy",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async (args: Record<string, unknown>) => {
				receivedArgs = args;
				return { success: true, summary: "deployed" };
			},
		});
		await runtime.process("/deploy --env production");
		expect(receivedArgs.rawArgs).toBe("--env production");
	});

	test("boot is idempotent — double boot does not throw", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.isBooted).toBe(true);
	});

	test("restartRequested defaults to false", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.restartRequested).toBe(false);
	});

	test("restartRequested can be set to true", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.restartRequested = true;
		expect(runtime.restartRequested).toBe(true);
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
			injectedModel: createMockModel(),
			smartsDir: TEST_SMARTS_DIR_RT,
		});
		expect(runtime.smarts).toBeDefined();
		expect(runtime.smarts!.all()).toHaveLength(1);
		await runtime.shutdown();
	});

	test("boots without smartsDir (backwards compatible)", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.smarts).toBeUndefined();
		await runtime.shutdown();
	});

	test("shutdown triggers SMARTS extraction for long conversations", async () => {
		const fastModel = createMockModel({ text: "[]" });

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			injectedFastModel: fastModel,
			smartsDir: TEST_SMARTS_DIR_RT,
		});

		// Build up 10+ messages in conversation history (5 user + 5 assistant = 10)
		for (let i = 0; i < 5; i++) {
			await runtime.process(`Message ${i} about security`);
		}

		await runtime.shutdown();
		// The fast model should have been called by the curator for extraction
		expect(fastModel.doGenerateCalls.length).toBeGreaterThan(0);
	});

	test("shutdown skips extraction for short conversations", async () => {
		const fastModel = createMockModel({ text: "[]" });

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			injectedFastModel: fastModel,
			smartsDir: TEST_SMARTS_DIR_RT,
		});

		// Only 2 messages — below threshold
		await runtime.process("Quick question");

		await runtime.shutdown();
		// The fast model should NOT have been called (conversation too short)
		expect(fastModel.doGenerateCalls.length).toBe(0);
	});
});

describe("FridayRuntime — conversation persistence", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = "/tmp/friday-test-data-" + Date.now();
		mkdirSync(dataDir, { recursive: true });
	});

	afterEach(async () => {
		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		await rm(dataDir, { recursive: true, force: true });
	});

	test("boot creates main memory when dataDir is provided", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		expect(runtime.memory).toBeDefined();
		await runtime.shutdown();
	});

	test("memory is undefined when dataDir is not provided", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.memory).toBeUndefined();
		await runtime.shutdown();
	});

	test("conversation is saved on shutdown", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		await runtime.process("Hello Friday");
		await runtime.shutdown();

		const memory = new SQLiteMemory(`${dataDir}/friday.db`);
		const sessions = await memory.getConversationHistory(10);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]!.messages.length).toBeGreaterThanOrEqual(2);
		memory.close();
	});

	test("last session is auto-loaded on boot", async () => {
		const runtime1 = new FridayRuntime();
		await runtime1.boot({ injectedModel: createMockModel(), dataDir });
		await runtime1.process("Hello Friday");
		await runtime1.shutdown();

		const runtime2 = new FridayRuntime();
		await runtime2.boot({ injectedModel: createMockModel(), dataDir });
		expect(runtime2.cortex.historyLength).toBeGreaterThanOrEqual(2);
		await runtime2.shutdown();
	});

	test("history protocol is registered when dataDir is provided", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		const historyProtocol = runtime.protocols.get("history");
		expect(historyProtocol).toBeDefined();
		expect(historyProtocol!.name).toBe("history");
		await runtime.shutdown();
	});

	test("fresh flag skips loading last session", async () => {
		const runtime1 = new FridayRuntime();
		await runtime1.boot({ injectedModel: createMockModel(), dataDir });
		await runtime1.process("Hello Friday");
		await runtime1.shutdown();

		const runtime2 = new FridayRuntime();
		await runtime2.boot({
			injectedModel: createMockModel(),
			dataDir,
			fresh: true,
		});
		expect(runtime2.cortex.historyLength).toBe(0);
		await runtime2.shutdown();
	});

	test("recall_memory tool is registered when dataDir is provided", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		const recallTool = runtime.cortex.availableTools.find((t) => t.name === "recall_memory");
		expect(recallTool).toBeDefined();
		expect(recallTool!.name).toBe("recall_memory");
		await runtime.shutdown();
	});

	test("shutdown reports conversation step via onProgress", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		await runtime.process("Hello Friday");
		const steps: string[] = [];
		await runtime.shutdown((step) => {
			steps.push(step);
		});
		expect(steps).toContain("conversation");
	});
});

describe("FridayRuntime — Sensorium integration", () => {
	test("boots with sensorium enabled by default", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.sensorium).toBeDefined();
		expect(runtime.sensorium!.currentSnapshot).not.toBeNull();
		expect(runtime.sensorium!.isRunning).toBe(true);
		await runtime.shutdown();
	});

	test("sensorium disabled when enableSensorium is false", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			enableSensorium: false,
		});
		expect(runtime.sensorium).toBeUndefined();
		await runtime.shutdown();
	});

	test("shutdown stops sensorium polling", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.sensorium!.isRunning).toBe(true);
		await runtime.shutdown();
	});

	test("/env protocol is registered when sensorium is enabled", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		const envProtocol = runtime.protocols.get("env");
		expect(envProtocol).toBeDefined();
		expect(envProtocol!.name).toBe("env");
		await runtime.shutdown();
	});

	test("process sends environment context in system prompt", async () => {
		const model = createMockModel();

		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: model });
		await runtime.process("What's the system status?");

		const call = model.doStreamCalls[0]!;
		const systemPart = (call.prompt as Array<{ role: string; content: string }>).find(
			(p) => p.role === "system",
		);
		expect(systemPart?.content).toContain("[ENVIRONMENT]");
		expect(systemPart?.content).toContain("cores");

		await runtime.shutdown();
	});

	test("shutdown reports sensorium step via onProgress", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		const steps: string[] = [];
		await runtime.shutdown((step) => {
			steps.push(step);
		});
		expect(steps).toContain("sensorium");
	});
});

describe("FridayRuntime — dual-model architecture", () => {
	test("fastModel returns GROK_DEFAULTS when no override", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.fastModel).toBe(GROK_DEFAULTS.fastModel);
		await runtime.shutdown();
	});

	test("fastModel respects config override", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), fastModel: "custom-fast" });
		expect(runtime.fastModel).toBe("custom-fast");
		await runtime.shutdown();
	});

	test("fastModel respects env var override", async () => {
		const original = process.env.FRIDAY_FAST_MODEL;
		process.env.FRIDAY_FAST_MODEL = "env-fast-model";
		try {
			const runtime = new FridayRuntime();
			await runtime.boot({ injectedModel: createMockModel() });
			expect(runtime.fastModel).toBe("env-fast-model");
			await runtime.shutdown();
		} finally {
			if (original === undefined) {
				delete process.env.FRIDAY_FAST_MODEL;
			} else {
				process.env.FRIDAY_FAST_MODEL = original;
			}
		}
	});
});

describe("FridayRuntime — conversation summarization", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = "/tmp/friday-test-summary-" + Date.now();
		mkdirSync(dataDir, { recursive: true });
	});

	afterEach(async () => {
		await Promise.allSettled([
			unlink(`${dataDir}/friday.db`),
			unlink(`${dataDir}/friday.db-wal`),
			unlink(`${dataDir}/friday.db-shm`),
		]);
		await rm(dataDir, { recursive: true, force: true });
	});

	test("summary populated on shutdown for sufficient history", async () => {
		const fastModel = createMockModel({ text: "Discussed various topics with the user." });
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			injectedFastModel: fastModel,
			dataDir,
		});
		// Need 4+ messages — 2 chat rounds = 4 messages (2 user + 2 assistant)
		await runtime.process("First question");
		await runtime.process("Second question");
		await runtime.shutdown();

		const memory = new SQLiteMemory(`${dataDir}/friday.db`);
		const sessions = await memory.getConversationHistory(10);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]!.summary).toBe("Discussed various topics with the user.");
		memory.close();
	});

	test("summary skipped for short conversations", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel(), dataDir });
		await runtime.process("Quick question");
		await runtime.shutdown();

		const memory = new SQLiteMemory(`${dataDir}/friday.db`);
		const sessions = await memory.getConversationHistory(10);
		expect(sessions).toHaveLength(1);
		// 2 messages (1 user + 1 assistant) is below the 4-message threshold
		expect(sessions[0]!.summary).toBeUndefined();
		memory.close();
	});
});

describe("FridayRuntime — Forge integration", () => {
	let forgeDir: string;

	beforeEach(async () => {
		forgeDir = `/tmp/friday-test-forge-runtime-${Date.now()}`;
		await mkdir(forgeDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(forgeDir, { recursive: true, force: true });
	});

	test("boots with forgeDir and loads forge modules", async () => {
		const modDir = `${forgeDir}/test-mod`;
		await mkdir(modDir, { recursive: true });
		await writeFile(
			`${modDir}/index.ts`,
			`export default {
				name: "test-mod", description: "Test", version: "1.0.0",
				tools: [], protocols: [], knowledge: [], triggers: [], clearance: [],
			};`,
		);

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			forgeDir,
		});
		expect(runtime.forgeHealthReport).toBeDefined();
		expect(runtime.forgeHealthReport!.loaded).toContain("test-mod");
		await runtime.shutdown();
	});

	test("forge module failure does not crash boot", async () => {
		const modDir = `${forgeDir}/broken-mod`;
		await mkdir(modDir, { recursive: true });
		await writeFile(`${modDir}/index.ts`, "throw new Error('broken');");

		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			forgeDir,
		});
		expect(runtime.isBooted).toBe(true);
		expect(runtime.forgeHealthReport!.failed).toHaveLength(1);
		expect(runtime.forgeHealthReport!.failed[0]!.name).toBe("broken-mod");
		await runtime.shutdown();
	});

	test("boots without forgeDir (backwards compatible)", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.forgeHealthReport).toBeUndefined();
		await runtime.shutdown();
	});

	test("/forge protocol is registered when forgeDir is provided", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			forgeDir,
		});
		const forgeProtocol = runtime.protocols.get("forge");
		expect(forgeProtocol).toBeDefined();
		expect(forgeProtocol!.name).toBe("forge");
		await runtime.shutdown();
	});
});

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis-runtime";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("FridayRuntime — Genesis", () => {
	let runtime: FridayRuntime;

	beforeEach(async () => {
		await mkdir(TEST_GENESIS_DIR, { recursive: true });
	});

	afterEach(async () => {
		if (runtime?.isBooted) {
			await runtime.shutdown();
		}
		await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
	});

	test("boots successfully with genesisPath", async () => {
		await writeFile(TEST_GENESIS_PATH, "Custom Friday identity");
		runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			genesisPath: TEST_GENESIS_PATH,
		});
		expect(runtime.isBooted).toBe(true);
	});

	test("fails to boot when genesis file is missing", async () => {
		runtime = new FridayRuntime();
		await expect(
			runtime.boot({
				injectedModel: createMockModel(),
				genesisPath: `${TEST_GENESIS_DIR}/nonexistent.md`,
			}),
		).rejects.toThrow("GENESIS.md not found");
	});

	test("boots without genesisPath (backwards compatible)", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		expect(runtime.isBooted).toBe(true);
	});

	test("sets protected paths when genesisPath is provided", async () => {
		const { isProtectedPath } = await import(
			"../../src/modules/filesystem/containment.ts"
		);
		await writeFile(TEST_GENESIS_PATH, "Custom identity");
		runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			genesisPath: TEST_GENESIS_PATH,
		});
		expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
	});
});

describe("FridayRuntime — debug mode", () => {
	test("passes debug flag to Cortex when enabled", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			enableSensorium: false,
			enableVox: false,
			debug: true,
		});

		const entries = runtime.audit.entries({ action: "debug:enabled" });
		expect(entries).toHaveLength(1);
		expect(entries[0]!.detail).toContain("last-inference-payload.log");

		await runtime.shutdown();
	});

	test("does not log debug:enabled when debug is false", async () => {
		const runtime = new FridayRuntime();
		await runtime.boot({
			injectedModel: createMockModel(),
			enableSensorium: false,
			enableVox: false,
		});

		const entries = runtime.audit.entries({ action: "debug:enabled" });
		expect(entries).toHaveLength(0);

		await runtime.shutdown();
	});
});
