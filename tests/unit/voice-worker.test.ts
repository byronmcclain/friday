import { describe, test, expect } from "bun:test";
import {
	VoiceWorker,
	type VoiceWorkerConfig,
} from "../../src/core/workers/voice-worker.ts";
import type { WorkerRequest } from "../../src/core/workers/types.ts";

function makeConfig(
	overrides: Partial<VoiceWorkerConfig> = {},
): VoiceWorkerConfig {
	const sent: string[] = [];
	return {
		send: (data: string) => sent.push(data),
		...overrides,
	};
}

function makeRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
	return {
		systemPrompt: "You are Friday.",
		messages: [{ role: "user" as const, content: "Hello" }],
		tools: [],
		executeTool: async () => "mock result",
		maxToolIterations: 10,
		maxOutputTokens: 4096,
		...overrides,
	};
}

describe("VoiceWorker", () => {
	test("constructs without error", () => {
		const worker = new VoiceWorker(makeConfig());
		expect(worker).toBeDefined();
	});

	test("process sends session.update with system prompt", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(
			makeConfig({ send: (d) => sent.push(d) }),
		);
		worker.process(makeRequest({ systemPrompt: "Custom prompt" }));

		const sessionUpdate = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "session.update");
		expect(sessionUpdate).toBeDefined();
		expect(sessionUpdate.session.instructions).toBe("Custom prompt");
	});

	test("process sends tools in Grok format via session.update", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(
			makeConfig({ send: (d) => sent.push(d) }),
		);
		worker.process(
			makeRequest({
				tools: [
					{
						name: "git.status",
						description: "Get status",
						parameters: [
							{
								name: "path",
								type: "string",
								description: "repo",
								required: true,
							},
						],
					},
				],
			}),
		);

		const sessionUpdate = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "session.update");
		expect(sessionUpdate.session.tools).toHaveLength(1);
		expect(sessionUpdate.session.tools[0].type).toBe("function");
		expect(sessionUpdate.session.tools[0].name).toBe("git.status");
	});

	test("process sends response.create with audio+text modalities", () => {
		const sent: string[] = [];
		const worker = new VoiceWorker(
			makeConfig({ send: (d) => sent.push(d) }),
		);
		worker.process(makeRequest());

		const responseCreate = sent
			.map((s) => JSON.parse(s))
			.find((m) => m.type === "response.create");
		expect(responseCreate).toBeDefined();
		expect(responseCreate.response.modalities).toEqual(["text", "audio"]);
	});

	test("audioStream yields audio deltas from Grok", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({
			type: "response.output_audio.delta",
			delta: "base64audio1",
		});
		worker.handleGrokEvent({
			type: "response.output_audio.delta",
			delta: "base64audio2",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const chunks: string[] = [];
		for await (const chunk of result.audioStream!) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual(["base64audio1", "base64audio2"]);
	});

	test("textStream yields transcript deltas from Grok", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Hello ",
		});
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "there.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toBe("Hello there.");
	});

	test("fullText resolves to complete transcript", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Full ",
		});
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "response.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const full = await result.fullText;
		expect(full).toBe("Full response.");
	});

	test("handles function_call -> executeTool -> function_call_output cycle", async () => {
		const sent: string[] = [];
		const executedTools: Array<{
			name: string;
			args: Record<string, unknown>;
		}> = [];
		const worker = new VoiceWorker(
			makeConfig({ send: (d) => sent.push(d) }),
		);
		const result = worker.process(
			makeRequest({
				executeTool: async (name, args) => {
					executedTools.push({ name, args });
					return "tool result here";
				},
				tools: [
					{
						name: "git.status",
						description: "Status",
						parameters: [
							{
								name: "path",
								type: "string",
								description: "p",
								required: true,
							},
						],
					},
				],
			}),
		);

		// Simulate Grok calling a function
		await worker.handleGrokEvent({
			type: "response.function_call_arguments.done",
			name: "git.status",
			call_id: "call_abc",
			arguments: JSON.stringify({ path: "/repo" }),
		});

		// Tool should have been executed
		expect(executedTools).toHaveLength(1);
		expect(executedTools[0]!.name).toBe("git.status");
		expect(executedTools[0]!.args).toEqual({ path: "/repo" });

		// Should have sent function_call_output + response.create
		const outputMsg = sent
			.map((s) => JSON.parse(s))
			.find(
				(m) =>
					m.type === "conversation.item.create" &&
					m.item?.type === "function_call_output",
			);
		expect(outputMsg).toBeDefined();
		expect(outputMsg.item.call_id).toBe("call_abc");
		expect(outputMsg.item.output).toBe("tool result here");

		const continueMsg = sent
			.map((s) => JSON.parse(s))
			.filter((m) => m.type === "response.create");
		// At least 2: initial + after tool
		expect(continueMsg.length).toBeGreaterThanOrEqual(2);

		// Now Grok responds with audio after tool result
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "Done.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const full = await result.fullText;
		expect(full).toBe("Done.");
	});

	test("toolEvents emits start and result events", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(
			makeRequest({
				executeTool: async () => "ok",
				tools: [
					{
						name: "bash.exec",
						description: "Run",
						parameters: [
							{
								name: "cmd",
								type: "string",
								description: "c",
								required: true,
							},
						],
					},
				],
			}),
		);

		await worker.handleGrokEvent({
			type: "response.function_call_arguments.done",
			name: "bash.exec",
			call_id: "call_1",
			arguments: JSON.stringify({ cmd: "ls" }),
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const events = [];
		for await (const ev of result.toolEvents) {
			events.push(ev);
		}
		expect(events).toHaveLength(2);
		expect(events[0]!.type).toBe("start");
		expect(events[0]!.toolName).toBe("bash.exec");
		expect(events[1]!.type).toBe("result");
		expect(events[1]!.result).toBe("ok");
	});

	test("response.done with cancelled status does not close streams", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "cancelled" },
		});
		// Streams should still be open — push more data
		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "After cancel.",
		});
		worker.handleGrokEvent({
			type: "response.done",
			response: { status: "completed" },
		});

		const full = await result.fullText;
		expect(full).toBe("After cancel.");
	});

	test("abort() terminates all streams", async () => {
		const worker = new VoiceWorker(makeConfig());
		const result = worker.process(makeRequest());

		worker.handleGrokEvent({
			type: "response.output_audio_transcript.delta",
			delta: "partial",
		});
		worker.abort();

		// Streams should terminate
		const full = await result.fullText;
		expect(full).toBe("partial");
	});
});
