// legacy.ts — temporary, removed in Task 13
import type { ProviderName } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GrokProvider } from "./grok.ts";
import type { LLMProvider } from "./types.ts";

export function createProvider(name: ProviderName): LLMProvider {
	switch (name) {
		case "anthropic":
			return new AnthropicProvider();
		case "grok":
			return new GrokProvider();
		default:
			throw new Error(`Unknown provider: ${name}`);
	}
}
