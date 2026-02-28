import { describe, test, expect, mock } from "bun:test";
import { LocalBridge } from "../../src/core/bridges/local.ts";

describe("LocalBridge", () => {
  test("isBooted delegates to runtime", () => {
    const runtime = { isBooted: true } as any;
    const bridge = new LocalBridge(runtime);
    expect(bridge.isBooted()).toBe(true);
  });

  test("process delegates to runtime.process", async () => {
    const runtime = {
      isBooted: true,
      process: mock(async () => ({ output: "ok", source: "protocol" as const })),
    } as any;
    const bridge = new LocalBridge(runtime);
    const result = await bridge.process("/help");
    expect(result.output).toBe("ok");
    expect(runtime.process).toHaveBeenCalledWith("/help");
  });

  test("chat streams text from cortex", async () => {
    const chunks = ["Hello", " world"];
    const runtime = {
      isBooted: true,
      cortex: {
        chatStream: mock(async () => ({
          textStream: (async function* () {
            for (const c of chunks) yield c;
          })(),
          fullText: Promise.resolve("Hello world"),
        })),
      },
      protocols: { isProtocol: () => false },
    } as any;
    const bridge = new LocalBridge(runtime);
    const collected: string[] = [];
    for await (const chunk of bridge.chat("hi")) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["Hello", " world"]);
  });

  test("chat routes protocol input through runtime.process", async () => {
    const runtime = {
      isBooted: true,
      process: mock(async () => ({ output: "protocol output", source: "protocol" as const })),
      protocols: { isProtocol: (s: string) => s.startsWith("/") },
    } as any;
    const bridge = new LocalBridge(runtime);
    const collected: string[] = [];
    for await (const chunk of bridge.chat("/help")) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["protocol output"]);
  });
});
