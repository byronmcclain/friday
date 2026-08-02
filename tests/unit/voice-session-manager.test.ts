import { describe, expect, mock, test } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { VOICE_SESSION_GREETING } from "../../src/core/voice/force-message.ts";
import {
	buildInitialSessionPayload,
	type VoiceSessionCallbacks,
	type VoiceSessionConfig,
	VoiceSessionManager,
	type VoiceState,
} from "../../src/core/voice/session-manager.ts";
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
					(manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
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
			silenceDurationMs: 800,
		};
		const manager = new VoiceSessionManager(cortex, config, makeMockCallbacks());
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
			silenceDurationMs: 800,
		};
		const manager = new VoiceSessionManager(cortex, config, makeMockCallbacks());
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
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
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
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
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
			(m) => m.type === "session.update" && m.session?.instructions?.includes("FRIDAY"),
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
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
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

		const cancel = sent.map((s) => JSON.parse(s)).find((m) => m.type === "response.cancel");
		expect(cancel).toBeDefined();
	});

	test("sends force_message greeting after session.updated", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));

		const parsed = sent.map((s) => JSON.parse(s));
		const force = parsed.find((m) => m.item?.type === "force_message");
		expect(force).toBeDefined();
		expect(force.item.content[0].text).toBe(VOICE_SESSION_GREETING);
		expect(force.item.interruptible).toBe(true);

		const responseCreateAfterGreeting = parsed.findIndex(
			(m, i) => m.type === "response.create" && i > parsed.indexOf(force),
		);
		expect(responseCreateAfterGreeting).toBe(-1);
	});

	test("does not cancel the force_message greeting response", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		await (manager as any).handleGrokMessage(
			JSON.stringify({ type: "response.created", response: { id: "greet-1" } }),
		);

		const cancel = sent.map((s) => JSON.parse(s)).find((m) => m.type === "response.cancel");
		expect(cancel).toBeUndefined();
		expect((manager as any)._pendingGreetingResponseId).toBe("greet-1");
	});

	test("response.done for the greeting clears the pending greeting id", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		await (manager as any).handleGrokMessage(
			JSON.stringify({ type: "response.created", response: { id: "greet-1" } }),
		);
		await (manager as any).handleGrokMessage(
			JSON.stringify({
				type: "response.done",
				response: { id: "greet-1", status: "completed" },
			}),
		);

		expect((manager as any)._pendingGreetingResponseId).toBeNull();
	});

	test("a genuine unexpected auto-response is still cancelled after the greeting settles", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		await (manager as any).handleGrokMessage(
			JSON.stringify({ type: "response.created", response: { id: "greet-1" } }),
		);
		await (manager as any).handleGrokMessage(
			JSON.stringify({
				type: "response.done",
				response: { id: "greet-1", status: "completed" },
			}),
		);

		// A second, unrelated response.created after the greeting has settled
		// should be treated as an unexpected auto-response and cancelled.
		await (manager as any).handleGrokMessage(
			JSON.stringify({ type: "response.created", response: { id: "auto-2" } }),
		);

		const cancel = sent.map((s) => JSON.parse(s)).find((m) => m.type === "response.cancel");
		expect(cancel).toBeDefined();
	});

	test("does not re-greet on mid-session reconnect", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		const greetingCount = sent
			.map((s) => JSON.parse(s))
			.filter((m) => m.item?.type === "force_message").length;
		expect(greetingCount).toBe(1);

		// Simulate reconnect session.updated — should not greet again
		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		const afterReconnect = sent
			.map((s) => JSON.parse(s))
			.filter((m) => m.item?.type === "force_message").length;
		expect(afterReconnect).toBe(1);
	});

	test("re-greets after stop then start", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			makeMockCallbacks(),
		);
		const sent = attachMockWs(manager);

		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));
		await manager.stop();

		const sent2 = attachMockWs(manager);
		await (manager as any).handleGrokMessage(JSON.stringify({ type: "session.updated" }));

		const greetingCount = [...sent, ...sent2]
			.map((s) => JSON.parse(s))
			.filter((m) => m.item?.type === "force_message").length;
		expect(greetingCount).toBe(2);
	});

	test("stop cleans up state", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		attachMockWs(manager);

		await manager.stop();

		expect(manager.isActive).toBe(false);
		expect(callbacks.onStateChange).toHaveBeenCalledWith("idle");
	});
});

describe("VoiceSessionManager reconnect", () => {
	test("stores conversation id from conversation.created", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		attachMockWs(manager);
		await (manager as any).handleGrokMessage(
			JSON.stringify({
				type: "conversation.created",
				conversation: { id: "conv_123" },
			}),
		);
		expect((manager as any)._conversationId).toBe("conv_123");
	});

	test("unexpected close while active emits reconnecting then reopens", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const states: string[] = [];
		const callbacks = makeMockCallbacks();
		callbacks.onStateChange = mock((s: string) => {
			states.push(s);
		});
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		(manager as any).active = true;
		(manager as any)._generation = 1;
		(manager as any)._conversationId = "conv_123";

		// Inject a fake reconnect opener that resolves immediately
		const opens: Array<{ conversationId?: string }> = [];
		(manager as any)._openSocket = async (opts: { conversationId?: string }) => {
			opens.push(opts);
			const ws = {
				send: mock(() => {}),
				readyState: 1,
				close: mock(() => {}),
				addEventListener: mock(() => {}),
			};
			(manager as any).grokWs = ws;
			return ws;
		};
		(manager as any)._reconnectDelaysMs = [0]; // no wait in tests

		await (manager as any).handleSocketClose(1);
		expect(states).toContain("reconnecting");
		expect(opens[0]?.conversationId).toBe("conv_123");
	});

	test("stop() cancels reconnect loop", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		attachMockWs(manager);

		let openSocketCalled = false;
		(manager as any)._openSocket = async () => {
			openSocketCalled = true;
			throw new Error("should not be called after stop()");
		};
		(manager as any)._reconnectDelaysMs = [0];

		await manager.stop();
		// Close handler fires after stop() has already reset generation/active.
		await (manager as any).handleSocketClose((manager as any)._generation);

		expect(openSocketCalled).toBe(false);
	});

	test("mid-turn close orphans old worker but stop() does not hang", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);

		// A ws that never auto-completes response.create, so the turn
		// stays in-flight (simulating a close arriving mid-turn).
		const ws = {
			send: mock((_data: string) => {}),
			readyState: 1,
			close: mock(() => {}),
		};
		(manager as any).grokWs = ws;
		(manager as any).active = true;
		(manager as any)._generation = 1;
		(manager as any).voiceWorker = new VoiceWorker({
			send: (data: string) => ws.send(data),
		});

		// Kick off a turn but don't await it here -- it won't resolve on
		// its own since nothing ever sends response.done.
		const turnStarted = (manager as any).handleGrokMessage(
			JSON.stringify({
				type: "conversation.item.input_audio_transcription.completed",
				transcript: "hello",
			}),
		);
		await Bun.sleep(0);
		expect((manager as any)._activeTurn).not.toBeNull();
		expect((manager as any).voiceWorker.isProcessing).toBe(true);

		// Reconnect opener resolves immediately.
		(manager as any)._openSocket = async () => ({
			send: mock(() => {}),
			readyState: 1,
			close: mock(() => {}),
			addEventListener: mock(() => {}),
		});
		(manager as any)._reconnectDelaysMs = [0];

		// Simulate the socket closing mid-turn and reconnecting.
		await (manager as any).handleSocketClose(1);

		// The orphaned turn must have been unwound -- not left dangling.
		expect((manager as any)._activeTurn).toBeNull();

		// stop() must complete promptly instead of hanging on the orphaned turn.
		const hungTimeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error("stop() hung awaiting orphaned turn")), 1000),
		);
		await Promise.race([manager.stop(), hungTimeout]);
		expect(manager.isActive).toBe(false);

		// Let the original in-flight handleGrokMessage settle so it doesn't leak.
		await turnStarted;
	});

	test("exhausted reconnect attempts emit error state", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const states: string[] = [];
		callbacks.onStateChange = mock((s: string) => {
			states.push(s);
		});
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		(manager as any).active = true;
		(manager as any)._generation = 1;

		(manager as any)._openSocket = async () => {
			throw new Error("connection refused");
		};
		(manager as any)._reconnectDelaysMs = [0, 0];

		await (manager as any).handleSocketClose(1);
		expect(states).toContain("reconnecting");
		expect(states[states.length - 1]).toBe("error");
		expect((manager as any).active).toBe(false);
	});

	test("exhausted reconnect attempts notify onSessionError", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const onSessionError = mock((_code: string, _message: string) => {});
		const callbacks: VoiceSessionCallbacks = { ...makeMockCallbacks(), onSessionError };
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		(manager as any).active = true;
		(manager as any)._generation = 1;

		(manager as any)._openSocket = async () => {
			throw new Error("connection refused");
		};
		(manager as any)._reconnectDelaysMs = [0, 0];

		await (manager as any).handleSocketClose(1);

		expect(onSessionError).toHaveBeenCalledTimes(1);
		expect(onSessionError.mock.calls[0]?.[0]).toBe("RECONNECT_FAILED");
	});

	test("drops a stale conversation id after a failed reconnect attempt", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		(manager as any).active = true;
		(manager as any)._generation = 1;
		(manager as any)._conversationId = "stale-conv";

		const opens: Array<{ conversationId?: string }> = [];
		let attempt = 0;
		(manager as any)._openSocket = async (opts: { conversationId?: string }) => {
			opens.push(opts);
			attempt++;
			if (attempt === 1) throw new Error("conversation not found");
			return {
				send: mock(() => {}),
				readyState: 1,
				close: mock(() => {}),
				addEventListener: mock(() => {}),
			};
		};
		(manager as any)._reconnectDelaysMs = [0, 0];

		await (manager as any).handleSocketClose(1);

		expect(opens[0]?.conversationId).toBe("stale-conv");
		expect(opens[1]?.conversationId).toBeUndefined();
	});

	test("clears assistant transcript buffer on socket close", async () => {
		const model = createMockModel({ text: "unused" });
		const cortex = new Cortex({ injectedModel: model });
		const callbacks = makeMockCallbacks();
		const manager = new VoiceSessionManager(
			cortex,
			{ voice: "Eve", sampleRate: 48000, instructions: "Test", silenceDurationMs: 800 },
			callbacks,
		);
		(manager as any).active = true;
		(manager as any)._generation = 1;
		(manager as any)._assistantBuffer = "orphaned partial transcript";
		(manager as any)._openSocket = async () => {
			throw new Error("connection refused");
		};
		(manager as any)._reconnectDelaysMs = [0];

		await (manager as any).handleSocketClose(1);

		expect((manager as any)._assistantBuffer).toBe("");
	});
});

test("VoiceState includes reconnecting", () => {
	const states: VoiceState[] = [
		"idle",
		"listening",
		"thinking",
		"speaking",
		"reconnecting",
		"error",
	];
	expect(states).toContain("reconnecting");
});

test("initial session.update includes silence_duration_ms and resumption", () => {
	const payload = buildInitialSessionPayload({
		voice: "Eve",
		sampleRate: 48000,
		instructions: "Test",
		silenceDurationMs: 600,
	});

	expect(payload.session.turn_detection.silence_duration_ms).toBe(600);
	expect(payload.session.resumption).toEqual({ enabled: true });
	expect(payload.session.turn_detection.create_response).toBe(false);
});
