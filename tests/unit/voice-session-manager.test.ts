import { describe, test, expect, mock } from "bun:test";
import {
	VoiceSessionManager,
	type VoiceSessionConfig,
	type VoiceSessionCallbacks,
} from "../../src/core/voice/session-manager.ts";
import { Cortex } from "../../src/core/cortex.ts";
import { VoiceWorker } from "../../src/core/workers/voice-worker.ts";
import { createMockModel } from "../helpers/stubs.ts";

function makeMockCallbacks(): VoiceSessionCallbacks {
	return {
		onAudioDelta: mock(() => {}),
		onTranscriptDelta: mock(() => {}),
		onStateChange: mock(() => {}),
		onUserTranscript: mock(() => {}),
	};
}

/** Simulate Grok WebSocket that auto-acks session.update and auto-completes response.create */
function attachMockWs(manager: VoiceSessionManager): string[] {
	const sent: string[] = [];
	const ws = {
		send: (d: string) => {
			sent.push(d);
			const parsed = JSON.parse(d);
			if (parsed.type === "session.update") {
				setTimeout(() => {
					(manager as any).handleGrokMessage(
						JSON.stringify({ type: "session.updated" }),
					);
				}, 0);
			}
			if (parsed.type === "response.create") {
				// Auto-complete the response so processVoiceTurn doesn't hang
				setTimeout(() => {
					(manager as any).handleGrokMessage(
						JSON.stringify({
							type: "response.done",
							response: { status: "completed" },
						}),
					);
				}, 0);
			}
		},
		readyState: 1,
		close: () => {},
	};
	(manager as any).grokWs = ws;
	(manager as any).active = true;
	// Create VoiceWorker bound to mock ws so processVoiceTurn can use it
	(manager as any).voiceWorker = new VoiceWorker({
		send: (data: string) => ws.send(data),
	});
	return sent;
}

describe("VoiceSessionManager", () => {
	test("constructs without error", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const config: VoiceSessionConfig = {
			voice: "Eve",
			sampleRate: 48000,
			instructions: "Test",
		};
		const manager = new VoiceSessionManager(
			cortex,
			config,
			makeMockCallbacks(),
		);
		expect(manager).toBeDefined();
		expect(manager.isActive).toBe(false);
	});

	test("appendAudio forwards to Grok WebSocket", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const config: VoiceSessionConfig = {
			voice: "Eve",
			sampleRate: 48000,
			instructions: "Test",
		};
		const manager = new VoiceSessionManager(
			cortex,
			config,
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		manager.appendAudio("base64pcm");

		const audioMsg = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "input_audio_buffer.append");
		expect(audioMsg).toBeDefined();
		expect(audioMsg.audio).toBe("base64pcm");
	});

	test("speech_started triggers listening state", () => {
		const callbacks = makeMockCallbacks();
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		attachMockWs(manager);

		(manager as any).handleGrokMessage(
			JSON.stringify({
				type: "input_audio_buffer.speech_started",
			}),
		);

		expect(callbacks.onStateChange).toHaveBeenCalledWith("listening");
	});

	test("transcript routes through Cortex voice pathway", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		const sent = attachMockWs(manager);

		// Simulate transcript
		await (manager as any).handleGrokMessage(
			JSON.stringify({
				type: "conversation.item.input_audio_transcription.completed",
				transcript: "What is the git status?",
			}),
		);

		// Should have called cortex.chatStreamVoice -> VoiceWorker -> session.update + response.create
		const parsed = sent.map((s) => JSON.parse(s));
		const sessionUpdate = parsed.find(
			(m) =>
				m.type === "session.update" &&
				m.session?.instructions?.includes("FRIDAY"),
		);
		expect(sessionUpdate).toBeDefined();

		// Voice delivery rules should be injected by Cortex.chatStreamVoice
		const instructions = sessionUpdate.session.instructions;
		expect(instructions).toContain("VOICE DELIVERY RULES");
		expect(instructions).toContain("County Tipperary");

		const responseCreate = parsed.find((m) => m.type === "response.create");
		expect(responseCreate).toBeDefined();
	});

	test("cancels unexpected auto-responses", () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		// Simulate unexpected response.created (auto-response from VAD)
		(manager as any).handleGrokMessage(
			JSON.stringify({
				type: "response.created",
				response: { id: "auto-123" },
			}),
		);

		const cancel = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "response.cancel");
		expect(cancel).toBeDefined();
	});

	test("stop cleans up state", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test" },
			callbacks,
		);
		attachMockWs(manager);

		await manager.stop();

		expect(manager.isActive).toBe(false);
		expect(callbacks.onStateChange).toHaveBeenCalledWith("idle");
	});
});
