import { describe, test, expect, afterEach } from "bun:test";
import { createFridayServer } from "../../src/server/index.ts";

describe("createFridayServer", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;

	afterEach(() => {
		server?.stop(true);
	});

	test("starts HTTP server on given port", async () => {
		server = createFridayServer({ port: 0 });
		expect(server.port).toBeGreaterThan(0);
	});

	test("serves index.html for GET /", async () => {
		server = createFridayServer({ port: 0 });
		const res = await fetch(`http://localhost:${server.port}/`);
		expect(res.status).toBe(200);
	});

	test("upgrades WebSocket connections at /ws", async () => {
		server = createFridayServer({ port: 0 });
		const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
		const opened = await new Promise<boolean>((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onerror = () => resolve(false);
			setTimeout(() => resolve(false), 2000);
		});
		expect(opened).toBe(true);
		ws.close();
	});

	test("WebSocket receives error for chat before boot", async () => {
		server = createFridayServer({ port: 0 });
		const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		const response = await new Promise<any>((resolve) => {
			ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
			ws.send(JSON.stringify({ type: "chat", id: "1", content: "hello" }));
		});
		expect(response.type).toBe("error");
		expect(response.code).toBe("NOT_BOOTED");
		ws.close();
	});
});
