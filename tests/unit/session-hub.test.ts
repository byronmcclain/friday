import { describe, test, expect } from "bun:test";
import { SessionHub } from "../../src/server/session-hub.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

function createMockRuntime(history: { role: string; content: string }[] = []) {
	return {
		cortex: {
			getHistory: () => history,
			clearHistory: () => {
				history.length = 0;
			},
			providerName: "test-provider",
			modelName: "test-model",
		},
		memory: {
			saveConversation: async () => {},
			indexConversation: async () => {},
		},
		isBooted: true,
	} as any;
}

function createMockClient(id: string) {
	const messages: ServerMessage[] = [];
	return {
		client: {
			id,
			clientType: "tui" as const,
			send: (msg: ServerMessage) => {
				messages.push(msg);
			},
			capabilities: new Set(["text"]),
		},
		messages,
	};
}

describe("SessionHub", () => {
	test("starts session on first client register", () => {
		const hub = new SessionHub({ runtime: createMockRuntime() });
		expect(hub.clientCount).toBe(0);

		const { client } = createMockClient("c1");
		hub.registerClient(client);

		expect(hub.clientCount).toBe(1);
	});

	test("hydrates new client with existing history", () => {
		const history = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const hub = new SessionHub({ runtime: createMockRuntime(history) });

		const { client, messages } = createMockClient("c1");
		hub.registerClient(client);

		const replays = messages.filter(
			(m) =>
				m.type === "conversation:message" &&
				(m as any).source === "replay",
		);
		expect(replays).toHaveLength(2);
		expect((replays[0] as any).role).toBe("user");
		expect((replays[0] as any).content).toBe("hello");
		expect((replays[1] as any).role).toBe("assistant");
		expect((replays[1] as any).content).toBe("hi there");
	});

	test("broadcasts to other clients excluding sender", () => {
		const hub = new SessionHub({ runtime: createMockRuntime() });

		const c1 = createMockClient("c1");
		const c2 = createMockClient("c2");
		hub.registerClient(c1.client);
		hub.registerClient(c2.client);

		// Clear hydration messages
		c1.messages.length = 0;
		c2.messages.length = 0;

		hub.broadcast(
			{
				type: "conversation:message",
				role: "user",
				content: "test",
				source: "chat",
			},
			"c1",
		);

		expect(c1.messages).toHaveLength(0);
		expect(c2.messages).toHaveLength(1);
		expect((c2.messages[0] as any).content).toBe("test");
	});

	test("saves conversation on last client disconnect", async () => {
		let saved = false;
		const runtime = createMockRuntime([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		]);
		runtime.memory.saveConversation = async () => {
			saved = true;
		};

		const hub = new SessionHub({ runtime });

		const { client } = createMockClient("c1");
		hub.registerClient(client);
		await hub.unregisterClient("c1");

		expect(saved).toBe(true);
		expect(hub.clientCount).toBe(0);
	});

	test("does NOT save when non-last client disconnects", async () => {
		let saved = false;
		const runtime = createMockRuntime([
			{ role: "user", content: "hello" },
		]);
		runtime.memory.saveConversation = async () => {
			saved = true;
		};

		const hub = new SessionHub({ runtime });

		const c1 = createMockClient("c1");
		const c2 = createMockClient("c2");
		hub.registerClient(c1.client);
		hub.registerClient(c2.client);

		await hub.unregisterClient("c1");

		expect(saved).toBe(false);
		expect(hub.clientCount).toBe(1);
	});

	test("clears cortex history after save on last disconnect", async () => {
		const history = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const runtime = createMockRuntime(history);

		const hub = new SessionHub({ runtime });

		const { client } = createMockClient("c1");
		hub.registerClient(client);
		await hub.unregisterClient("c1");

		expect(history).toHaveLength(0);
	});

	test("reconnect guard: skips clear if client reconnects during save", async () => {
		const history = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		let saveResolve: (() => void) | null = null;
		const runtime = createMockRuntime(history);
		runtime.memory.saveConversation = () =>
			new Promise<void>((resolve) => {
				saveResolve = resolve;
			});

		const hub = new SessionHub({ runtime });

		const c1 = createMockClient("c1");
		hub.registerClient(c1.client);

		// Start unregister (triggers async save)
		const unregisterPromise = hub.unregisterClient("c1");

		// While save is in progress, new client connects
		const c2 = createMockClient("c2");
		hub.registerClient(c2.client);

		// Complete the save
		saveResolve!();
		await unregisterPromise;

		// History should NOT be cleared (c2 reconnected during save)
		expect(history).toHaveLength(2);
		expect(hub.clientCount).toBe(1);
	});

	test("saveIfActive saves without clearing", async () => {
		let saved = false;
		const history = [{ role: "user", content: "hello" }];
		const runtime = createMockRuntime(history);
		runtime.memory.saveConversation = async () => {
			saved = true;
		};

		const hub = new SessionHub({ runtime });
		const { client } = createMockClient("c1");
		hub.registerClient(client);

		await hub.saveIfActive();

		expect(saved).toBe(true);
		// History should NOT be cleared (saveIfActive is for SIGINT, not disconnect)
		expect(history).toHaveLength(1);
	});

	test("does not save when no conversation history", async () => {
		let saved = false;
		const runtime = createMockRuntime([]);
		runtime.memory.saveConversation = async () => {
			saved = true;
		};

		const hub = new SessionHub({ runtime });
		const { client } = createMockClient("c1");
		hub.registerClient(client);
		await hub.unregisterClient("c1");

		expect(saved).toBe(false);
	});
});
