import { appendFile } from "node:fs/promises";

/** Append a JSON payload to an inference log file with a round separator.
 *  Swallows errors — debug logging must never crash the primary function. */
export async function appendInferenceLog(
  path: string,
  round: number,
  data: unknown,
): Promise<void> {
  try {
    const separator = `\n═══ [${new Date().toISOString()}] Round ${round} ═══════════════════════\n`;
    const json = JSON.stringify(data, null, 2);
    await appendFile(path, separator + json + "\n");
  } catch {
    // Debug logging must never crash the primary function
  }
}
