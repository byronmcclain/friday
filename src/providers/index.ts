import type { LanguageModelV3 } from "@ai-sdk/provider";
import { xai } from "@ai-sdk/xai";

export const GROK_DEFAULTS = {
	model: "grok-4-1-fast-reasoning-latest",
	fastModel: "grok-4-1-fast-non-reasoning",
} as const;

/** Create an AI SDK LanguageModelV3 for the given Grok model ID */
export function createModel(modelId: string): LanguageModelV3 {
	return xai(modelId);
}
