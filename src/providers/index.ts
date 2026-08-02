import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";

export const GROK_DEFAULTS = {
	model: "grok-4.20-reasoning",
	fastModel: "grok-4.20-non-reasoning",
} as const;

// Create provider once at module load with cached API key —
// avoids per-call process.env lookup inside the xAI provider's getHeaders()
const xai = createXai({ apiKey: process.env.XAI_API_KEY });

/** Create an AI SDK LanguageModelV4 for the given Grok model ID.
 *  When sessionId is provided, creates a session-scoped provider with
 *  the x-grok-conv-id header for xAI prompt cache routing. */
export function createModel(modelId: string, sessionId?: string): LanguageModelV4 {
	if (!sessionId) return xai(modelId);

	const sessionXai = createXai({
		apiKey: process.env.XAI_API_KEY,
		headers: { "x-grok-conv-id": sessionId },
	});
	return sessionXai(modelId);
}
