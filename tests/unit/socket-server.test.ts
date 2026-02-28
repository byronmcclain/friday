import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { FridaySocketServer } from "../../src/server/socket.ts";
import { SessionHub } from "../../src/server/session-hub.ts";

const TEST_SOCKET = "/tmp/friday-test.sock";
const TEST_PID = "/tmp/friday-test.pid";

function createMockHub() {
	let registered = false;
	const hub = {
		registerClient: () => { registered = true; },
		unregisterClient: async () => {},
		broadcast: () => {},
		clientCount: 0,
		getClientById: () => undefined,
		get wasRegistered() { return registered; },
	} as any;
	return hub;
}

afterEach(async () => {
	try { await unlink(TEST_SOCKET); } catch {}
	try { await unlink(TEST_PID); } catch {}
});

describe("FridaySocketServer", () => {
	test("creates socket file on start", async () => {
		const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		const pidFile = Bun.file(TEST_PID);
		expect(await pidFile.exists()).toBe(true);
		const pid = await pidFile.text();
		expect(Number.parseInt(pid, 10)).toBe(process.pid);

		await server.stop();
	});

	test("cleans up on stop", async () => {
		const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();
		await server.stop();

		const pidFile = Bun.file(TEST_PID);
		expect(await pidFile.exists()).toBe(false);
	});

	test("registers client with hub on session:identify", async () => {
		const mockRuntime = {
			isBooted: true,
			cortex: { providerName: "test", modelName: "test" },
			protocols: { isProtocol: () => false },
		} as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		const { connect } = await import("node:net");
		const socket = connect({ path: TEST_SOCKET });
		await new Promise<void>((resolve) => { socket.on("connect", resolve); });
		socket.write(JSON.stringify({ type: "session:identify", id: "r1", clientType: "tui" }) + "\n");

		await new Promise((r) => setTimeout(r, 100));
		expect(hub.wasRegistered).toBe(true);

		socket.end();
		await server.stop();
	});
});
