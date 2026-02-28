import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { FridaySocketServer } from "../../src/server/socket.ts";

const TEST_SOCKET = "/tmp/friday-test.sock";
const TEST_PID = "/tmp/friday-test.pid";

afterEach(async () => {
  try { await unlink(TEST_SOCKET); } catch {}
  try { await unlink(TEST_PID); } catch {}
});

describe("FridaySocketServer", () => {
  test("creates socket file on start", async () => {
    const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
    const server = new FridaySocketServer(mockRuntime, TEST_SOCKET, TEST_PID);
    await server.start();

    const pidFile = Bun.file(TEST_PID);
    expect(await pidFile.exists()).toBe(true);
    const pid = await pidFile.text();
    expect(Number.parseInt(pid, 10)).toBe(process.pid);

    await server.stop();
  });

  test("cleans up on stop", async () => {
    const mockRuntime = { isBooted: true, cortex: { providerName: "test", modelName: "test" } } as any;
    const server = new FridaySocketServer(mockRuntime, TEST_SOCKET, TEST_PID);
    await server.start();
    await server.stop();

    const pidFile = Bun.file(TEST_PID);
    expect(await pidFile.exists()).toBe(false);
  });
});
