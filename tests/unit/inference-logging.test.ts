import { describe, test, expect, afterEach } from "bun:test";
import { unlink, readFile } from "node:fs/promises";
import { appendInferenceLog } from "../../src/providers/debug-log.ts";

const PAYLOAD_LOG = "/tmp/test-inference-payload.log";
const RESPONSE_LOG = "/tmp/test-inference-response.log";

async function cleanup(path: string) {
  try {
    await unlink(path);
  } catch {
    // File may not exist
  }
}

afterEach(async () => {
  await cleanup(PAYLOAD_LOG);
  await cleanup(RESPONSE_LOG);
});

describe("appendInferenceLog", () => {
  test("writes file with round separator and JSON payload", async () => {
    const data = { model: "grok-3", messages: [{ role: "user", content: "hello" }] };
    await appendInferenceLog(PAYLOAD_LOG, 1, data);

    const content = await readFile(PAYLOAD_LOG, "utf-8");
    expect(content).toContain("Round 1");
    expect(content).toContain('"model": "grok-3"');
    expect(content).toContain('"role": "user"');
    expect(content).toContain('"content": "hello"');
  });

  test("appends multiple rounds with separators", async () => {
    const data1 = { round: "first" };
    const data2 = { round: "second" };
    const data3 = { round: "third" };

    await appendInferenceLog(PAYLOAD_LOG, 1, data1);
    await appendInferenceLog(PAYLOAD_LOG, 2, data2);
    await appendInferenceLog(PAYLOAD_LOG, 3, data3);

    const content = await readFile(PAYLOAD_LOG, "utf-8");
    expect(content).toContain("Round 1");
    expect(content).toContain("Round 2");
    expect(content).toContain("Round 3");
    expect(content).toContain('"round": "first"');
    expect(content).toContain('"round": "second"');
    expect(content).toContain('"round": "third"');

    // Verify ordering: Round 1 appears before Round 2, which appears before Round 3
    const idx1 = content.indexOf("Round 1");
    const idx2 = content.indexOf("Round 2");
    const idx3 = content.indexOf("Round 3");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  test("does not throw on write failure (nonexistent directory)", async () => {
    // This path has a directory that doesn't exist — appendFile will fail
    const badPath = "/tmp/nonexistent-dir-abc123/inference.log";

    // Should not throw
    await appendInferenceLog(badPath, 1, { test: true });
  });

  test("separator format includes ISO timestamp and round number", async () => {
    const before = new Date().toISOString().slice(0, 10); // YYYY-MM-DD prefix
    await appendInferenceLog(PAYLOAD_LOG, 42, { x: 1 });
    const content = await readFile(PAYLOAD_LOG, "utf-8");

    // Match the separator pattern: ═══ [ISO_TIMESTAMP] Round N ═══...
    const separatorMatch = content.match(
      /═══ \[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] Round (\d+) ═+/,
    );
    expect(separatorMatch).not.toBeNull();
    const timestamp = separatorMatch?.[1] ?? "";
    const round = separatorMatch?.[2] ?? "";
    expect(timestamp.startsWith(before)).toBe(true);
    expect(round).toBe("42");
  });
});
