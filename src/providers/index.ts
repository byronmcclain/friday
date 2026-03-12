import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";

export const GROK_DEFAULTS = {
	model: "grok-4-1-fast-reasoning-latest",
	fastModel: "grok-4-1-fast-non-reasoning",
} as const;

// Create provider once at module load with cached API key —
// avoids per-call process.env lookup inside the xAI provider's getHeaders()
const xai = createXai({ apiKey: process.env.XAI_API_KEY });

/** Create an AI SDK LanguageModelV3 for the given Grok model ID */
export function createModel(modelId: string): LanguageModelV3 {
	return xai(modelId);
}
