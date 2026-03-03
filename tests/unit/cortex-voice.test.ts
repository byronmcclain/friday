import { describe, test, expect } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import {
	VoiceWorker,
	type VoiceWorkerConfig,
} from "../../src/core/workers/voice-worker.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { VoiceChatStream } from "../../src/core/stream-types.ts";

describe("Cortex.chatStreamVoice", () => {
	test("returns VoiceChatStream with audioStream", async () => {
		const sent: string[] = [];
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });

		const workerConfig: VoiceWorkerConfig = {
			send: (d) => sent.push(d),
		};
		const worker = new VoiceWorker(workerConfig);

		const stream: VoiceChatStream = await cortex.chatStreamVoice(
			"Hello",
			worker,
		);

		expect(stream.audioStream).toBeDefined();
		expect(stream.toolEvents).toBeDefined();
		expect(stream.textStream).toBeDefined();
		expect(stream.fullText).toBeDefined();

		// session.update should contain enriched system prompt
		const sessionUpdate = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "session.update");
		expect(sessionUpdate).toBeDefined();
		// System prompt should contain the genesis template (default)
		expect(sessionUpdate.session.instructions).toContain("FRIDAY");

		// Simulate Grok response
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Hi there.",
		});
		worker.handleGrokEvent({
			type: "response.output_audio.delta",
			delta: "audiodata",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const fullText = await stream.fullText;
		expect(fullText).toBe("Hi there.");
	});

	test("records voice response in history", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const worker = new VoiceWorker({ send: () => {} });

		const stream = await cortex.chatStreamVoice("What time is it?", worker);

		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "It's noon.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		await stream.fullText;

		// History should have user + assistant messages
		const history = cortex.getHistory();
		expect(history.length).toBeGreaterThanOrEqual(2);
		expect(history[history.length - 2]!.role).toBe("user");
		expect(history[history.length - 2]!.content).toBe("What time is it?");
		expect(history[history.length - 1]!.role).toBe("assistant");
		expect(history[history.length - 1]!.content).toBe("It's noon.");
	});

	test("passes registered tools to VoiceWorker", async () => {
		const sent: string[] = [];
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });

		cortex.registerTool({
			name: "git.status",
			description: "Get git status",
			parameters: [
				{
					name: "path",
					type: "string",
					description: "repo",
					required: true,
				},
			],
			clearance: [],
			execute: async () => ({ success: true, output: "clean" }),
		});

		const worker = new VoiceWorker({ send: (d) => sent.push(d) });
		const stream = await cortex.chatStreamVoice("Check git", worker);

		const sessionUpdate = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "session.update");
		expect(sessionUpdate.session.tools).toHaveLength(1);
		expect(sessionUpdate.session.tools[0].name).toBe("git.status");

		// Complete the turn
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Clean.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});
		await stream.fullText;
	});

	test("does not fire Vox.speak in voice mode", async () => {
		const model = createMockModel({ text: "unused" });
		let voxCalled = false;
		const cortex = new Cortex({
			injectedModel: model,
			vox: {
				mode: "on",
				speak: async () => {
					voxCalled = true;
				},
			} as any,
		});
		const worker = new VoiceWorker({ send: () => {} });
		const stream = await cortex.chatStreamVoice("Hello", worker);

		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Hi.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});
		await stream.fullText;

		expect(voxCalled).toBe(false);
	});
});
