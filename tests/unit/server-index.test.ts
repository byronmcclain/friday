import { describe, test, expect, afterEach } from "bun:test";
import { createFridayServer } from "../../src/server/index.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { FridayRuntime } from "../../src/core/runtime.ts";

describe("createFridayServer", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let runtime: FridayRuntime | undefined;

	afterEach(async () => {
		server?.stop(true);
		if (runtime?.isBooted) {
			await runtime.shutdown();
		}
	});

	test("starts HTTP server on given port", async () => {
		const result = await createFridayServer({
			port: 0,
			runtimeConfig: { injectedModel: createMockModel() },
		});
		server = result.server;
		runtime = result.runtime;
		expect(server.port).toBeGreaterThan(0);
	});

	test("serves index.html for GET /", async () => {
		const result = await createFridayServer({
			port: 0,
			runtimeConfig: { injectedModel: createMockModel() },
		});
		server = result.server;
		runtime = result.runtime;
		const res = await fetch(`http://localhost:${server.port}/`);
		expect(res.status).toBe(200);
	});

	test("upgrades WebSocket connections at /ws", async () => {
		const result = await createFridayServer({
			port: 0,
			runtimeConfig: { injectedModel: createMockModel() },
		});
		server = result.server;
		runtime = result.runtime;
		const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
		const opened = await new Promise<boolean>((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onerror = () => resolve(false);
			setTimeout(() => resolve(false), 2000);
		});
		expect(opened).toBe(true);
		ws.close();
	});

	test("WebSocket handles chat after identify (singleton is pre-booted)", async () => {
		const result = await createFridayServer({
			port: 0,
			runtimeConfig: { injectedModel: createMockModel() },
		});
		server = result.server;
		runtime = result.runtime;
		const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		// Identify first
		const identifyResponse = await new Promise<any>((resolve) => {
			ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
			ws.send(JSON.stringify({ type: "session:identify", id: "1", clientType: "chat" }));
		});
		expect(identifyResponse.type).toBe("session:ready");

		// Now send a chat message — should get streaming response since runtime is booted
		const response = await new Promise<any>((resolve) => {
			ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
			ws.send(JSON.stringify({ type: "chat", id: "2", content: "hello" }));
		});
		// First message will be a chat:chunk or chat:response
		expect(["chat:chunk", "chat:response"]).toContain(response.type);
		ws.close();
	});
});
