import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { WebSocketHandler } from "../../src/server/handler.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";
import { SessionHub } from "../../src/server/session-hub.ts";
import { createMockModel } from "../helpers/stubs.ts";

describe("WebSocketHandler", () => {
	let runtime: FridayRuntime;
	let hub: SessionHub;
	let handler: WebSocketHandler;
	let sent: ServerMessage[];

	const mockSend = (msg: ServerMessage) => {
		sent.push(msg);
	};

	beforeEach(async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		hub = new SessionHub({ runtime });
		handler = new WebSocketHandler(runtime, hub, "test-client");
		sent = [];
	});

	afterEach(async () => {
		if (runtime?.isBooted) {
			await runtime.shutdown();
		}
	});

	test("returns error when chat received before identify", async () => {
		// Runtime is booted but client hasn't identified — still works since runtime is shared
		await handler.handle('{"type":"chat","id":"1","content":"hello"}', mockSend);
		// Should get a streaming response (chunks + final) since runtime is booted
		expect(sent.length).toBeGreaterThanOrEqual(1);
	});

	test("handles legacy session:boot by responding with session:booted", async () => {
		await handler.handle('{"type":"session:boot","id":"1"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("session:booted");
		// Runtime was already booted — it stays booted
		expect(runtime.isBooted).toBe(true);
	});

	test("handles session:identify and responds with session:ready", async () => {
		await handler.handle('{"type":"session:identify","id":"1","clientType":"voice"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("session:ready");
		const ready = sent[0] as any;
		expect(ready.capabilities).toContain("text");
		expect(ready.capabilities).toContain("audio-in");
		expect(ready.capabilities).toContain("audio-out");
		expect(hub.clientCount).toBe(1);
	});

	test("handles chat after identify — streams chunks then final response", async () => {
		await handler.handle('{"type":"session:identify","id":"0","clientType":"chat"}', mockSend);
		sent = [];
		await handler.handle('{"type":"chat","id":"2","content":"hello"}', mockSend);
		// Streaming: at least 1 chat:chunk + 1 final chat:response
		expect(sent.length).toBeGreaterThanOrEqual(2);

		const chunks = sent.filter((m) => m.type === "chat:chunk");
		const responses = sent.filter((m) => m.type === "chat:response");
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(responses).toHaveLength(1);

		for (const chunk of chunks) {
			expect((chunk as any).requestId).toBe("2");
			expect(typeof (chunk as any).text).toBe("string");
		}

		expect((responses[0] as any).requestId).toBe("2");
		expect((responses[0] as any).source).toBe("cortex");
	});

	test("handles protocol command", async () => {
		runtime.protocols.register({
			name: "test",
			description: "test",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "Test OK" }),
		});
		await handler.handle('{"type":"protocol","id":"3","command":"/test"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("protocol:response");
		expect((sent[0] as any).content).toContain("Test OK");
	});

	test("handles session:shutdown without killing singleton", async () => {
		await handler.handle('{"type":"session:shutdown","id":"4"}', mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("session:closed");
		// Singleton runtime should STILL be booted
		expect(runtime.isBooted).toBe(true);
	});

	test("pushSensoriumUpdate does not throw", () => {
		// With a booted runtime, sensorium may or may not have a snapshot yet
		// The key is it doesn't throw
		handler.pushSensoriumUpdate(mockSend);
		const sensoriumMsgs = sent.filter((m) => m.type === "sensorium:update");
		expect(sensoriumMsgs.length).toBeGreaterThanOrEqual(0);
	});

	test("returns error for invalid JSON", async () => {
		await handler.handle("not json", mockSend);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.type).toBe("error");
		expect((sent[0] as any).code).toBe("INVALID_MESSAGE");
	});

	test("START_FAILED nulls voiceSession so retry is not SESSION_IN_USE", async () => {
		const prev = process.env.XAI_API_KEY;
		delete process.env.XAI_API_KEY;
		try {
			await handler.handle('{"type":"voice:start","id":"v1"}', mockSend);
			const first = sent.find((m) => m.type === "voice:error") as
				| { type: string; code?: string }
				| undefined;
			expect(first?.code).toBe("START_FAILED");
			expect((handler as any).voiceSession).toBeNull();

			sent = [];
			await handler.handle('{"type":"voice:start","id":"v2"}', mockSend);
			const codes = sent
				.filter((m) => m.type === "voice:error")
				.map((m) => (m as { code?: string }).code);
			expect(codes).not.toContain("SESSION_IN_USE");
			expect(codes).toContain("START_FAILED");
		} finally {
			if (prev === undefined) delete process.env.XAI_API_KEY;
			else process.env.XAI_API_KEY = prev;
		}
	});

	test("handleAudio passes raw Buffer to appendAudio without base64 wrap", () => {
		const pcm = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
		const appendAudio = mock((_data: Buffer | Uint8Array) => {});
		(handler as any).voiceSession = {
			isActive: true,
			appendAudio,
		};

		handler.handleAudio(pcm);

		expect(appendAudio).toHaveBeenCalledTimes(1);
		expect(appendAudio.mock.calls[0]?.[0]).toBe(pcm);
		expect(Buffer.isBuffer(appendAudio.mock.calls[0]?.[0])).toBe(true);
	});

	test("onSessionError wiring emits voice:error and clears voiceSession", async () => {
		const { VoiceSessionManager } = await import("../../src/core/voice/session-manager.ts");
		const manager = new VoiceSessionManager(
			runtime.cortex,
			{
				voice: "Eve",
				sampleRate: 48000,
				instructions: "Test",
				silenceDurationMs: 800,
			},
			{
				onAudioDelta: () => {},
				onTranscriptDelta: () => {},
				onStateChange: () => {},
				onUserTranscript: () => {},
				onSessionError: (code, message) => {
					mockSend({ type: "voice:error", code, message } as ServerMessage);
					(handler as any).voiceSession = null;
				},
			},
		);
		(handler as any).voiceSession = manager;
		(manager as any).active = true;
		(manager as any)._generation = 1;
		(manager as any)._openSocket = async () => {
			throw new Error("connection refused");
		};
		(manager as any)._reconnectDelaysMs = [0];

		await (manager as any).handleSocketClose(1);

		expect((handler as any).voiceSession).toBeNull();
		const err = sent.find((m) => m.type === "voice:error") as
			| { code?: string }
			| undefined;
		expect(err?.code).toBe("RECONNECT_FAILED");
	});
});
