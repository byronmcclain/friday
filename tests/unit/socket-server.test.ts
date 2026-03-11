import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { AuditLogger } from "../../src/audit/logger.ts";
import { FridaySocketServer } from "../../src/server/socket.ts";
import { SessionHub } from "../../src/server/session-hub.ts";

const TEST_SOCKET = "/tmp/friday-test.sock";
const TEST_PID = "/tmp/friday-test.pid";

function createMockHub() {
	let registered = false;
	let unregisterCount = 0;
	const hub = {
		registerClient: () => { registered = true; },
		unregisterClient: async () => { unregisterCount++; },
		broadcast: () => {},
		clientCount: 0,
		getClientById: () => undefined,
		get wasRegistered() { return registered; },
		get unregisterCount() { return unregisterCount; },
	} as any;
	return hub;
}

afterEach(async () => {
	try { await unlink(TEST_SOCKET); } catch {}
	try { await unlink(TEST_PID); } catch {}
});

describe("FridaySocketServer", () => {
	test("creates socket file on start", async () => {
		const mockRuntime = { isBooted: true, cortex: { modelName: "test" }, audit: new AuditLogger() } as any;
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
		const mockRuntime = { isBooted: true, cortex: { modelName: "test" }, audit: new AuditLogger() } as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();
		await server.stop();

		const pidFile = Bun.file(TEST_PID);
		expect(await pidFile.exists()).toBe(false);
	});

	test("session:shutdown does not double-unregister (close handler handles it)", async () => {
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			protocols: { isProtocol: () => false },
			audit: new AuditLogger(),
		} as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		const { connect } = await import("node:net");
		const socket = connect({ path: TEST_SOCKET });
		await new Promise<void>((resolve) => { socket.on("connect", resolve); });
		socket.write(JSON.stringify({ type: "session:identify", id: "r1", clientType: "tui" }) + "\n");
		await new Promise((r) => setTimeout(r, 50));

		// Send session:shutdown — should NOT call unregisterClient
		socket.write(JSON.stringify({ type: "session:shutdown", id: "r2" }) + "\n");
		await new Promise((r) => setTimeout(r, 50));
		expect(hub.unregisterCount).toBe(0);

		// Closing the socket triggers the close handler — single unregister
		socket.end();
		await new Promise((r) => setTimeout(r, 100));
		expect(hub.unregisterCount).toBe(1);

		await server.stop();
	});

	test("registers client with hub on session:identify", async () => {
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			protocols: { isProtocol: () => false },
			audit: new AuditLogger(),
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

	test("broadcasts audit entries via hub", async () => {
		const audit = new AuditLogger();
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			audit,
		} as any;
		const broadcasted: any[] = [];
		const hub = { ...createMockHub(), clientCount: 1, broadcast: (msg: any) => broadcasted.push(msg) } as any;
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		audit.log({ action: "tool:test", source: "test", detail: "test detail", success: true });

		expect(broadcasted).toHaveLength(1);
		expect(broadcasted[0].type).toBe("audit:entry");
		expect(broadcasted[0].action).toBe("tool:test");
		expect(broadcasted[0].source).toBe("test");
		expect(broadcasted[0].detail).toBe("test detail");
		expect(broadcasted[0].success).toBe(true);
		expect(broadcasted[0].timestamp).toBeDefined();

		await server.stop();
	});

	test("skips audit broadcast when no clients connected", async () => {
		const audit = new AuditLogger();
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			audit,
		} as any;
		const broadcasted: any[] = [];
		const hub = { ...createMockHub(), clientCount: 0, broadcast: (msg: any) => broadcasted.push(msg) } as any;
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		audit.log({ action: "tool:test", source: "test", detail: "skipped", success: true });

		expect(broadcasted).toHaveLength(0);

		await server.stop();
	});

	test("adds notification channel on session:identify and removes on close", async () => {
		const addedChannels: string[] = [];
		const removedChannels: string[] = [];
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			protocols: { isProtocol: () => false },
			audit: new AuditLogger(),
			notifications: {
				addChannel: (ch: any) => addedChannels.push(ch.name),
				removeChannel: (name: string) => removedChannels.push(name),
			},
		} as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();

		const { connect } = await import("node:net");
		const socket = connect({ path: TEST_SOCKET });
		await new Promise<void>((resolve) => { socket.on("connect", resolve); });
		socket.write(JSON.stringify({ type: "session:identify", id: "r1", clientType: "tui" }) + "\n");
		await new Promise((r) => setTimeout(r, 100));

		expect(addedChannels).toHaveLength(1);
		expect(addedChannels[0]).toMatch(/^socket-/);

		socket.end();
		await new Promise((r) => setTimeout(r, 100));

		expect(removedChannels).toHaveLength(1);
		expect(removedChannels[0]).toBe(addedChannels[0]);

		await server.stop();
	});

	test("clears audit onLog callback on stop", async () => {
		const audit = new AuditLogger();
		const mockRuntime = {
			isBooted: true,
			cortex: { modelName: "test" },
			audit,
		} as any;
		const hub = createMockHub();
		const server = new FridaySocketServer(mockRuntime, hub, TEST_SOCKET, TEST_PID);
		await server.start();
		expect(audit.onLog).toBeDefined();

		await server.stop();
		expect(audit.onLog).toBeUndefined();
	});
});
