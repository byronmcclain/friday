import type { ProviderName } from "../core/types.ts";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { xai } from "@ai-sdk/xai";
import { anthropic } from "@ai-sdk/anthropic";

export const DEFAULT_PROVIDER: ProviderName = "grok";

export const PROVIDER_DEFAULTS: Record<ProviderName, { model: string; fastModel: string }> = {
	anthropic: { model: "claude-sonnet-4-20250514", fastModel: "claude-haiku-4-5-20251001" },
	grok: { model: "grok-4-1-fast-reasoning-latest", fastModel: "grok-4-1-fast-non-reasoning" },
};

/** Create an AI SDK LanguageModelV3 for the given provider and model ID */
export function createModel(provider: ProviderName, modelId: string): LanguageModelV3 {
	switch (provider) {
		case "grok":
			return xai(modelId);
		case "anthropic":
			return anthropic(modelId);
		default:
			throw new Error(`Unknown provider: ${provider}`);
	}
}
